class NoiseSuppressor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.lastValues = new Float32Array(128); // For smoothing
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !output || !input[0] || !output[0]) return true;

    for (let channel = 0; channel < input.length; channel++) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];

      const threshold = 0.015; // Lower threshold for better voice detection
      const smoothingFactor = 0.85; // Smooth transitions

      for (let i = 0; i < inputChannel.length; i++) {
        const currentValue = inputChannel[i];
        // Smooth the signal
        this.lastValues[i] = this.lastValues[i] * smoothingFactor + currentValue * (1 - smoothingFactor);

        // Apply noise gate with hysteresis
        if (Math.abs(this.lastValues[i]) < threshold) {
          outputChannel[i] = 0;
        } else {
          // Soft knee for smoother transition
          const gain = Math.min(Math.abs(this.lastValues[i]) / threshold, 1);
          outputChannel[i] = currentValue * gain;
        }
      }
    }
    return true;
  }
}

registerProcessor('noise-suppressor', NoiseSuppressor);
