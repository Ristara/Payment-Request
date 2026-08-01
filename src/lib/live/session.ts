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
  onError: (message: string) => void;
};

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
          onerror: () => this.events.onError("Voice connection had a problem."),
          onclose: () => {
            this.capture?.stop();
            this.capture = null;
            this.events.onStatus("closed");
          },
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

      this.session = session;
      // Anything the user said during the setup handshake is waiting; send it
      // now rather than losing it.
      this.flushPending();
    } catch {
      this.player?.stop();
      this.player = null;
      this.events.onError("Couldn't reach the voice service. Try again.");
      this.events.onStatus("closed");
    }
  }

  /**
   * Audio captured before the socket finished its setup handshake.
   *
   * The SDK fires onopen — and therefore beginCapture — before it has sent
   * BidiGenerateContentSetup and awaited setupComplete, so `this.session` is
   * still null for a moment after the mic goes live. That gap used to be
   * covered only by the 1200ms mute, which is to say it was covered by
   * accident; shortening the mute without this would have started quietly
   * eating the user's first words.
   */
  private pending: ArrayBuffer[] = [];

  private flushPending() {
    if (!this.session) return;
    for (const pcm of this.pending) {
      this.session.sendRealtimeInput({
        audio: { data: bufferToB64(pcm), mimeType: "audio/pcm;rate=16000" },
      });
    }
    this.pending = [];
  }

  private async handle(msg: LiveServerMessage) {
    const content = msg.serverContent;

    if (content?.interrupted) {
      // The user talked over the answer. What's queued is now wrong — drop it
      // rather than letting it play out over them.
      this.player?.flush();
      this.assistantLine = "";
      this.events.onStatus("listening");
    }

    if (content?.inputTranscription?.text) {
      this.userLine += content.inputTranscription.text;
    }
    if (content?.outputTranscription?.text) {
      this.assistantLine += content.outputTranscription.text;
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
      this.events.onStatus("listening");
    }

    if (msg.toolCall?.functionCalls?.length) {
      this.events.onStatus("thinking");
      await this.runTools(msg.toolCall.functionCalls);
    }
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
      capture = await startCapture((pcm) => {
        if (this.session) {
          this.session.sendRealtimeInput({
            audio: { data: bufferToB64(pcm), mimeType: "audio/pcm;rate=16000" },
          });
          return;
        }
        // Socket open, setup handshake still in flight. Hold the audio instead
        // of dropping it. Bounded and oldest-first so a connection that never
        // completes can't grow this without limit — roughly 3 seconds' worth.
        this.pending.push(pcm);
        if (this.pending.length > 48) this.pending.shift();
      });
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
    // This was 1200ms, on the theory that the echo canceller needed to
    // converge. At session start there is nothing playing to converge against
    // — Ria hasn't spoken yet — so that reasoning didn't hold, and the cost
    // was real: the UI said "Listening" while the mic was deaf, so the first
    // thing the user said went nowhere and they had to say it again. That is
    // most of what "the first conversation takes time" felt like.
    //
    // 300ms covers the ramp. It is still a guess, and it wants checking on a
    // real handset with the speaker on — I can't test audio from here.
    this.capture.setMuted(true);
    setTimeout(() => {
      if (this.closedByUser) return;
      this.capture?.setMuted(false);
      // Only now is the microphone genuinely live, so only now do we say so.
      this.events.onStatus("listening");
    }, 300);
  }

  stop() {
    this.closedByUser = true;
    this.capture?.stop();
    this.player?.stop();
    this.capture = null;
    this.player = null;
    this.pending = [];
    try {
      this.session?.close();
    } catch {
      /* already closing */
    }
    this.session = null;
    this.events.onStatus("closed");
  }
}
