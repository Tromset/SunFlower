// Local macOS voice via speechSynthesis, sentence by sentence during the stream.
// Utterances are tagged per generation: async cancellation events from an
// interrupted session cannot corrupt the next one.
const SENTENCE_END = /^([\s\S]*?[.!?…])(?:\s+|$)/;

let voice: SpeechSynthesisVoice | null = null;
let buffer = "";
let pending = 0;
let finished = false;
let generation = 0;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
let onAllEnded: (() => void) | null = null;

function pickVoice(): void {
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return;
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  voice =
    en.find((v) => v.localService) ??
    en[0] ??
    voices.find((v) => v.localService) ??
    voices[0] ??
    null;
}

if (typeof speechSynthesis !== "undefined") {
  pickVoice();
  speechSynthesis.addEventListener("voiceschanged", pickVoice);
}

function speak(text: string): void {
  const clean = text.trim();
  if (!clean || typeof speechSynthesis === "undefined") return;
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = "en-US";
  if (voice) utterance.voice = voice;
  utterance.rate = 1;
  pending++;
  const gen = generation;
  const settle = () => {
    if (gen !== generation) return;
    pending--;
    maybeEnded();
  };
  utterance.onend = settle;
  utterance.onerror = settle;
  speechSynthesis.speak(utterance);
}

function maybeEnded(): void {
  if (finished && pending === 0) {
    finished = false;
    onAllEnded?.();
  }
}

export function initTts(allEnded: () => void): void {
  onAllEnded = allEnded;
}

export function pushText(text: string): void {
  buffer += text;
  for (;;) {
    const match = SENTENCE_END.exec(buffer);
    if (!match || match[1] === undefined) break;
    speak(match[1]);
    buffer = buffer.slice(match[0].length);
  }
}

/** End of stream: speak the remainder, then signal the end of the voice. */
export function finish(): void {
  if (buffer.trim()) speak(buffer);
  buffer = "";
  finished = true;
  if (typeof speechSynthesis === "undefined" || pending === 0) {
    // No voice available: leave time to read the bubble.
    finished = false;
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      onAllEnded?.();
    }, 1500);
    return;
  }
  maybeEnded();
}

export function stopTts(): void {
  generation++;
  buffer = "";
  finished = false;
  pending = 0;
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
