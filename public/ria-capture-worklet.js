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
    // Starts MUTED, deliberately. startCapture awaits getUserMedia and
    // addModule, and on a first-ever session that await spans the browser's
    // permission prompt — so the worklet can be running for a while before
    // anyone gets to call setMuted(true). Starting open meant the mic's ramp
    // transient, and anything said while the prompt was up, was already on its
    // way to the model before the gate closed. Nothing opens this but an
    // explicit setMuted(false).
    this.muted = true;
    this.sumSq = 0;
    this.port.onmessage = (e) => {
      if (e.data && typeof e.data.muted === "boolean") {
        this.muted = e.data.muted;
        // Report the level immediately on a mute. process() early-returns
        // while muted, so without this the last reading before the gate closed
        // stays the newest one forever, and the UI keeps showing a muted
        // microphone hearing something.
        if (this.muted) {
          this.sumSq = 0;
          this.filled = 0;
          this.port.postMessage({ rms: 0 });
        }
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const samples = input[0];

    // Muted still consumes the input — dropping out of the graph would make
    // the context suspend on some browsers. Note this DROPS the audio: nothing
    // is posted, so nothing reaches the model. That is not the same as sending
    // silence, which the server's turn detection would treat differently.
    if (this.muted) return true;

    for (let i = 0; i < samples.length; i++) {
      // Float -1..1 to signed 16-bit, clamped: values can exceed 1 slightly.
      const s = Math.max(-1, Math.min(1, samples[i]));
      this.buffer[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      // The loop already touches every sample, so the level costs one
      // multiply-add each and no second pass.
      this.sumSq += s * s;

      if (this.filled === this.chunk) {
        // Copy, because the buffer is reused immediately.
        const pcm = this.buffer.slice();
        const rms = Math.sqrt(this.sumSq / this.chunk);
        this.sumSq = 0;
        this.filled = 0;
        this.port.postMessage({ pcm, rms });
      }
    }
    return true;
  }
}

registerProcessor("ria-capture", RiaCaptureProcessor);
