import type { Env } from "../types";

export const DEFAULT_OLLAMA_HOST = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "qwen3-vl:8b";

// Ollama defaults to a 4096-token context window, which silently truncates a
// screenshot plus the agent instructions. Always send an explicit num_ctx.
export const DEFAULT_OLLAMA_NUM_CTX = 32768;

export function ollamaHost(env: Env): string {
  const host = env.OLLAMA_HOST?.trim() || DEFAULT_OLLAMA_HOST;
  // Ollama's own OLLAMA_HOST env var is commonly written without a scheme
  // ("127.0.0.1:11434"); accept that form too.
  const withScheme = /^https?:\/\//i.test(host) ? host : `http://${host}`;
  return withScheme.replace(/\/+$/, "");
}

export function ollamaBaseUrl(env: Env): string {
  return `${ollamaHost(env)}/api`;
}

export function ollamaNumCtx(env: Env): number {
  const numCtx = Number(env.OLLAMA_NUM_CTX);
  return Number.isInteger(numCtx) && numCtx > 0 ? numCtx : DEFAULT_OLLAMA_NUM_CTX;
}

export function defaultOllamaModel(env: Env): string {
  return env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
}

export type OllamaPreflightResult =
  | { ok: true }
  | { ok: false; status: 404 | 502 | 503; error: string };

/**
 * Checks that Ollama is reachable and that `modelId` has actually been
 * pulled, before /chat commits to a streaming response. This is the one
 * point where a chat request can still fail with a normal non-200 JSON
 * response instead of an in-stream `error` event — see the error-contract
 * comment at the top of routes/chat.ts. Once `streamText` starts, the same
 * two failures (host unreachable, model missing) can only be reported
 * inside the stream, because the 200 status line is already on the wire.
 *
 * Ambiguous outcomes (e.g. a tags response we fail to parse) are treated as
 * a pass rather than a block, so a bug in this check never stops a request
 * that would otherwise have worked — any real problem still surfaces via
 * the in-stream error handling in chat.ts.
 */
export async function preflightOllama(env: Env, modelId: string): Promise<OllamaPreflightResult> {
  const host = ollamaHost(env);

  let response: Response;
  try {
    response = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(5000) });
  } catch (error) {
    return {
      ok: false,
      status: 503,
      error: `Cannot reach Ollama at ${host} (${error instanceof Error ? error.message : String(error)}). Is 'ollama serve' running?`,
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      status: 502,
      error: `Ollama returned ${response.status}${body ? `: ${body}` : ""}`,
    };
  }

  try {
    const tags = (await response.json()) as { models?: { name?: string; model?: string }[] };
    const pulledModels = (tags.models ?? [])
      .map((tag) => tag.model ?? tag.name)
      .filter((id): id is string => Boolean(id))
      .map(normalizeModelTag);

    if (!pulledModels.includes(normalizeModelTag(modelId))) {
      return {
        ok: false,
        status: 404,
        error: `model '${modelId}' not found, try pulling it first`,
      };
    }
  } catch {
    // Couldn't parse the /api/tags body. Ollama is reachable, which is the
    // failure mode this check exists for, so let the request proceed.
  }

  return { ok: true };
}

// Ollama resolves a tag-less model name to ":latest" internally, so compare
// tags after applying the same normalization — otherwise a model pulled as
// "llama3.2-vision" would look "missing" when requested without a tag.
function normalizeModelTag(id: string): string {
  return id.includes(":") ? id : `${id}:latest`;
}
