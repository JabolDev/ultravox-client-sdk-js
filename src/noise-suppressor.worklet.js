class NoiseSuppressor extends AudioWorkletProcessor {
    constructor() {
        super();

        // Configurable parameters with defaults
        this.config = {
            fftSize: 2048,
            minNoiseFloor: 0.001,
            initialNoiseFloor: 0.003,
            noiseFloorSmoothing: 0.003,
            voiceBandLow: 85,    // Hz - typical human voice lowest frequency
            voiceBandHigh: 3400, // Hz - typical human voice highest frequency
            smoothingFactor: 0.95,
            rmsWindowSize: 4096
        };

        // State variables
        this.lastValues = new Float32Array(128);
        this.rmsWindow = new Float32Array(this.config.rmsWindowSize);
        this.rmsIndex = 0;
        this.lastRMS = 0;
        this.voiceActive = false;
        this.noiseFloor = this.config.initialNoiseFloor;
        this.rmsSum = 0;

        // FFT related initialization
        this.fftBuffer = new Float32Array(this.config.fftSize);
        this.fftBufferIndex = 0;

        // Voice detection history for better stability
        this.voiceDetectionHistory = new Array(10).fill(false);

        // Spectral features
        this.lastSpectralFlux = 0;
        this.spectralPeaks = [];

        // Port for debugging and parameter adjustment
        this.port.onmessage = this.handleMessage.bind(this);
    }

    // Handle messages from main thread for parameter adjustment
    handleMessage(event) {
        const { type, data } = event.data;
        if (type === 'updateConfig') {
            this.config = { ...this.config, ...data };
        }
    }

    // Enhanced RMS calculation with weighted frequency bands
    calculateRMS(input) {
        this.rmsSum -= this.rmsWindow[this.rmsIndex];
        this.rmsWindow[this.rmsIndex] = input * input;
        this.rmsSum += this.rmsWindow[this.rmsIndex];
        this.rmsIndex = (this.rmsIndex + 1) % this.rmsWindow.length;

        const rms = Math.sqrt(this.rmsSum / this.rmsWindow.length);
        this.lastRMS = this.lastRMS * this.config.smoothingFactor +
            rms * (1 - this.config.smoothingFactor);
        return this.lastRMS;
    }

    // Spectral flux calculation for voice activity detection
    calculateSpectralFlux(fftData) {
        let flux = 0;
        for (let i = 0; i < fftData.length / 2; i++) {
            const diff = Math.abs(fftData[i]) - Math.abs(this.lastSpectralFlux[i] || 0);
            flux += diff > 0 ? diff : 0;
        }
        this.lastSpectralFlux = fftData.slice();
        return flux;
    }

    // Enhanced voice detection using multiple features
    detectVoiceActivity(input, rms) {
        // Collect FFT data
        this.fftBuffer[this.fftBufferIndex] = input;
        this.fftBufferIndex = (this.fftBufferIndex + 1) % this.config.fftSize;

        if (this.fftBufferIndex === 0) {
            // Perform FFT analysis when buffer is full
            const fftData = this.performFFT(this.fftBuffer);
            const spectralFlux = this.calculateSpectralFlux(fftData);
            const voiceBandEnergy = this.calculateVoiceBandEnergy(fftData);

            // Multiple feature voice detection
            const isVoice = (
                rms > this.noiseFloor * 4 ||
                spectralFlux > this.config.spectralFluxThreshold ||
                voiceBandEnergy > this.config.voiceBandThreshold
            );

            // Update voice detection history
            this.voiceDetectionHistory.shift();
            this.voiceDetectionHistory.push(isVoice);

            // Require multiple consecutive detections for stability
            const voiceDetectionCount = this.voiceDetectionHistory
                .filter(v => v).length;

            return voiceDetectionCount > this.voiceDetectionHistory.length * 0.6;
        }

        return this.voiceActive; // Return last state if FFT not ready
    }

    // Calculate energy in the voice frequency band
    calculateVoiceBandEnergy(fftData) {
        const binSize = sampleRate / this.config.fftSize;
        const lowBin = Math.floor(this.config.voiceBandLow / binSize);
        const highBin = Math.ceil(this.config.voiceBandHigh / binSize);

        let energy = 0;
        for (let i = lowBin; i <= highBin; i++) {
            energy += Math.abs(fftData[i]) ** 2;
        }
        return energy;
    }

    // Adaptive noise floor with enhanced learning
    updateNoiseFloor(rms, isVoice) {
        if (!isVoice) {
            // Update noise floor only during silence
            const adaptationRate = this.config.noiseFloorSmoothing *
                (rms < this.noiseFloor ? 2 : 1);

            this.noiseFloor = (1 - adaptationRate) * this.noiseFloor +
                adaptationRate * rms;

            // Ensure noise floor stays within bounds
            this.noiseFloor = Math.max(
                this.config.minNoiseFloor,
                Math.min(this.noiseFloor, this.config.maxNoiseFloor)
            );
        }
    }

    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !output || !input[0] || !output[0]) return true;

        for (let channel = 0; channel < input.length; channel++) {
            const inputChannel = input[channel];
            const outputChannel = output[channel];

            for (let i = 0; i < inputChannel.length; i++) {
                const currentValue = inputChannel[i];
                const rms = this.calculateRMS(currentValue);
                const absValue = Math.abs(currentValue);

                // Enhanced voice detection
                const isVoice = this.detectVoiceActivity(currentValue, rms);

                // Update noise floor
                this.updateNoiseFloor(rms, isVoice);

                // Smooth the signal amplitude
                this.lastValues[i] = this.lastValues[i] * this.config.smoothingFactor +
                    absValue * (1 - this.config.smoothingFactor);

                // Apply suppression
                if (isVoice) {
                    const signalToNoise = this.lastValues[i] / this.noiseFloor;
                    const gain = this.calculateGain(signalToNoise);
                    outputChannel[i] = currentValue * gain;
                } else {
                    outputChannel[i] = currentValue * 0.1; // Residual noise for natural sound
                }
            }
        }

        return true;
    }

    // Calculate adaptive gain based on signal-to-noise ratio (continued)
    calculateGain(signalToNoise) {
        const minGain = 0.1;
        const maxGain = 1.0;
        const threshold = 4.0;

        if (signalToNoise <= threshold) {
            return minGain;
        }

        // Smooth transition using sigmoid function
        const normalizedSnr = (signalToNoise - threshold) / threshold;
        const gain = 1 / (1 + Math.exp(-4 * normalizedSnr));

        return minGain + (maxGain - minGain) * gain;
    }

    // Perform FFT analysis
    performFFT(buffer) {
        // Simple FFT implementation
        // Note: In production, you might want to use a more optimized FFT library
        const fft = new Float32Array(this.config.fftSize);

        // Apply Hanning window
        for (let i = 0; i < this.config.fftSize; i++) {
            const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / this.config.fftSize));
            fft[i] = buffer[i] * window;
        }

        // Perform FFT (simplified version)
        // In real implementation, use Web Audio's built-in AnalyserNode or a proper FFT library
        return this.computeFFT(fft);
    }

    // Helper method to detect zero-crossing rate
    calculateZeroCrossings(buffer, length) {
        let crossings = 0;
        for (let i = 1; i < length; i++) {
            if ((buffer[i] >= 0 && buffer[i - 1] < 0) ||
                (buffer[i] < 0 && buffer[i - 1] >= 0)) {
                crossings++;
            }
        }
        return crossings;
    }

    // Method to export debug data
    exportDebugData() {
        this.port.postMessage({
            type: 'debug',
            data: {
                noiseFloor: this.noiseFloor,
                rms: this.lastRMS,
                voiceActive: this.voiceActive,
                voiceDetectionHistory: [...this.voiceDetectionHistory]
            }
        });
    }
}

// Add configuration options
const defaultConfig = {
    numberOfChannels: 1,
    processorOptions: {
        fftSize: 2048,
        minNoiseFloor: 0.001,
        initialNoiseFloor: 0.003,
        noiseFloorSmoothing: 0.003,
        voiceBandLow: 85,
        voiceBandHigh: 3400,
        smoothingFactor: 0.95,
        rmsWindowSize: 4096,
        spectralFluxThreshold: 0.5,
        voiceBandThreshold: 0.3,
        maxNoiseFloor: 0.01
    }
};

// Register the processor
registerProcessor('noise-suppressor', NoiseSuppressor, defaultConfig);

// Usage example in main thread:
/*
const context = new AudioContext();
await context.audioWorklet.addModule('noise-suppressor.js');

const noiseSuppressor = new AudioWorkletNode(context, 'noise-suppressor', {
    processorOptions: {
        // Custom configuration if needed
        voiceBandLow: 100,
        voiceBandHigh: 3000,
        smoothingFactor: 0.98
    }
});

// Debug listener
noiseSuppressor.port.onmessage = (event) => {
    if (event.data.type === 'debug') {
        console.log('Noise Suppressor Debug:', event.data.data);
    }
};

// Connect to audio graph
source.connect(noiseSuppressor).connect(context.destination);
*/