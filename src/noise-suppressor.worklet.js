class NoiseSuppressor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.lastValues = new Float32Array(128);
    this.rmsWindow = new Float32Array(4096); // Larger window for better RMS calculation
    this.rmsIndex = 0;
    this.lastRMS = 0;
    this.voiceActive = false;
  }

  calculateRMS(input) {
    // Update RMS window
    this.rmsWindow[this.rmsIndex] = input * input;
    this.rmsIndex = (this.rmsIndex + 1) % this.rmsWindow.length;

    // Calculate RMS
    let sum = 0;
    for (let i = 0; i < this.rmsWindow.length; i++) {
      sum += this.rmsWindow[i];
    }
    const rms = Math.sqrt(sum / this.rmsWindow.length);

    // Smooth RMS transitions
    this.lastRMS = this.lastRMS * 0.95 + rms * 0.05;
    return this.lastRMS;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !output || !input[0] || !output[0]) return true;

    for (let channel = 0; channel < input.length; channel++) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];

      const noiseThreshold = 0.006; // More aggressive noise floor
      const voiceThreshold = 0.018; // Slightly higher voice threshold
      const rmsThreshold = 0.003; // More aggressive RMS threshold
      const smoothingFactor = 0.95; // Increased smoothing for stability

      for (let i = 0; i < inputChannel.length; i++) {
        const currentValue = inputChannel[i];
        const rms = this.calculateRMS(currentValue);
        const absValue = Math.abs(currentValue);

        // Smooth the signal amplitude
        this.lastValues[i] = this.lastValues[i] * smoothingFactor + absValue * (1 - smoothingFactor);

        // Voice activity detection with hysteresis
        if (this.voiceActive) {
          // Currently active - use more lenient threshold to prevent cutting
          this.voiceActive = this.lastValues[i] > noiseThreshold * 0.7 || rms > rmsThreshold * 0.7;
        } else {
          // Currently inactive - require stronger signal to activate
          this.voiceActive = this.lastValues[i] > voiceThreshold || rms > rmsThreshold * 2;
        }

        if (!this.voiceActive || this.lastValues[i] < noiseThreshold) {
          // Strong noise suppression
          outputChannel[i] = 0;
        } else if (this.lastValues[i] > voiceThreshold) {
          // Clear voice - pass through with slight attenuation
          outputChannel[i] = currentValue * 0.95;
        } else {
          // Transition zone - apply smooth curve
          const ratio = (this.lastValues[i] - noiseThreshold) / (voiceThreshold - noiseThreshold);
          const gain = Math.pow(ratio, 1.5); // More aggressive curve
          outputChannel[i] = currentValue * gain * 0.95;
        }
      }
    }
    return true;
  }
}

registerProcessor('noise-suppressor', NoiseSuppressor);
