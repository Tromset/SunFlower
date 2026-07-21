// Client Ollama direct (100 % local) : /api/tags pour le statut,
// /api/chat en stream NDJSON pour les réponses.
import { getConfig } from "./config-store";

export class OllamaUserInterrupt extends Error {}
export class OllamaFailure extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
  }
}

export function ollamaHost(): string {
  let host = process.env["OLLAMA_HOST"] ?? getConfig().ollamaHost;
  if (!/^https?:\/\//.test(host)) host = `http://${host}`;
  return host.replace(/\/+$/, "");
}

export interface OllamaStatus {
  host: string;
  /** Modèle réellement utilisé (configuré, sinon premier modèle vision local). */
  name: string;
  reachable: boolean;
  pulled: boolean;
}

interface TagModel {
  name: string;
  capabilities?: string[];
}

function sameModel(a: string, b: string): boolean {
  const norm = (s: string) => (s.includes(":") ? s : `${s}:latest`);
  return norm(a) === norm(b);
}

/**
 * Le modèle configuré s'il est présent, sinon le premier modèle local avec
 * la capacité vision — l'app doit marcher avec ce qui tourne déjà chez vous.
 */
function pickModel(models: TagModel[]): TagModel | undefined {
  const configured = getConfig().ollamaModel;
  return (
    models.find((m) => sameModel(m.name, configured)) ??
    models.find((m) => (m.capabilities ?? []).includes("vision"))
  );
}

export async function checkOllama(): Promise<OllamaStatus> {
  const host = ollamaHost();
  const name = getConfig().ollamaModel;
  try {
    const res = await fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { host, name, reachable: false, pulled: false };
    const data = (await res.json()) as { models?: TagModel[] };
    const picked = pickModel(data.models ?? []);
    return {
      host,
      name: picked?.name ?? name,
      reachable: true,
      pulled: picked !== undefined,
    };
  } catch {
    return { host, name, reachable: false, pulled: false };
  }
}

/** Modèle à utiliser pour une requête (résolu au dernier moment). */
async function resolveModel(): Promise<string> {
  const status = await checkOllama();
  return status.pulled ? status.name : getConfig().ollamaModel;
}

const SYSTEM_PROMPT = [
  "You are sunflower, a calm, unobtrusive screen companion that runs entirely locally on the user's Mac.",
  "The attached image is their current screen; their question was dictated by voice, so it may contain small transcription errors.",
  "Answer in English, in one to three short, warm sentences. No lists, no emoji, no markdown, no code.",
  "If — and only if — pointing at ONE precise element on screen genuinely helps, end your answer with the exact marker [POINT:x%,y%] where x and y are the coordinates of that element's center as a percentage of the screen width and height.",
  "Never mention this marker or any coordinates in your text.",
].join(" ");

/** Supprime en flux les blocs <think>…</think> (défensif). */
function createThinkStripper(): (chunk: string) => string {
  let inThink = false;
  let carry = "";
  return (chunk: string): string => {
    let s = carry + chunk;
    carry = "";
    let out = "";
    while (s.length > 0) {
      if (inThink) {
        const end = s.indexOf("</think>");
        if (end === -1) {
          // garde une éventuelle balise fermante coupée
          const tail = s.slice(-8);
          carry = "</think>".startsWith(tail.replace(/^[^<]*/, "")) ? tail : "";
          return out;
        }
        s = s.slice(end + 8);
        inThink = false;
        continue;
      }
      const start = s.indexOf("<think>");
      if (start === -1) {
        // garde une éventuelle balise ouvrante coupée en fin de chunk
        const lt = s.lastIndexOf("<");
        if (lt !== -1 && "<think>".startsWith(s.slice(lt))) {
          out += s.slice(0, lt);
          carry = s.slice(lt);
        } else {
          out += s;
        }
        return out;
      }
      out += s.slice(0, start);
      s = s.slice(start + 7);
      inThink = true;
    }
    return out;
  };
}

export interface ChatOptions {
  question: string;
  imageB64: string;
  signal: AbortSignal;
  onToken: (text: string) => void;
}

/** Stream la réponse ; résout avec le texte complet (marqueurs inclus). */
export async function chat(opts: ChatOptions): Promise<string> {
  const model = await resolveModel();
  const ctrl = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => ctrl.abort();
  opts.signal.addEventListener("abort", onExternalAbort, { once: true });
  let watchdog: NodeJS.Timeout | null = null;
  const arm = (ms: number) => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, ms);
  };
  const strip = createThinkStripper();
  let full = "";
  try {
    arm(60_000); // démarrage à froid du modèle
    const res = await fetch(`${ollamaHost()}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        stream: true,
        think: false,
        keep_alive: "10m",
        options: { temperature: 0.4, num_predict: 300 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: opts.question,
            images: [opts.imageB64],
          },
        ],
      }),
    });
    if (res.status === 404) {
      throw new OllamaFailure(
        `model missing — ollama pull ${model}`,
      );
    }
    if (!res.ok || !res.body) {
      throw new OllamaFailure(`ollama responded ${res.status}.`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm(30_000); // silence entre tokens
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let parsed: {
          message?: { content?: string };
          done?: boolean;
          error?: string;
        };
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed.error) throw new OllamaFailure(`ollama : ${parsed.error}`);
        const content = strip(parsed.message?.content ?? "");
        if (content) {
          full += content;
          opts.onToken(content);
        }
        if (parsed.done) return full;
      }
    }
    return full;
  } catch (err) {
    if (err instanceof OllamaFailure) throw err;
    if (opts.signal.aborted && !timedOut) throw new OllamaUserInterrupt();
    if (timedOut) {
      throw new OllamaFailure(
        full.length > 0
          ? "the model stopped mid-answer."
          : "the model isn't responding.",
      );
    }
    throw new OllamaFailure("ollama can't be reached — run ollama serve.");
  } finally {
    if (watchdog) clearTimeout(watchdog);
    opts.signal.removeEventListener("abort", onExternalAbort);
  }
}
