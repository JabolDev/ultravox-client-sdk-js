class NoiseSuppressor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.lastValues = new Float32Array(128);
        this.rmsWindow = new Float32Array(4096); // Larger window for better RMS calculation
        this.rmsIndex = 0;
        this.lastRMS = 0;
        this.voiceActive = false;
        this.noiseFloor = 0.003;    // Initial noise floor estimate
        this.noiseFloorSmoothing = 0.003;    // How quickly the noise floor adapts
        this.minNoiseFloor = 0.001; // Lower bound for the noise floor to avoid over-suppression
        this.rmsSum = 0;            // Keep track of the sum of rmsWindow for efficient calculation
    }


    calculateRMS(input) {
        // Efficiently update RMS window
        this.rmsSum -= this.rmsWindow[this.rmsIndex];
        this.rmsWindow[this.rmsIndex] = input * input;
        this.rmsSum += this.rmsWindow[this.rmsIndex];
        this.rmsIndex = (this.rmsIndex + 1) % this.rmsWindow.length;

        // Calculate RMS
        const rms = Math.sqrt(this.rmsSum / this.rmsWindow.length);

        // Smooth RMS transitions
        this.lastRMS = this.lastRMS * 0.95 + rms * 0.05;
        return this.lastRMS;
    }
    updateNoiseFloor(rms) {
        // Simple moving average approach to update noise floor with smoothing
        this.noiseFloor = (1 - this.noiseFloorSmoothing) * this.noiseFloor + this.noiseFloorSmoothing * rms;
        this.noiseFloor = Math.max(this.minNoiseFloor, this.noiseFloor);  // Ensure the noise floor doesn't go too low
    }


    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !output || !input[0] || !output[0]) return true;

        for (let channel = 0; channel < input.length; channel++) {
            const inputChannel = input[channel];
            const outputChannel = output[channel];

            const voiceThreshold = this.noiseFloor * 6;// Slightly higher voice threshold with noise floor multiplier
            const rmsThreshold = this.noiseFloor * 2;   // RMS threshold dependent on noise floor
            const smoothingFactor = 0.95;  // increased smoothing for stability

            for (let i = 0; i < inputChannel.length; i++) {
                const currentValue = inputChannel[i];
                const rms = this.calculateRMS(currentValue);
                const absValue = Math.abs(currentValue);
                // Update Noise Floor
                this.updateNoiseFloor(rms);

                // Smooth the signal amplitude
                this.lastValues[i] = this.lastValues[i] * smoothingFactor + absValue * (1 - smoothingFactor);

                // Voice activity detection with hysteresis
                if (this.voiceActive) {
                    // Currently active - use more lenient threshold to prevent cutting
                    this.voiceActive = this.lastValues[i] > this.noiseFloor * 2.5 || rms > rmsThreshold * 0.7;
                } else {
                    // Currently inactive - require stronger signal to activate
                    this.voiceActive = this.lastValues[i] > voiceThreshold || rms > rmsThreshold * 2;
                }


                if (!this.voiceActive || this.lastValues[i] < this.noiseFloor) {
                    // Strong noise suppression
                    outputChannel[i] = 0;
                } else if (this.lastValues[i] > voiceThreshold) {
                    // Clear voice - pass through with slight attenuation
                    outputChannel[i] = currentValue * 0.95;
                } else {
                    // Transition zone - apply smooth curve
                    const ratio = (this.lastValues[i] - this.noiseFloor) / (voiceThreshold - this.noiseFloor);
                    const gain = Math.pow(ratio, 1.5); // More aggressive curve
                    outputChannel[i] = currentValue * gain * 0.95;
                }
            }
        }
        return true;
    }
}

registerProcessor('noise-suppressor', NoiseSuppressor);