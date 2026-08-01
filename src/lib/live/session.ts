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

    const res = await fetch("/api/assistant/live-token", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as {
      token?: string;
      model?: string;
      error?: string;
    };
    if (!res.ok || !body.token) {
      this.events.onError(body.error ?? "Couldn't start voice.");
      this.events.onStatus("closed");
      return;
    }

    // Playback first — creating the AudioContext inside the user's tap is
    // what unlocks audio on iOS.
    try {
      this.player = await startPlayback();
    } catch {
      this.events.onError("Couldn't start audio on this device.");
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
      this.session = await ai.live.connect({
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
    } catch {
      this.player?.stop();
      this.player = null;
      this.events.onError("Couldn't reach the voice service. Try again.");
      this.events.onStatus("closed");
    }
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
    this.events.onStatus("listening");
    try {
      this.capture = await startCapture((pcm) => {
        this.session?.sendRealtimeInput({
          audio: { data: bufferToB64(pcm), mimeType: "audio/pcm;rate=16000" },
        });
      });
    } catch {
      this.events.onError("Couldn't use the microphone. Check the permission and try again.");
      this.stop();
      return;
    }

    // The echo canceller needs a moment to settle. Sending audio before it
    // has means Ria's own first syllables reach the model and she answers
    // herself — a known iOS Safari failure that looks like a bug in us.
    this.capture.setMuted(true);
    setTimeout(() => this.capture?.setMuted(false), 1200);
  }

  stop() {
    this.closedByUser = true;
    this.capture?.stop();
    this.player?.stop();
    this.capture = null;
    this.player = null;
    try {
      this.session?.close();
    } catch {
      /* already closing */
    }
    this.session = null;
    this.events.onStatus("closed");
  }
}
