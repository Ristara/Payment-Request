"use client";

import { b64ToBuffer, bufferToB64, startCapture, startPlayback, type Capture, type Player } from "./audio";

const WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export type LiveEvents = {
  onStatus: (s: "connecting" | "listening" | "speaking" | "thinking" | "closed") => void;
  /** Transcript lines, so the conversation still reads like the chat above it. */
  onTranscript: (role: "user" | "assistant", text: string, final: boolean) => void;
  onError: (message: string) => void;
};

type ServerMessage = {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: { inlineData?: { data?: string }; text?: string }[] };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    turnComplete?: boolean;
  };
  toolCall?: { functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[] };
  goAway?: { timeLeft?: string };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
};

/**
 * One spoken conversation with Ria.
 *
 * The browser talks to Google directly using a short-lived token minted by
 * our server — see api/assistant/live-token for why it isn't proxied. The
 * model's tool calls come back HERE, and this posts them to our own endpoint
 * so the actual data lookup still runs server-side under the user's RLS.
 *
 * Three things this has to survive that a naive version doesn't:
 *  - the user cutting in mid-answer (flush the queued audio, immediately)
 *  - Google closing the socket every ~10 minutes (reconnect on the resumption
 *    handle so the conversation carries on)
 *  - iOS suspending the page when the phone locks (close cleanly; there is no
 *    way to keep it alive)
 */
export class LiveSession {
  private ws: WebSocket | null = null;
  private capture: Capture | null = null;
  private player: Player | null = null;
  private resumeHandle: string | null = null;
  private closedByUser = false;
  private assistantLine = "";
  private userLine = "";

  constructor(private events: LiveEvents) {}

  async start() {
    this.closedByUser = false;
    this.events.onStatus("connecting");

    const res = await fetch("/api/assistant/live-token", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
    if (!res.ok || !body.token) {
      this.events.onError(body.error ?? "Couldn't start voice.");
      this.events.onStatus("closed");
      return;
    }

    // Playback first: it creates the AudioContext, and doing that inside the
    // user's tap is what unlocks audio on iOS.
    this.player = await startPlayback();
    await this.connect(body.token);
  }

  private async connect(token: string) {
    const ws = new WebSocket(`${WS_BASE}?access_token=${encodeURIComponent(token)}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      // Model, instruction and tools are pinned into the token itself, so the
      // setup here only carries what the token deliberately left open.
      ws.send(
        JSON.stringify({
          setup: {
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            ...(this.resumeHandle ? { sessionResumption: { handle: this.resumeHandle } } : {}),
          },
        }),
      );
    };

    ws.onmessage = async (e) => {
      const raw = typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data as ArrayBuffer);
      let msg: ServerMessage;
      try {
        msg = JSON.parse(raw) as ServerMessage;
      } catch {
        return;
      }
      await this.handle(msg);
    };

    ws.onerror = () => this.events.onError("Voice connection had a problem.");

    ws.onclose = () => {
      this.capture?.stop();
      this.capture = null;
      if (this.closedByUser) {
        this.events.onStatus("closed");
        return;
      }
      // Google closes the socket periodically by design. With a resumption
      // handle this is a sub-second gap rather than a lost conversation.
      if (this.resumeHandle) void this.reconnect();
      else this.events.onStatus("closed");
    };
  }

  private async reconnect() {
    const res = await fetch("/api/assistant/live-token", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { token?: string };
    if (!body.token || this.closedByUser) {
      this.events.onStatus("closed");
      return;
    }
    await this.connect(body.token);
  }

  private async handle(msg: ServerMessage) {
    if (msg.setupComplete) {
      await this.beginCapture();
      return;
    }

    if (msg.sessionResumptionUpdate?.newHandle) {
      this.resumeHandle = msg.sessionResumptionUpdate.newHandle;
    }

    const content = msg.serverContent;
    if (content) {
      // The user started talking over the answer. Everything queued is now
      // wrong — drop it rather than letting it play out over them.
      if (content.interrupted) {
        this.player?.flush();
        this.assistantLine = "";
        this.events.onStatus("listening");
      }

      if (content.inputTranscription?.text) {
        this.userLine += content.inputTranscription.text;
        this.events.onTranscript("user", this.userLine, false);
      }
      if (content.outputTranscription?.text) {
        this.assistantLine += content.outputTranscription.text;
        this.events.onTranscript("assistant", this.assistantLine, false);
      }

      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) {
          this.player?.push(b64ToBuffer(part.inlineData.data));
          this.events.onStatus("speaking");
        }
      }

      if (content.turnComplete) {
        if (this.userLine.trim()) this.events.onTranscript("user", this.userLine.trim(), true);
        if (this.assistantLine.trim()) this.events.onTranscript("assistant", this.assistantLine.trim(), true);
        this.userLine = "";
        this.assistantLine = "";
        this.events.onStatus("listening");
      }
    }

    if (msg.toolCall?.functionCalls?.length) {
      this.events.onStatus("thinking");
      await this.runTools(msg.toolCall.functionCalls);
    }
  }

  private async runTools(calls: { id?: string; name?: string; args?: Record<string, unknown> }[]) {
    const responses = await Promise.all(
      calls.map(async (call) => {
        let result: unknown;
        try {
          // Server-side, under the user's own session. The browser never
          // queries anything itself.
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
    this.ws?.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
  }

  private async beginCapture() {
    this.events.onStatus("listening");
    this.capture = await startCapture((pcm) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            audio: { mimeType: "audio/pcm;rate=16000", data: bufferToB64(pcm) },
          },
        }),
      );
    });

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
      this.ws?.close();
    } catch { /* already closing */ }
    this.ws = null;
    this.events.onStatus("closed");
  }
}
