import { getAuth } from "@clerk/hono";
import { stepCountIs, streamText } from "ai";
import type { Context } from "hono";
import { createOllama } from "ollama-ai-provider-v2";
import { appToolkitsMentionedInRequest, shouldUseAppIntegrationTools, withAgentInstructions, withPointerToolInstructions } from "../chat/instructions";
import { latestUserText, toModelMessages, toOllamaModelId } from "../chat/messages";
import { getToolsForUser } from "../services/composio";
import { defaultOllamaModel, ollamaBaseUrl, ollamaNumCtx, preflightOllama } from "../services/ollama";
import type { AppContext, ChatRequestBody } from "../types";
import { summarizeForLog } from "../utils/logging";

/**
 * /chat error contract
 * ---------------------
 * `/chat` streams its answer (the AI SDK's UI Message Stream protocol —
 * server-sent events on a 200 response), so most failures cannot be
 * reported with an HTTP status the way a plain JSON endpoint would: once
 * `toUIMessageStreamResponse` returns, the 200 status line and SSE headers
 * are already on the wire. There are two failure shapes a client must
 * handle:
 *
 * 1. Pre-stream failures (no bytes written yet) — a normal non-200 JSON
 *    response, `{ "error": string }`. This covers a malformed request body
 *    (400) and, via `preflightOllama` below, an unreachable Ollama host
 *    (503) or a model that hasn't been pulled (404) — the two failures the
 *    README's Troubleshooting section used to describe as silently
 *    swallowed inside the stream.
 *
 * 2. In-stream failures (after the 200 + SSE headers are sent) — a
 *    UIMessageChunk of shape `{ "type": "error", "errorText": string }`
 *    written into the stream, followed by the stream ending. This covers
 *    anything that fails mid-generation: Ollama going away or the model
 *    being unloaded after the preflight check passed, a non-200 from
 *    Ollama's own /api/chat, or the client aborting the request.
 *    `errorText` is Ollama's own error message when Ollama supplied one
 *    (e.g. `model "x" not found, try pulling it first`), a fixed message
 *    for a client-initiated abort, or `error.message` as a fallback. Every
 *    in-stream failure is also logged server-side (`console.error`, or
 *    `console.log` for a plain client abort) before the errorText is
 *    derived — see `errorTextForStream` below.
 */
export async function handleChat(c: Context<AppContext>): Promise<Response> {
  const { userId } = getAuth(c);

  let chatRequestBody: ChatRequestBody;
  try {
    chatRequestBody = (await c.req.raw.json()) as ChatRequestBody;
  } catch (error) {
    logChatError("[/chat] Invalid JSON body:", error);
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const env = c.env;
  const requestedModel = toOllamaModelId(chatRequestBody.model, defaultOllamaModel(env));

  // Fail fast, before any bytes are streamed, for the two Ollama problems
  // most likely on a fresh setup: the host being unreachable, or the model
  // never having been pulled. See the error-contract comment above.
  const preflight = await preflightOllama(env, requestedModel);
  if (!preflight.ok) {
    console.error("[/chat] Preflight failed:", summarizeForLog(preflight.error));
    return c.json({ error: preflight.error }, preflight.status);
  }

  const ollama = createOllama({ baseURL: ollamaBaseUrl(env) });
  const model = ollama(requestedModel);
  const messages = toModelMessages(chatRequestBody.messages ?? []);
  const latestUserRequest = latestUserText(chatRequestBody.messages ?? []);
  const shouldLoadAppTools = shouldUseAppIntegrationTools(latestUserRequest);
  const requestedToolkits = appToolkitsMentionedInRequest(latestUserRequest);
  const composioContext = userId && shouldLoadAppTools ? await getToolsForUser(env, userId, requestedToolkits) : undefined;
  const tools = composioContext?.tools as Parameters<typeof streamText>[0]["tools"] | undefined;
  const activeToolkits = composioContext?.activeToolkits ?? [];
  const hasAppTools = tools && Object.keys(tools).length > 0;
  const maxOutputTokens = hasAppTools
    ? Math.max(chatRequestBody.maxOutputTokens ?? 0, 4096)
    : chatRequestBody.maxOutputTokens;

  const result = streamText({
    model,
    system: withAgentInstructions(withPointerToolInstructions(chatRequestBody.system), {
      hasAppTools: Boolean(hasAppTools),
      activeToolkits,
      latestUserRequest,
    }),
    messages,
    maxOutputTokens,
    tools,
    stopWhen: stepCountIs(hasAppTools ? 40 : 20),
    abortSignal: c.req.raw.signal,
    providerOptions: {
      ollama: {
        options: {
          num_ctx: ollamaNumCtx(env),
          // Ollama's native /api/chat ignores the AI SDK's max_output_tokens
          // field; the equivalent native option is num_predict.
          ...(maxOutputTokens ? { num_predict: maxOutputTokens } : {}),
        },
      },
    },
  });

  return result.toUIMessageStreamResponse({
    onError: errorTextForStream,
  });
}

// Derives the `errorText` of the in-stream `error` UIMessageChunk — see the
// error-contract comment above. Always logs first, since this is the only
// place these failures are observable server-side once streaming started.
function errorTextForStream(error: unknown): string {
  if (isAbortError(error)) {
    console.log("[/chat] Stream aborted by client");
    return "The request was cancelled.";
  }

  // Ollama failures that slip past the preflight check (model unloaded or
  // deleted mid-request, Ollama restarting, a non-200 from its own
  // /api/chat) surface here, inside the already-200 stream. Log the
  // details and forward Ollama's own message ("model 'x' not found")
  // instead of the generic HTTP status text.
  logChatError("[/chat] Ollama stream error:", error);
  const responseBody = (error as { responseBody?: string } | null)?.responseBody;
  if (responseBody) {
    try {
      const parsed = JSON.parse(responseBody) as { error?: string };
      if (parsed.error) {
        return parsed.error;
      }
    } catch {
      // fall through to the generic message
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

// `console.error(prefix, error)` on a raw Error only prints "{}" once it
// round-trips through JSON (as summarizeForLog does), because Error fields
// aren't enumerable — so pull out the fields worth logging first, then let
// summarizeForLog truncate the potentially large upstream `responseBody`
// an Ollama APICallError carries.
function logChatError(prefix: string, error: unknown): void {
  if (error instanceof Error) {
    const responseBody = (error as { responseBody?: string }).responseBody;
    console.error(prefix, summarizeForLog({ name: error.name, message: error.message, responseBody }));
    return;
  }
  console.error(prefix, summarizeForLog(error));
}
