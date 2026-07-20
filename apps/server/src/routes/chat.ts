import { getAuth } from "@clerk/hono";
import { stepCountIs, streamText } from "ai";
import type { Context } from "hono";
import { createOllama } from "ollama-ai-provider-v2";
import { appToolkitsMentionedInRequest, shouldUseAppIntegrationTools, withAgentInstructions, withPointerToolInstructions } from "../chat/instructions";
import { latestUserText, toModelMessages, toOllamaModelId } from "../chat/messages";
import { getToolsForUser } from "../services/composio";
import { defaultOllamaModel, ollamaBaseUrl, ollamaNumCtx } from "../services/ollama";
import type { AppContext, ChatRequestBody } from "../types";

export async function handleChat(c: Context<AppContext>): Promise<Response> {
  const { userId } = getAuth(c);
  const chatRequestBody = (await c.req.raw.json()) as ChatRequestBody;
  const env = c.env;
  const ollama = createOllama({ baseURL: ollamaBaseUrl(env) });
  const model = ollama(toOllamaModelId(chatRequestBody.model, defaultOllamaModel(env)));
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
    onError: (error) => {
      // Ollama failures (model not pulled, host unreachable) surface here,
      // inside a 200 stream. Log the details and forward Ollama's own message
      // ("model 'x' not found") instead of the generic HTTP status text.
      console.error("[/chat] Ollama stream error:", error);
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
    },
  });
}
