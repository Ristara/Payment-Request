"use client";

/**
 * Microphone in, speaker out, for Ria's voice mode.
 *
 * Two separate audio graphs, because Gemini Live works at two rates: it wants
 * 16 kHz PCM16 from the mic and sends back 24 kHz PCM16. Trying to do both in
 * one context means resampling one of them by hand.
 */

const CAPTURE_RATE = 16000;
const PLAYBACK_RATE = 24000;

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

export type Capture = {
  stop: () => void;
  setMuted: (muted: boolean) => void;
};

export type CaptureHooks = {
  /** Mic RMS, once per posted chunk (~15/sec). Only while unmuted. */
  onLevel?: (rms: number) => void;
  /**
   * The microphone went away mid-session — device unplugged, permission
   * revoked, another app took it. Without this a dead mic is indistinguishable
   * from a quiet room, which is the worst thing a voice UI can be vague about.
   */
  onLost?: () => void;
};

export async function startCapture(
  onChunk: (pcm16: ArrayBuffer) => void,
  hooks: CaptureHooks = {},
): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // Without these the mic hears Ria through the speaker and the model
      // interrupts itself. They are not enough on their own — see the
      // loopback in startPlayback — but they are the cheap half.
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });

  const ctx = new AudioContext({ sampleRate: CAPTURE_RATE });
  // iOS starts contexts suspended unless created inside a gesture.
  if (ctx.state === "suspended") await ctx.resume();

  // The ?v= is part of the cache key, and it must be bumped whenever the
  // message shape below changes. A stale worklet is invisible: the fetch
  // succeeds and only the contents are old, so nothing errors — it just stops
  // sending audio.
  await ctx.audioWorklet.addModule("/ria-capture-worklet.js?v=2");
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "ria-capture", { numberOfOutputs: 0 });

  // The worklet now posts an object rather than a bare Int16Array: the same
  // message carries the PCM that goes to Gemini and the level that drives the
  // UI, so the two cannot disagree about whether audio is flowing.
  node.port.onmessage = (e) => {
    const data = e.data as { pcm?: Int16Array; rms?: number } | Int16Array;
    // A bare Int16Array is the older worklet, which posted only PCM. Accepting
    // it costs nothing and means a stale copy degrades to "no level meter"
    // rather than "no audio at all" — reading only the new shape is what
    // turned a cached worklet into a microphone that captured perfectly and
    // sent nothing, with no error to show for it.
    if (data instanceof Int16Array) {
      onChunk(data.buffer as ArrayBuffer);
      return;
    }
    if (typeof data.rms === "number") hooks.onLevel?.(data.rms);
    if (data.pcm) onChunk(data.pcm.buffer as ArrayBuffer);
  };
  source.connect(node);

  // A track that ends on its own is the only signal that the mic died.
  const track = stream.getAudioTracks()[0];
  if (track) track.addEventListener("ended", () => hooks.onLost?.());

  return {
    stop: () => {
      node.port.onmessage = null;
      try { source.disconnect(); } catch { /* already torn down */ }
      try { node.disconnect(); } catch { /* already torn down */ }
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
    setMuted: (muted: boolean) => node.port.postMessage({ muted }),
  };
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

export type Player = {
  /** Queue a chunk of 24 kHz PCM16 from the model. */
  push: (pcm16: ArrayBuffer) => void;
  /** Drop everything queued — the user cut in and the old answer is void. */
  flush: () => void;
  stop: () => void;
  /** True while there is still audio to play. */
  isPlaying: () => boolean;
  /** 0..1 RMS of what is coming out of the speaker right now. */
  level: () => number;
};

export async function startPlayback(): Promise<Player> {
  const ctx = new AudioContext({ sampleRate: PLAYBACK_RATE });
  if (ctx.state === "suspended") await ctx.resume();

  // Chromium's echo canceller only cancels audio it believes came from a
  // remote peer. Web Audio played straight to the speakers is not that, so on
  // Android the mic picks Ria up and she talks over herself. Routing playback
  // through a local loopback peer connection makes the browser treat it as
  // remote audio, and the canceller does its job.
  const dest = ctx.createMediaStreamDestination();
  let sink: HTMLAudioElement | null = null;
  let pcA: RTCPeerConnection | null = null;
  let pcB: RTCPeerConnection | null = null;

  try {
    pcA = new RTCPeerConnection();
    pcB = new RTCPeerConnection();
    pcA.onicecandidate = (e) => e.candidate && pcB?.addIceCandidate(e.candidate);
    pcB.onicecandidate = (e) => e.candidate && pcA?.addIceCandidate(e.candidate);
    dest.stream.getTracks().forEach((t) => pcA!.addTrack(t, dest.stream));
    const remote = new MediaStream();
    pcB.ontrack = (e) => remote.addTrack(e.track);
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
    sink = new Audio();
    sink.autoplay = true;
    sink.srcObject = remote;
    await sink.play().catch(() => { /* unlocked by the tap that started voice */ });
  } catch {
    // Loopback is an optimisation, not a requirement. If it fails, play
    // straight out and accept that barge-in may be twitchy.
    dest.stream.getTracks().forEach((t) => t.stop());
    pcA?.close(); pcB?.close();
    pcA = pcB = null; sink = null;
  }

  const outputSink: AudioNode = pcA ? dest : ctx.destination;

  // A pass-through analyser in front of the sink, so inserting it changes
  // nothing audible and every source still lands in the same place.
  //
  // Measuring at push() time instead would be wrong and would look right for
  // about a second: a five-second answer arrives as a burst of chunks in
  // ~200ms, so a push-time meter spikes once and then reads zero for the
  // entire time Ria is actually audible. The analyser reads the SCHEDULED
  // timeline, and it silences itself for free when flush() drops a barged-in
  // answer.
  const meter = ctx.createAnalyser();
  meter.fftSize = 256;
  meter.smoothingTimeConstant = 0.35;
  meter.connect(outputSink);
  const frame = new Uint8Array(meter.fftSize);
  const output: AudioNode = meter;

  // Scheduled queue: each chunk is booked to start where the last one ends,
  // so consecutive chunks play gaplessly instead of overlapping.
  let nextStart = 0;
  const live = new Set<AudioBufferSourceNode>();

  const flush = () => {
    for (const s of live) {
      try { s.stop(); } catch { /* already ended */ }
    }
    live.clear();
    nextStart = 0;
  };

  return {
    push(pcm16) {
      const ints = new Int16Array(pcm16);
      if (ints.length === 0) return;
      const buf = ctx.createBuffer(1, ints.length, PLAYBACK_RATE);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < ints.length; i++) ch[i] = ints[i] / 0x8000;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(output);
      // A small floor keeps the first chunk from being scheduled in the past
      // after a pause, which some browsers drop silently.
      const start = Math.max(ctx.currentTime + 0.05, nextStart);
      src.start(start);
      nextStart = start + buf.duration;
      live.add(src);
      src.onended = () => live.delete(src);
    },
    flush,
    stop() {
      flush();
      sink?.pause();
      if (sink) sink.srcObject = null;
      pcA?.close();
      pcB?.close();
      void ctx.close();
    },
    isPlaying: () => live.size > 0,
    level() {
      meter.getByteTimeDomainData(frame);
      let sum = 0;
      for (let i = 0; i < frame.length; i++) {
        const v = (frame[i] - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / frame.length);
    },
  };
}

/** base64 → ArrayBuffer. Gemini sends audio as base64 inside JSON. */
export function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** ArrayBuffer → base64, chunked so a long buffer can't blow the call stack. */
export function bufferToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
