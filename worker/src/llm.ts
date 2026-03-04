/**
 * LLM invocation for Cloudflare Workers.
 * Supports OpenAI, Gemini, Anthropic, Grok via their native APIs,
 * and Azure AI Foundry (Kimi-K2.5 etc.) as server-side fallback.
 */
import { TRPCError } from "@trpc/server";

type Message = { role: "system" | "user" | "assistant"; content: string };

type LLMConfig = {
  provider: string;
  apiKey: string;
  model?: string;
  /** Azure AI Foundry endpoint base URL (e.g. https://resource.services.ai.azure.com) */
  baseUrl?: string;
};

type LLMResult = {
  content: string;
  model: string;
  provider: string;
  usage?: { promptTokens: number; completionTokens: number };
};

/** Convert raw LLM API errors into structured TRPCError */
function wrapLLMError(provider: string, status: number, rawError: string): never {
  // Rate limit
  if (status === 429) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `AIサービス（${provider}）のレート制限に達しました。しばらく待ってから再試行してください。`,
    });
  }
  // Auth errors (bad API key)
  if (status === 401 || status === 403) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `AIサービス（${provider}）の認証に失敗しました。APIキーを確認してください。`,
    });
  }
  // Server errors
  if (status >= 500) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `AIサービス（${provider}）が一時的に利用できません。しばらく待ってから再試行してください。`,
    });
  }
  // Other errors
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `AIサービス（${provider}）でエラーが発生しました。`,
  });
}

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
  anthropic: "claude-sonnet-4-20250514",
  grok: "grok-2",
  "azure-foundry": "Kimi-K2.5",
};

/**
 * Call an LLM provider with messages.
 */
export async function invokeLLM(
  config: LLMConfig,
  messages: Message[],
  options?: { maxTokens?: number; temperature?: number }
): Promise<LLMResult> {
  const { provider, apiKey } = config;
  const model = config.model || DEFAULT_MODELS[provider] || "gpt-4o-mini";
  const maxTokens = options?.maxTokens ?? 4096;
  const temperature = options?.temperature ?? 0.7;

  switch (provider) {
    case "openai":
    case "grok":
      return callOpenAICompatible(provider, apiKey, model, messages, maxTokens, temperature);
    case "gemini":
      return callGemini(apiKey, model, messages, maxTokens, temperature);
    case "anthropic":
      return callAnthropic(apiKey, model, messages, maxTokens, temperature);
    case "azure-foundry":
      return callAzureFoundry(config.baseUrl!, apiKey, model, messages, maxTokens, temperature);
    default:
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `サポートされていないAIプロバイダー: ${provider}`,
      });
  }
}

async function callOpenAICompatible(
  provider: string,
  apiKey: string,
  model: string,
  messages: Message[],
  maxTokens: number,
  temperature: number
): Promise<LLMResult> {
  const baseUrl = provider === "grok" ? "https://api.x.ai" : "https://api.openai.com";

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
  });

  if (!res.ok) {
    const err = await res.text();
    wrapLLMError(provider, res.status, err);
  }

  const data = await res.json() as any;
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    model,
    provider,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
    } : undefined,
  };
}

async function callGemini(
  apiKey: string,
  model: string,
  messages: Message[],
  maxTokens: number,
  temperature: number
): Promise<LLMResult> {
  // Convert to Gemini format
  const systemInstruction = messages.find(m => m.role === "system")?.content;
  const contents = messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const body: any = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    wrapLLMError("gemini", res.status, err);
  }

  const data = await res.json() as any;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return {
    content: text,
    model,
    provider: "gemini",
    usage: data.usageMetadata ? {
      promptTokens: data.usageMetadata.promptTokenCount ?? 0,
      completionTokens: data.usageMetadata.candidatesTokenCount ?? 0,
    } : undefined,
  };
}

async function callAnthropic(
  apiKey: string,
  model: string,
  messages: Message[],
  maxTokens: number,
  temperature: number
): Promise<LLMResult> {
  const systemMsg = messages.find(m => m.role === "system")?.content;
  const chatMessages = messages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role, content: m.content }));

  const body: any = {
    model,
    messages: chatMessages,
    max_tokens: maxTokens,
    temperature,
  };
  if (systemMsg) body.system = systemMsg;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    wrapLLMError("anthropic", res.status, err);
  }

  const data = await res.json() as any;
  const text = data.content?.[0]?.text ?? "";
  return {
    content: text,
    model,
    provider: "anthropic",
    usage: data.usage ? {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
    } : undefined,
  };
}

async function callAzureFoundry(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Message[],
  maxTokens: number,
  temperature: number
): Promise<LLMResult> {
  const url = `${baseUrl}/openai/deployments/${model}/chat/completions?api-version=2024-12-01-preview`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({ messages, max_tokens: maxTokens, temperature }),
  });

  if (!res.ok) {
    const err = await res.text();
    wrapLLMError("azure-foundry", res.status, err);
  }

  const data = await res.json() as any;
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    model,
    provider: "azure-foundry",
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
    } : undefined,
  };
}

// ============ Streaming LLM ============

export type { LLMConfig, Message };

/**
 * Stream tokens from an LLM provider. Calls onToken for each chunk.
 * Returns the full accumulated content when done.
 */
export async function invokeLLMStream(
  config: LLMConfig,
  messages: Message[],
  options: { maxTokens?: number; temperature?: number },
  onToken: (token: string) => void,
): Promise<string> {
  const { provider, apiKey } = config;
  const model = config.model || DEFAULT_MODELS[provider] || "gpt-4o-mini";
  const maxTokens = options?.maxTokens ?? 4096;
  const temperature = options?.temperature ?? 0.7;

  switch (provider) {
    case "openai":
    case "grok":
      return streamOpenAICompatible(provider, apiKey, model, messages, maxTokens, temperature, onToken);
    case "gemini":
      return streamGemini(apiKey, model, messages, maxTokens, temperature, onToken);
    case "anthropic":
      return streamAnthropic(apiKey, model, messages, maxTokens, temperature, onToken);
    case "azure-foundry":
      return streamAzureFoundry(config.baseUrl!, apiKey, model, messages, maxTokens, temperature, onToken);
    default:
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `サポートされていないAIプロバイダー: ${provider}`,
      });
  }
}

/** Parse SSE lines from a ReadableStream, calling dataHandler for each `data:` line */
async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  dataHandler: (data: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data && data !== "[DONE]") {
            dataHandler(data);
          }
        }
      }
    }
    // Process remaining buffer
    if (buffer.startsWith("data: ")) {
      const data = buffer.slice(6).trim();
      if (data && data !== "[DONE]") {
        dataHandler(data);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function streamOpenAICompatible(
  provider: string,
  apiKey: string,
  model: string,
  messages: Message[],
  maxTokens: number,
  temperature: number,
  onToken: (token: string) => void,
): Promise<string> {
  const baseUrl = provider === "grok" ? "https://api.x.ai" : "https://api.openai.com";
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, stream: true }),
  });
  if (!res.ok) {
    const err = await res.text();
    wrapLLMError(provider, res.status, err);
  }
  let full = "";
  await parseSSEStream(res.body!, (data) => {
    try {
      const json = JSON.parse(data);
      const token = json.choices?.[0]?.delta?.content;
      if (token) { full += token; onToken(token); }
    } catch {}
  });
  return full;
}

async function streamGemini(
  apiKey: string,
  model: string,
  messages: Message[],
  maxTokens: number,
  temperature: number,
  onToken: (token: string) => void,
): Promise<string> {
  const systemInstruction = messages.find(m => m.role === "system")?.content;
  const contents = messages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const body: any = { contents, generationConfig: { maxOutputTokens: maxTokens, temperature } };
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!res.ok) {
    const err = await res.text();
    wrapLLMError("gemini", res.status, err);
  }
  let full = "";
  await parseSSEStream(res.body!, (data) => {
    try {
      const json = JSON.parse(data);
      const token = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (token) { full += token; onToken(token); }
    } catch {}
  });
  return full;
}

async function streamAnthropic(
  apiKey: string,
  model: string,
  messages: Message[],
  maxTokens: number,
  temperature: number,
  onToken: (token: string) => void,
): Promise<string> {
  const systemMsg = messages.find(m => m.role === "system")?.content;
  const chatMessages = messages.filter(m => m.role !== "system").map(m => ({ role: m.role, content: m.content }));
  const body: any = { model, messages: chatMessages, max_tokens: maxTokens, temperature, stream: true };
  if (systemMsg) body.system = systemMsg;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    wrapLLMError("anthropic", res.status, err);
  }
  let full = "";
  // Anthropic SSE has event: lines before data: lines
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (!data) continue;
          try {
            const json = JSON.parse(data);
            if (json.type === "content_block_delta") {
              const token = json.delta?.text;
              if (token) { full += token; onToken(token); }
            }
          } catch {}
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return full;
}

async function streamAzureFoundry(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Message[],
  maxTokens: number,
  temperature: number,
  onToken: (token: string) => void,
): Promise<string> {
  const url = `${baseUrl}/openai/deployments/${model}/chat/completions?api-version=2024-12-01-preview`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({ messages, max_tokens: maxTokens, temperature, stream: true }),
  });
  if (!res.ok) {
    const err = await res.text();
    wrapLLMError("azure-foundry", res.status, err);
  }
  let full = "";
  await parseSSEStream(res.body!, (data) => {
    try {
      const json = JSON.parse(data);
      const token = json.choices?.[0]?.delta?.content;
      if (token) { full += token; onToken(token); }
    } catch {}
  });
  return full;
}

/**
 * Get the user's preferred LLM config from the database.
 * Falls back to Azure AI Foundry (Kimi-K2.5) if user has no keys configured.
 */
export async function getUserLLMConfig(
  db: D1Database,
  userId: number,
  feature = "chat",
  env?: { AZURE_FOUNDRY_API_KEY?: string; AZURE_FOUNDRY_RESOURCE?: string }
): Promise<LLMConfig | null> {
  // Check if user has a provider preference for this feature
  const pref = await db
    .prepare(`SELECT provider, model FROM ai_provider_settings WHERE userId=? AND feature=? AND isActive=1`)
    .bind(userId, feature)
    .first<any>();

  const preferredProvider = pref?.provider;
  const preferredModel = pref?.model;

  // Get all user's API keys
  const configs = await db
    .prepare(`SELECT provider, apiKey FROM ai_api_configs WHERE userId=? AND isActive=1`)
    .bind(userId)
    .all<any>();

  const keys = new Map<string, string>();
  for (const c of configs.results ?? []) {
    keys.set(c.provider, c.apiKey);
  }

  // Try preferred provider first
  if (preferredProvider && keys.has(preferredProvider)) {
    return { provider: preferredProvider, apiKey: keys.get(preferredProvider)!, model: preferredModel || undefined };
  }

  // Fall back to any available provider in priority order
  for (const provider of ["gemini", "openai", "anthropic", "grok"]) {
    if (keys.has(provider)) {
      return { provider, apiKey: keys.get(provider)! };
    }
  }

  // Fall back to Azure AI Foundry (Kimi-K2.5)
  if (env?.AZURE_FOUNDRY_API_KEY && env?.AZURE_FOUNDRY_RESOURCE) {
    return {
      provider: "azure-foundry",
      apiKey: env.AZURE_FOUNDRY_API_KEY,
      model: "Kimi-K2.5",
      baseUrl: `https://${env.AZURE_FOUNDRY_RESOURCE}.services.ai.azure.com`,
    };
  }

  return null;
}
