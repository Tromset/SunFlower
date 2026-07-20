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
