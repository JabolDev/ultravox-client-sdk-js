class NoiseSuppressor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    for (let channel = 0; channel < input.length; channel++) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];

      const threshold = 0.1;

      for (let i = 0; i < inputChannel.length; i++) {
        outputChannel[i] = Math.abs(inputChannel[i]) < threshold ? 0 : inputChannel[i];
      }
    }
    return true;
  }
}

registerProcessor('noise-suppressor', NoiseSuppressor);
