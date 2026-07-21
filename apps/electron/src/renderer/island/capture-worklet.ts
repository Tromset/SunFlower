// AudioWorkletProcessor : relaie les blocs PCM mono vers island.ts.
// Les globals du AudioWorkletGlobalScope ne sont pas dans lib DOM.
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(
  name: string,
  ctor: new () => AudioWorkletProcessor,
): void;

class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    // Copie : le buffer d'entrée est réutilisé par le moteur audio.
    if (channel && channel.length > 0) {
      this.port.postMessage(new Float32Array(channel));
    }
    return true;
  }
}

registerProcessor("sf-capture", CaptureProcessor);
