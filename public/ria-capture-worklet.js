/**
 * Mic capture worklet for Ria's voice mode.
 *
 * Gemini Live wants raw 16-bit PCM at 16 kHz. Nothing in MediaRecorder emits
 * that, so the audio has to be converted by hand — and it has to happen on
 * the audio thread, because doing it on the main thread drops samples the
 * moment React re-renders.
 *
 * Served from /public rather than bundled: addModule() takes a URL, and a
 * bundled chunk name changes on every build.
 */
class RiaCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // ~64ms at 16kHz. Small enough that barge-in feels instant, large enough
    // that we're not posting a message every 3ms.
    this.chunk = 1024;
    this.buffer = new Int16Array(this.chunk);
    this.filled = 0;
    this.muted = false;
    this.port.onmessage = (e) => {
      if (e.data && typeof e.data.muted === "boolean") this.muted = e.data.muted;
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const samples = input[0];

    // Muted still consumes the input — dropping out of the graph would make
    // the context suspend on some browsers.
    if (this.muted) return true;

    for (let i = 0; i < samples.length; i++) {
      // Float -1..1 to signed 16-bit, clamped: values can exceed 1 slightly.
      const s = Math.max(-1, Math.min(1, samples[i]));
      this.buffer[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;

      if (this.filled === this.chunk) {
        // Copy, because the buffer is reused immediately.
        this.port.postMessage(this.buffer.slice());
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("ria-capture", RiaCaptureProcessor);
