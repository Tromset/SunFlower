import type { Context } from "hono";
import { defaultOllamaModel, ollamaHost } from "../services/ollama";
import type { AppContext, ModelCapabilities, ModelSummary } from "../types";

type OllamaTag = {
  name?: string;
  model?: string;
  size?: number;
  capabilities?: string[];
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
    context_length?: number;
  };
};

/**
 * Lists the models pulled on the local Ollama instance so a client can build a
 * model picker. No UI is shipped for this yet; it exists so the app can offer
 * one without hardcoding a model list.
 */
export async function handleModels(c: Context<AppContext>): Promise<Response> {
  const host = ollamaHost(c.env);

  let tags: { models?: OllamaTag[] };
  try {
    const response = await fetch(`${host}/api/tags`);
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[/models] Ollama /api/tags error ${response.status}: ${errorBody}`);
      return c.json({ error: `Ollama returned ${response.status}` }, 502);
    }
    tags = await response.json();
  } catch (error) {
    console.error(`[/models] Cannot reach Ollama at ${host}:`, error);
    return c.json({ error: `Cannot reach Ollama at ${host}` }, 503);
  }

  const models = await Promise.all(
    (tags.models ?? []).map((tag) => toModelSummary(host, tag))
  );

  return c.json({
    defaultModel: defaultOllamaModel(c.env),
    models: models.filter((model): model is ModelSummary => model !== undefined),
  });
}

async function toModelSummary(host: string, tag: OllamaTag): Promise<ModelSummary | undefined> {
  const id = tag.model ?? tag.name;
  if (!id) {
    return undefined;
  }

  // Recent Ollama versions already report capabilities on /api/tags. Only fall
  // back to /api/show when they're missing — that response also carries the
  // full license, modelfile and tensor list, so it is expensive to fetch.
  const capabilities = tag.capabilities ?? (await fetchCapabilities(host, id));

  return {
    id,
    name: tag.name ?? id,
    family: tag.details?.family,
    parameterSize: tag.details?.parameter_size,
    quantization: tag.details?.quantization_level,
    contextLength: tag.details?.context_length,
    sizeBytes: tag.size,
    capabilities: toCapabilities(capabilities),
  };
}

async function fetchCapabilities(host: string, model: string): Promise<string[]> {
  try {
    const response = await fetch(`${host}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    });

    if (!response.ok) {
      console.error(`[/models] Ollama /api/show error ${response.status} for ${model}`);
      return [];
    }

    const shown = (await response.json()) as { capabilities?: string[] };
    return shown.capabilities ?? [];
  } catch (error) {
    console.error(`[/models] Failed to load capabilities for ${model}:`, error);
    return [];
  }
}

function toCapabilities(capabilities: string[]): ModelCapabilities {
  return {
    completion: capabilities.includes("completion"),
    vision: capabilities.includes("vision"),
    tools: capabilities.includes("tools"),
    thinking: capabilities.includes("thinking"),
  };
}
