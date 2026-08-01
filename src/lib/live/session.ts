"use client";

import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import {
  b64ToBuffer,
  bufferToB64,
  startCapture,
  startPlayback,
  type Capture,
  type Player,
} from "./audio";

export type LiveEvents = {
  onStatus: (s: "connecting" | "listening" | "speaking" | "thinking" | "closed") => void;
  /** Transcript lines, so the conversation still reads like the chat above it. */
  onTranscript: (role: "user" | "assistant", text: string) => void;
  /**
   * The line currently being spoken, replaced on every fragment and cleared
   * with "" when it settles. Fires several times a second, so the handler must
   * be cheap.
   */
  onPartial: (role: "user" | "assistant", text: string) => void;
  /**
   * Fired once, when the microphone gate genuinely opens. Deliberately
   * separate from onStatus("listening"): during the opening greeting the mic
   * is shut on purpose, and the UI has to be able to say so rather than
   * claiming to listen over a deaf microphone.
   */
  onMicOpen: () => void;
  onError: (message: string) => void;
};

/** How long a mic reading stays believable before it is treated as stale. */
const LEVEL_TTL_MS = 400;
/** Mic ramp floor — see beginCapture. */
const RAMP_MS = 300;
/** Hard ceiling on waiting for the greeting before opening the mic anyway. */
const GREETING_CEILING_MS = 6000;

/**
 * One spoken conversation with Ria.
 *
 * Uses Google's own SDK rather than talking to the WebSocket by hand. The
 * first attempt hand-rolled the protocol and got the setup message, the audio
 * envelope and the tool-response shape from inference — Google documents the
 * SDK, not the wire format, so that was guesswork dressed as code. The SDK
 * accepts an ephemeral token in place of an API key precisely so a browser
 * can hold the session without ever seeing the real one.
 *
 * Tool calls still come back to our server: the model asks the browser, and
 * the browser asks /api/assistant/tool, which runs the lookup under the
 * user's own RLS. The browser never queries anything itself.
 */
export class LiveSession {
  private session: Session | null = null;
  private capture: Capture | null = null;
  private player: Player | null = null;
  private closedByUser = false;
  private userLine = "";
  private assistantLine = "";

  /** Latest mic RMS, written by the capture callback ~15 times a second. */
  private micLevel = 0;
  /**
   * When that reading arrived. A plain field would hold its last value forever
   * if the capture died, and a frozen level is visually indistinguishable from
   * someone talking steadily — the orb would sit there inflated under
   * "Listening" with a dead microphone.
   */
  private micLevelAt = 0;
  /** The user's own mute, kept apart from the greeting gate below. */
  private userMuted = false;
  /** True once the mic gate is genuinely open. */
  private micOpen = false;
  /** Earliest wall-clock time the gate may open — the ramp floor. */
  private micReadyAt = 0;
  private greeted = false;
  private listenTimer: number | null = null;
  private ceilingTimer: number | null = null;

  constructor(private events: LiveEvents) {}

  async start() {
    this.closedByUser = false;
    this.events.onStatus("connecting");

    // The audio graph and the token have nothing to say to each other, so they
    // start together rather than one after the other.
    //
    // This also restores something the old comment claimed but no longer did:
    // the AudioContext has to be created inside the user's tap for iOS to
    // unlock audio, and awaiting the token first meant it was actually built
    // from a microtask a few hundred milliseconds later, which is not the
    // gesture.
    const playerP = startPlayback();
    // Nothing awaits this until the token returns; without a catch attached
    // now, a failure in the meantime is an unhandled rejection.
    playerP.catch(() => {});

    const res = await fetch("/api/assistant/live-token", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as {
      token?: string;
      model?: string;
      error?: string;
    };
    if (!res.ok || !body.token) {
      // The audio graph is already half-built. Returning without stopping it
      // strands an AudioContext, two peer connections and an <audio> element
      // that stop() can no longer reach, and browsers cap how many contexts a
      // page may hold — so a few failed taps would kill voice until reload.
      void playerP.then((p) => p.stop()).catch(() => {});
      this.events.onError(body.error ?? "Couldn't start voice.");
      this.events.onStatus("closed");
      return;
    }

    try {
      this.player = await playerP;
    } catch {
      this.events.onError("Couldn't start audio on this device.");
      this.events.onStatus("closed");
      return;
    }

    // The mic is opened only after playback exists, deliberately. The loopback
    // in startPlayback is what makes Chromium treat Ria as remote audio and
    // cancel her from the mic; opening the mic first may or may not still bind
    // correctly, and that is not something to find out in production.
    if (this.closedByUser) {
      this.player.stop();
      this.player = null;
      this.events.onStatus("closed");
      return;
    }

    // The ephemeral token stands in for the API key. The real key never
    // reaches this file.
    const ai = new GoogleGenAI({
      apiKey: body.token,
      // Ephemeral tokens are a v1alpha feature; the connection must match
      // the version the token was minted under.
      httpOptions: { apiVersion: "v1alpha" },
    });

    try {
      const session = await ai.live.connect({
        model: body.model ?? "gemini-3.1-flash-live-preview",
        // Everything is pinned into the token server-side — model, voice,
        // instruction, tools, transcription. Anything set here is ignored by
        // the API, so this stays minimal rather than pretending otherwise.
        config: { responseModalities: [Modality.AUDIO] },
        callbacks: {
          onopen: () => void this.beginCapture(),
          onmessage: (m: LiveServerMessage) => void this.handle(m),
          onerror: () => {
            // Was: report and carry on. That left the microphone open, the
            // socket half-dead and the panel still showing a working
            // conversation, because nothing here changed the status or tore
            // anything down.
            this.events.onError("The voice connection dropped.");
            this.stop();
          },
          onclose: () => this.stop(),
        },
      });

      // The user can tap End while the socket is still opening. Assigning
      // unconditionally would hand stop() a session it had already nulled,
      // leaving a live socket open against a single-use token.
      if (this.closedByUser) {
        try {
          session.close();
        } catch {
          /* never opened */
        }
        return;
      }

      // ai.live.connect() already awaits setupComplete before resolving, so
      // this session is post-handshake and can be spoken to immediately.
      // Hanging the greeting off onopen instead would put a clientContent
      // frame ahead of the setup message on the wire — and would silently
      // no-op anyway, because this.session is still null at that point.
      this.session = session;
      this.greet();

      // If she never speaks — the greeting is ignored, the model errors, the
      // turn never completes — the mic must still open. A voice UI whose
      // microphone waits forever on something that already failed is worse
      // than one that greets badly.
      this.ceilingTimer = window.setTimeout(() => {
        this.ceilingTimer = null;
        this.openMic();
      }, GREETING_CEILING_MS);
    } catch {
      this.player?.stop();
      this.player = null;
      this.events.onError("Couldn't reach the voice service. Try again.");
      this.events.onStatus("closed");
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Greeting                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Hand the model the turn so it speaks first.
   *
   * No `turns` payload: the SDK sends a bare
   * `{ clientContent: { turnComplete: true } }`, which is exactly the
   * "managing turns when not using audio input" case it documents. Because
   * nothing is said, there is no instruction-shaped text for the model to read
   * aloud and nothing lands in the context as a spurious user turn — the
   * wording lives in the system instruction, server-side, next to the name.
   *
   * If resume-on-drop is ever added (the token already sets sessionResumption)
   * set `greeted = true` before calling this when resuming: the greeting is
   * already in the resumed context and would otherwise fire again mid-chat.
   */
  private greet() {
    if (this.greeted || this.closedByUser || !this.session) return;
    this.greeted = true;
    try {
      this.session.sendClientContent({ turnComplete: true });
    } catch {
      // Nothing was sent, so nothing will complete — open up rather than
      // waiting out the ceiling in silence.
      this.openMic();
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Levels and mute                                                        */
  /* ---------------------------------------------------------------------- */

  /**
   * 0..1 microphone level. A pull rather than an event, deliberately: the view
   * reads it inside its own animation frame, so the level never enters React
   * state and the panel never re-renders for it.
   *
   * Returns 0 whenever the number would be a claim we can't stand behind — the
   * gate is shut, the user muted, or the last reading is stale enough that the
   * capture may be dead.
   */
  getMicLevel(): number {
    if (!this.micOpen || this.userMuted) return 0;
    if (performance.now() - this.micLevelAt > LEVEL_TTL_MS) return 0;
    return this.micLevel;
  }

  /** 0..1 level of what is coming out of the speaker right now. */
  getVoiceLevel(): number {
    return this.player?.level() ?? 0;
  }

  setMuted(muted: boolean) {
    this.userMuted = muted;
    // Only touch the gate once it is ours to touch. Before the greeting
    // finishes the capture is muted for a different reason, and unmuting here
    // would open the microphone into Ria's own voice.
    if (this.micOpen) this.capture?.setMuted(muted);
    if (muted) this.micLevel = 0;
  }

  /* ---------------------------------------------------------------------- */

  private async handle(msg: LiveServerMessage) {
    const content = msg.serverContent;

    if (content?.interrupted) {
      // The user talked over the answer. What's queued is now wrong — drop it
      // rather than letting it play out over them.
      this.player?.flush();
      // Commit what she had already said rather than wiping it. She said some
      // of it out loud, and a transcript people check amounts against should
      // not have a hole exactly where someone cut in to correct a figure. It
      // can over-reach a little — transcription runs slightly ahead of
      // playback, so the tail may be text generated but never heard — and that
      // is the safer of the two errors.
      if (this.assistantLine.trim()) {
        this.events.onTranscript("assistant", this.assistantLine.trim());
      }
      this.assistantLine = "";
      this.events.onPartial("assistant", "");
      this.scheduleListen();
    }

    if (content?.inputTranscription?.text) {
      this.userLine += content.inputTranscription.text;
      // Emitted as it arrives, not at turn end. "fifteen thousand" heard as
      // "fifty thousand" has to be on screen while there is still time to say
      // "no, fifteen" — after turnComplete the lookup has already gone out.
      this.events.onPartial("user", this.userLine);
    }
    if (content?.outputTranscription?.text) {
      this.assistantLine += content.outputTranscription.text;
      this.events.onPartial("assistant", this.assistantLine);
    }

    for (const part of content?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        this.player?.push(b64ToBuffer(part.inlineData.data));
        this.events.onStatus("speaking");
      }
    }

    if (content?.turnComplete) {
      // Commit both sides only once settled, so the transcript doesn't
      // flicker mid-word.
      if (this.userLine.trim()) this.events.onTranscript("user", this.userLine.trim());
      if (this.assistantLine.trim()) {
        this.events.onTranscript("assistant", this.assistantLine.trim());
      }
      this.userLine = "";
      this.assistantLine = "";
      this.events.onPartial("user", "");
      this.events.onPartial("assistant", "");
      this.scheduleListen();
    }

    if (msg.toolCall?.functionCalls?.length) {
      this.events.onStatus("thinking");
      await this.runTools(msg.toolCall.functionCalls);
    }
  }

  /**
   * Say "Listening" when it is actually true, and not a moment before.
   *
   * turnComplete means generation finished, not that the speaker has. Chunks
   * are scheduled ahead of wall clock, so a five-second answer arrives in
   * ~200ms and then plays out for another ~4.8 seconds. Announcing "listening"
   * at turnComplete meant the panel invited the user to speak while Ria was
   * still audibly talking — and, on the first turn, while the gate was shut.
   */
  private scheduleListen() {
    if (this.closedByUser) return;
    if (this.listenTimer !== null) {
      window.clearTimeout(this.listenTimer);
      this.listenTimer = null;
    }
    if (this.player?.isPlaying()) {
      this.listenTimer = window.setTimeout(() => this.scheduleListen(), 100);
      return;
    }
    this.openMic();
  }

  /** Open the gate, once, and only then claim to be listening. */
  private openMic() {
    if (this.closedByUser) return;
    if (this.listenTimer !== null) {
      window.clearTimeout(this.listenTimer);
      this.listenTimer = null;
    }
    // beginCapture may still be inside getUserMedia — on a first-ever session
    // that spans the browser's permission prompt. Wait rather than announce.
    if (!this.capture) {
      this.listenTimer = window.setTimeout(() => this.openMic(), 100);
      return;
    }
    const wait = this.micReadyAt - Date.now();
    if (wait > 0) {
      this.listenTimer = window.setTimeout(() => this.openMic(), wait);
      return;
    }
    if (this.ceilingTimer !== null) {
      window.clearTimeout(this.ceilingTimer);
      this.ceilingTimer = null;
    }
    if (!this.micOpen) {
      this.micOpen = true;
      this.micLevelAt = performance.now();
      this.capture.setMuted(this.userMuted);
      this.events.onMicOpen();
    }
    this.events.onStatus("listening");
  }

  private async runTools(
    calls: { id?: string; name?: string; args?: Record<string, unknown> }[],
  ) {
    const functionResponses = await Promise.all(
      calls.map(async (call) => {
        let result: unknown;
        try {
          const r = await fetch("/api/assistant/tool", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: call.name, args: call.args ?? {} }),
          });
          const j = (await r.json()) as { result?: unknown; error?: string };
          result = r.ok ? j.result : { error: j.error ?? "Lookup failed." };
        } catch {
          result = { error: "Lookup failed." };
        }
        return { id: call.id, name: call.name, response: { output: result } };
      }),
    );
    this.session?.sendToolResponse({ functionResponses });
  }

  private async beginCapture() {
    if (this.closedByUser) return;
    let capture: Capture;
    try {
      capture = await startCapture(
        (pcm) => {
          // The gate is shut until openMic, and openMic cannot run before the
          // session exists, so this is only ever reached with a live session.
          // The check stays as a guard, not as a buffer: the old `pending`
          // queue existed to protect the user's first words, and with Ria
          // greeting first there are no first words to protect at t=0 — its
          // only remaining effect would have been to fire the microphone's
          // ramp transient at the model in the middle of the greeting.
          if (!this.session) return;
          this.session.sendRealtimeInput({
            audio: { data: bufferToB64(pcm), mimeType: "audio/pcm;rate=16000" },
          });
        },
        {
          onLevel: (rms) => {
            this.micLevel = rms;
            this.micLevelAt = performance.now();
          },
          onLost: () => {
            this.events.onError("The microphone stopped. Check it isn't in use elsewhere.");
            this.stop();
          },
        },
      );
    } catch {
      this.events.onError("Couldn't use the microphone. Check the permission and try again.");
      this.stop();
      return;
    }

    // The user can end voice while getUserMedia is still resolving — and on a
    // first-ever session that await spans the browser's permission prompt, so
    // the window is as long as they take to answer it. stop() has already run
    // by then and found this.capture still null, so assigning it here handed
    // the page a live microphone that nothing would ever close: the phone's
    // recording indicator stayed on until the tab was closed.
    if (this.closedByUser) {
      capture.stop();
      return;
    }
    this.capture = capture;

    // A freshly opened microphone ramps: autoGainControl and noiseSuppression
    // settle over the first fraction of a second, and that transient is enough
    // to trip the model's turn detection into answering a noise.
    //
    // This used to be a bare 1200ms, then a bare 300ms, on a timer that
    // unmuted whatever else was happening. Now that Ria speaks first a fixed
    // timer cannot be right at all: it would have to cover token latency plus
    // the greeting plus the playback tail, none of which are constant. So the
    // ramp is only a FLOOR now, and the gate is opened by state — greeting
    // finished and the speaker drained — in openMic().
    //
    // The worklet also starts muted, so nothing escapes between addModule
    // resolving and this line.
    this.micReadyAt = Date.now() + RAMP_MS;
    this.capture.setMuted(true);
  }

  stop() {
    // Idempotent: the user's End calls session.close(), which fires onclose,
    // which lands back here.
    if (this.closedByUser) return;
    this.closedByUser = true;
    if (this.listenTimer !== null) window.clearTimeout(this.listenTimer);
    if (this.ceilingTimer !== null) window.clearTimeout(this.ceilingTimer);
    this.listenTimer = null;
    this.ceilingTimer = null;
    this.capture?.stop();
    this.player?.stop();
    this.capture = null;
    this.player = null;
    this.micLevel = 0;
    this.micLevelAt = 0;
    this.micOpen = false;
    this.userLine = "";
    this.assistantLine = "";
    this.events.onPartial("user", "");
    this.events.onPartial("assistant", "");
    try {
      this.session?.close();
    } catch {
      /* already closing */
    }
    this.session = null;
    this.events.onStatus("closed");
  }
}
