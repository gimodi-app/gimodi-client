/* global AudioWorkletProcessor, registerProcessor */

/**
 * RNNoise AudioWorklet Processor
 *
 * Receives a compiled WebAssembly.Module from the main thread,
 * instantiates the RNNoise WASM with a minimal Emscripten runtime,
 * and denoises audio in real-time.
 *
 * RNNoise operates on 480-sample frames while AudioWorklet uses 128-sample
 * frames, so a circular buffer bridges the two.
 */

const RNNOISE_FRAME_SIZE = 480;
// eslint-disable-next-line no-unused-vars
const WORKLET_FRAME_SIZE = 128;
// LCM(128, 480) = 1920 - but we use 3840 (2×LCM) for extra headroom
const BUFFER_SIZE = 3840;

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ready = false;
    this._destroyed = false;

    // Circular buffer indices
    this._inputWriteIndex = 0;
    this._denoiseReadIndex = 0;
    this._outputReadIndex = 0;
    this._samplesAvailableForDenoise = 0;
    this._samplesAvailableForOutput = 0;

    // Ring buffer for bridging frame sizes
    this._inputBuffer = new Float32Array(BUFFER_SIZE);
    this._outputBuffer = new Float32Array(BUFFER_SIZE);

    this.port.onmessage = (e) => {
      if (e.data.type === 'init') {
        this._initWasm(e.data.wasmModule);
      } else if (e.data.type === 'destroy') {
        this._destroy();
      }
    };
  }

  _initWasm(wasmModule) {
    try {
      // Minimal Emscripten runtime for RNNoise WASM
      const INITIAL_PAGES = 256; // 16MB
      const memory = new WebAssembly.Memory({ initial: INITIAL_PAGES });
      let HEAPU8 = new Uint8Array(memory.buffer);
      let HEAPF32 = new Float32Array(memory.buffer);

      const updateViews = () => {
        HEAPU8 = new Uint8Array(memory.buffer);
        HEAPF32 = new Float32Array(memory.buffer);
      };

      const imports = {
        a: {
          // _emscripten_resize_heap
          a: (requestedSize) => {
            const oldSize = memory.buffer.byteLength;
            const maxSize = 2147483648;
            if (requestedSize > maxSize) {
              return 0;
            }
            const newSize = Math.min(maxSize, Math.max(requestedSize, oldSize * 2));
            const pages = (newSize - oldSize + 65535) >>> 16;
            try {
              memory.grow(pages);
              updateViews();
              return 1;
            } catch {
              return 0;
            }
          },
          // _emscripten_memcpy_big
          b: (dest, src, num) => {
            HEAPU8.copyWithin(dest, src, src + num);
          },
        },
      };

      const instance = new WebAssembly.Instance(wasmModule, imports);
      const exports = instance.exports;

      // The WASM exports its own memory at export "c"
      // Update views to use the WASM's memory
      const wasmMemory = exports.c;
      HEAPU8 = new Uint8Array(wasmMemory.buffer);
      HEAPF32 = new Float32Array(wasmMemory.buffer);

      // Call __wasm_call_ctors (export "d")
      if (exports.d) {
        exports.d();
      }

      // Store exports
      this._malloc = exports.e;
      this._free = exports.f;
      this._rnnoiseInit = exports.g;
      this._rnnoiseCreate = exports.h;
      this._rnnoiseDestroy = exports.i;
      this._rnnoiseProcessFrame = exports.j;
      this._HEAPF32 = HEAPF32;
      this._wasmMemory = wasmMemory;

      // Initialize RNNoise
      this._rnnoiseInit();
      this._state = this._rnnoiseCreate();

      // Allocate WASM heap buffer for one frame (480 floats × 4 bytes)
      this._framePtr = this._malloc(RNNOISE_FRAME_SIZE * 4);

      this._ready = true;
      this.port.postMessage({ type: 'ready' });
    } catch (e) {
      this.port.postMessage({ type: 'error', message: e.message });
    }
  }

  _destroy() {
    if (this._state && this._rnnoiseDestroy) {
      this._rnnoiseDestroy(this._state);
      this._state = null;
    }
    if (this._framePtr && this._free) {
      this._free(this._framePtr);
      this._framePtr = null;
    }
    this._ready = false;
    this._destroyed = true;
  }

  process(inputs, outputs) {
    if (this._destroyed) {
      return false;
    }

    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0] || !output || !output[0]) {
      return true;
    }

    const inputData = input[0];
    const outputData = output[0];

    if (!this._ready) {
      // Pass through until WASM is ready
      outputData.set(inputData);
      return true;
    }

    // Refresh HEAPF32 view in case memory was resized
    if (this._HEAPF32.buffer !== this._wasmMemory.buffer) {
      this._HEAPF32 = new Float32Array(this._wasmMemory.buffer);
    }

    // Write input samples to ring buffer
    for (let i = 0; i < inputData.length; i++) {
      this._inputBuffer[this._inputWriteIndex] = inputData[i];
      this._inputWriteIndex = (this._inputWriteIndex + 1) % BUFFER_SIZE;
    }
    this._samplesAvailableForDenoise += inputData.length;

    // Process complete 480-sample frames through RNNoise
    while (this._samplesAvailableForDenoise >= RNNOISE_FRAME_SIZE) {
      const heapOffset = this._framePtr >> 2; // Float32 index

      // Copy 480 samples from input ring buffer to WASM heap
      // RNNoise expects samples scaled to 16-bit range [-32768, 32767]
      for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
        this._HEAPF32[heapOffset + i] = this._inputBuffer[this._denoiseReadIndex] * 32768;
        this._denoiseReadIndex = (this._denoiseReadIndex + 1) % BUFFER_SIZE;
      }
      this._samplesAvailableForDenoise -= RNNOISE_FRAME_SIZE;

      // Process in-place, returns VAD probability
      const vad = this._rnnoiseProcessFrame(this._state, this._framePtr, this._framePtr);

      // Copy denoised samples back to output ring buffer
      // Scale back from 16-bit range to [-1, 1]
      for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
        this._outputBuffer[(this._outputReadIndex + this._samplesAvailableForOutput + i) % BUFFER_SIZE] = this._HEAPF32[heapOffset + i] / 32768;
      }
      this._samplesAvailableForOutput += RNNOISE_FRAME_SIZE;

      // Post VAD probability to main thread (throttled)
      this.port.postMessage({ type: 'vad', value: vad });
    }

    // Read denoised samples from output ring buffer
    if (this._samplesAvailableForOutput >= outputData.length) {
      for (let i = 0; i < outputData.length; i++) {
        outputData[i] = this._outputBuffer[this._outputReadIndex];
        this._outputReadIndex = (this._outputReadIndex + 1) % BUFFER_SIZE;
      }
      this._samplesAvailableForOutput -= outputData.length;
    } else {
      // Not enough denoised samples yet - output silence
      outputData.fill(0);
    }

    return true;
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);
