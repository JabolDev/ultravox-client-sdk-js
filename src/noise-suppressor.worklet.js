class FFT {
    constructor(size) {
        this.size = size;
        this.real = new Float32Array(size);
        this.imag = new Float32Array(size);
        this.window = new Float32Array(size);

        // Create Hanning window
        for (let i = 0; i < size; i++) {
            this.window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
        }
    }

    transform(input) {
        // Apply window and prepare real/imag arrays
        for (let i = 0; i < this.size; i++) {
            this.real[i] = input[i] * this.window[i];
            this.imag[i] = 0;
        }

        // Cooley-Tukey FFT
        let n = this.size;
        for (let i = 0; i < n; i++) {
            if (i < this.reverseBits(i, n)) {
                [this.real[i], this.real[this.reverseBits(i, n)]] =
                    [this.real[this.reverseBits(i, n)], this.real[i]];
                [this.imag[i], this.imag[this.reverseBits(i, n)]] =
                    [this.imag[this.reverseBits(i, n)], this.imag[i]];
            }
        }

        for (let size = 2; size <= n; size *= 2) {
            const halfsize = size / 2;
            const tablestep = n / size;
            for (let i = 0; i < n; i += size) {
                for (let j = i, k = 0; j < i + halfsize; j++, k += tablestep) {
                    const thetaR = Math.cos(-2 * Math.PI * k / n);
                    const thetaI = Math.sin(-2 * Math.PI * k / n);
                    const tmpR = this.real[j + halfsize];
                    const tmpI = this.imag[j + halfsize];

                    const targetR = thetaR * tmpR - thetaI * tmpI;
                    const targetI = thetaR * tmpI + thetaI * tmpR;

                    this.real[j + halfsize] = this.real[j] - targetR;
                    this.imag[j + halfsize] = this.imag[j] - targetI;
                    this.real[j] += targetR;
                    this.imag[j] += targetI;
                }
            }
        }

        // Calculate magnitude spectrum
        const magnitude = new Float32Array(this.size / 2);
        for (let i = 0; i < this.size / 2; i++) {
            magnitude[i] = Math.sqrt(
                this.real[i] * this.real[i] +
                this.imag[i] * this.imag[i]
            );
        }
        return magnitude;
    }

    reverseBits(x, n) {
        let result = 0;
        let power = Math.log2(n);
        for (let i = 0; i < power; i++) {
            result = (result << 1) | (x & 1);
            x >>= 1;
        }
        return result;
    }
}

class NoiseSuppressor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.fft = new FFT(2048);
        this.buffer = new Float32Array(2048);
        this.bufferIndex = 0;
        this.lastMagnitudes = new Float32Array(1024);
        this.noiseProfile = new Float32Array(1024).fill(0.001);
        this.voiceActive = false;

        // Voice frequency ranges (in bins, assuming 44.1kHz sampling)
        this.voiceLowBin = Math.floor(85 * 2048 / 44100);    // 85Hz
        this.voiceHighBin = Math.floor(3400 * 2048 / 44100); // 3400Hz
    }

    detectVoice(magnitudes) {
        let voiceEnergy = 0;
        let noiseEnergy = 0;

        // Calculate energy in voice frequency range
        for (let i = this.voiceLowBin; i < this.voiceHighBin; i++) {
            if (magnitudes[i] > this.noiseProfile[i] * 2) {
                voiceEnergy += magnitudes[i];
            }
            noiseEnergy += this.noiseProfile[i];
        }

        // Update noise profile during silence
        if (voiceEnergy < noiseEnergy * 1.5) {
            for (let i = 0; i < magnitudes.length; i++) {
                this.noiseProfile[i] = this.noiseProfile[i] * 0.95 + magnitudes[i] * 0.05;
            }
        }

        return voiceEnergy > noiseEnergy * 2;
    }

    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !output || !input[0] || !output[0]) return true;

        const inputChannel = input[0];
        const outputChannel = output[0];

        // Fill buffer and process when full
        for (let i = 0; i < inputChannel.length; i++) {
            this.buffer[this.bufferIndex] = inputChannel[i];
            this.bufferIndex++;

            if (this.bufferIndex >= this.buffer.length) {
                // Perform FFT analysis
                const magnitudes = this.fft.transform(this.buffer);
                this.voiceActive = this.detectVoice(magnitudes);
                this.bufferIndex = 0;
            }

            // Apply suppression based on voice detection
            if (this.voiceActive) {
                outputChannel[i] = inputChannel[i];
            } else {
                outputChannel[i] = inputChannel[i] * 0.1; // Reduce non-voice by 90%
            }
        }

        return true;
    }
}

registerProcessor('noise-suppressor', NoiseSuppressor);