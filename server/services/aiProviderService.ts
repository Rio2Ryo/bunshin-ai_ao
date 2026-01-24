/**
 * AIプロバイダー切り替えサービス
 * 開発者側で場面に応じてAIバックエンドを切り替え可能
 */

import { ENV } from "../_core/env";
import type { Message, InvokeParams, InvokeResult, Tool, ToolChoice, ResponseFormat } from "../_core/llm";

// AIプロバイダーの種類
export type AIProvider = 
  | 'manus'      // Manus内蔵LLM（デフォルト）
  | 'gemini'     // Google Gemini
  | 'openai'     // OpenAI (ChatGPT)
  | 'anthropic'  // Anthropic (Claude)
  | 'grok';      // xAI Grok

// 機能カテゴリ（場面別にプロバイダーを設定可能）
export type AIFeature = 
  | 'chat'              // 分身AIとの会話
  | 'personality'       // 性格診断（ビッグファイブ、MBTI）
  | 'value_scenario'    // 価値観シナリオ評価
  | 'matching'          // マッチング分析
  | 'memory'            // 記憶・要約
  | 'prediction'        // 友達予測
  | 'default';          // デフォルト

// プロバイダー設定
interface ProviderConfig {
  provider: AIProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
}

// 機能別プロバイダー設定（開発者が設定）
const featureProviderConfig: Record<AIFeature, ProviderConfig> = {
  // デフォルトはManus内蔵LLM
  default: { provider: 'manus' },
  
  // 会話はManus（バランスが良い）
  chat: { provider: 'manus' },
  
  // 性格診断はGemini（分析力が高い）
  personality: { provider: 'manus' },
  
  // 価値観シナリオはManus
  value_scenario: { provider: 'manus' },
  
  // マッチング分析はManus
  matching: { provider: 'manus' },
  
  // 記憶・要約はManus
  memory: { provider: 'manus' },
  
  // 友達予測はManus
  prediction: { provider: 'manus' },
};

// プロバイダー別のモデル設定
const providerModels: Record<AIProvider, string> = {
  manus: 'gemini-2.5-flash',
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-20241022',
  grok: 'grok-3',
};

// プロバイダー別のAPIエンドポイント
const providerEndpoints: Record<AIProvider, string> = {
  manus: 'https://forge.manus.im/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  grok: 'https://api.x.ai/v1/chat/completions',
};

/**
 * 機能別のプロバイダー設定を取得
 */
export function getProviderForFeature(feature: AIFeature): ProviderConfig {
  return featureProviderConfig[feature] || featureProviderConfig.default;
}

/**
 * 機能別のプロバイダー設定を更新（開発者用）
 */
export function setProviderForFeature(feature: AIFeature, config: ProviderConfig): void {
  featureProviderConfig[feature] = config;
}

/**
 * 全機能のプロバイダー設定を取得
 */
export function getAllProviderSettings(): Record<AIFeature, ProviderConfig> {
  return { ...featureProviderConfig };
}

/**
 * プロバイダー別のAPIキーを取得
 */
function getApiKeyForProvider(provider: AIProvider): string {
  switch (provider) {
    case 'manus':
      return ENV.forgeApiKey || '';
    case 'gemini':
      return process.env.GEMINI_API_KEY || ENV.forgeApiKey || '';
    case 'openai':
      return process.env.OPENAI_API_KEY || '';
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY || '';
    case 'grok':
      return process.env.XAI_API_KEY || '';
    default:
      return ENV.forgeApiKey || '';
  }
}

/**
 * メッセージをプロバイダー形式に変換
 */
function normalizeMessage(message: Message): Record<string, unknown> {
  const { role, content, name, tool_call_id } = message;
  
  if (role === 'tool' || role === 'function') {
    const contentStr = Array.isArray(content)
      ? content.map(part => (typeof part === 'string' ? part : JSON.stringify(part))).join('\n')
      : typeof content === 'string' ? content : JSON.stringify(content);
    
    return { role, name, tool_call_id, content: contentStr };
  }
  
  const contentParts = Array.isArray(content) ? content : [content];
  const normalizedParts = contentParts.map(part => {
    if (typeof part === 'string') return { type: 'text', text: part };
    return part;
  });
  
  if (normalizedParts.length === 1 && normalizedParts[0].type === 'text') {
    return { role, name, content: (normalizedParts[0] as { type: 'text'; text: string }).text };
  }
  
  return { role, name, content: normalizedParts };
}

/**
 * Anthropic Claude用のメッセージ変換
 */
function convertToAnthropicFormat(messages: Message[]): { system?: string; messages: Array<Record<string, unknown>> } {
  let systemPrompt: string | undefined;
  const anthropicMessages: Array<Record<string, unknown>> = [];
  
  for (const msg of messages) {
    if (msg.role === 'system') {
      const content = Array.isArray(msg.content) 
        ? msg.content.map(c => typeof c === 'string' ? c : (c as { text?: string }).text || '').join('\n')
        : typeof msg.content === 'string' ? msg.content : '';
      systemPrompt = systemPrompt ? `${systemPrompt}\n${content}` : content;
    } else {
      anthropicMessages.push(normalizeMessage(msg));
    }
  }
  
  return { system: systemPrompt, messages: anthropicMessages };
}

/**
 * Anthropicのレスポンスを標準形式に変換
 */
function convertAnthropicResponse(response: Record<string, unknown>): InvokeResult {
  const content = response.content as Array<{ type: string; text?: string }>;
  const textContent = content?.find(c => c.type === 'text')?.text || '';
  
  return {
    id: response.id as string,
    created: Date.now(),
    model: response.model as string,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: textContent,
      },
      finish_reason: response.stop_reason as string || 'stop',
    }],
    usage: response.usage ? {
      prompt_tokens: (response.usage as { input_tokens: number }).input_tokens,
      completion_tokens: (response.usage as { output_tokens: number }).output_tokens,
      total_tokens: ((response.usage as { input_tokens: number }).input_tokens || 0) + 
                   ((response.usage as { output_tokens: number }).output_tokens || 0),
    } : undefined,
  };
}

/**
 * 統一LLM呼び出し関数（機能別にプロバイダーを自動選択）
 */
export async function invokeLLMWithProvider(
  params: InvokeParams,
  feature: AIFeature = 'default'
): Promise<InvokeResult> {
  const config = getProviderForFeature(feature);
  const provider = config.provider;
  const apiKey = config.apiKey || getApiKeyForProvider(provider);
  const model = config.model || providerModels[provider];
  const baseUrl = config.baseUrl || providerEndpoints[provider];
  
  if (!apiKey) {
    throw new Error(`API key not configured for provider: ${provider}`);
  }
  
  const { messages, tools, toolChoice, tool_choice, responseFormat, response_format, maxTokens, max_tokens } = params;
  
  // Anthropic Claude は別形式
  if (provider === 'anthropic') {
    return invokeAnthropic(messages, model, apiKey, maxTokens || max_tokens, responseFormat || response_format);
  }
  
  // OpenAI互換API（Manus, Gemini, OpenAI, Grok）
  const payload: Record<string, unknown> = {
    model,
    messages: messages.map(normalizeMessage),
  };
  
  if (tools && tools.length > 0) {
    payload.tools = tools;
  }
  
  const tc = toolChoice || tool_choice;
  if (tc) {
    if (tc === 'required' && tools && tools.length === 1) {
      payload.tool_choice = { type: 'function', function: { name: tools[0].function.name } };
    } else if (typeof tc === 'object' && 'name' in tc) {
      payload.tool_choice = { type: 'function', function: { name: tc.name } };
    } else {
      payload.tool_choice = tc;
    }
  }
  
  payload.max_tokens = maxTokens || max_tokens || config.maxTokens || 32768;
  
  // Manus特有の設定
  if (provider === 'manus') {
    payload.thinking = { budget_tokens: 128 };
  }
  
  const rf = responseFormat || response_format;
  if (rf) {
    payload.response_format = rf;
  }
  
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM invoke failed (${provider}): ${response.status} ${response.statusText} – ${errorText}`);
  }
  
  return (await response.json()) as InvokeResult;
}

/**
 * Anthropic Claude専用呼び出し
 */
async function invokeAnthropic(
  messages: Message[],
  model: string,
  apiKey: string,
  maxTokens?: number,
  responseFormat?: ResponseFormat
): Promise<InvokeResult> {
  const { system, messages: anthropicMessages } = convertToAnthropicFormat(messages);
  
  const payload: Record<string, unknown> = {
    model,
    max_tokens: maxTokens || 4096,
    messages: anthropicMessages,
  };
  
  if (system) {
    payload.system = system;
  }
  
  const response = await fetch(providerEndpoints.anthropic, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic invoke failed: ${response.status} ${response.statusText} – ${errorText}`);
  }
  
  const result = await response.json();
  return convertAnthropicResponse(result as Record<string, unknown>);
}

/**
 * フォールバック付きLLM呼び出し
 * プライマリプロバイダーが失敗した場合、フォールバックプロバイダーを試行
 */
export async function invokeLLMWithFallback(
  params: InvokeParams,
  feature: AIFeature = 'default',
  fallbackProviders: AIProvider[] = ['manus']
): Promise<InvokeResult> {
  try {
    return await invokeLLMWithProvider(params, feature);
  } catch (error) {
    console.error(`Primary provider failed for feature ${feature}:`, error);
    
    for (const fallbackProvider of fallbackProviders) {
      try {
        console.log(`Trying fallback provider: ${fallbackProvider}`);
        const fallbackConfig: ProviderConfig = { provider: fallbackProvider };
        const originalConfig = featureProviderConfig[feature];
        featureProviderConfig[feature] = fallbackConfig;
        
        const result = await invokeLLMWithProvider(params, feature);
        
        // 元の設定に戻す
        featureProviderConfig[feature] = originalConfig;
        return result;
      } catch (fallbackError) {
        console.error(`Fallback provider ${fallbackProvider} also failed:`, fallbackError);
      }
    }
    
    throw new Error(`All providers failed for feature ${feature}`);
  }
}

/**
 * 利用可能なプロバイダー一覧を取得
 */
export function getAvailableProviders(): Array<{ provider: AIProvider; available: boolean; reason?: string }> {
  const providers: AIProvider[] = ['manus', 'gemini', 'openai', 'anthropic', 'grok'];
  
  return providers.map(provider => {
    const apiKey = getApiKeyForProvider(provider);
    return {
      provider,
      available: !!apiKey,
      reason: apiKey ? undefined : 'API key not configured',
    };
  });
}

/**
 * プロバイダーの接続テスト
 */
export async function testProvider(provider: AIProvider): Promise<{ success: boolean; latency?: number; error?: string }> {
  const startTime = Date.now();
  
  try {
    const testParams: InvokeParams = {
      messages: [{ role: 'user', content: 'Hello, respond with just "OK"' }],
    };
    
    // 一時的にプロバイダーを設定してテスト
    const originalConfig = featureProviderConfig.default;
    featureProviderConfig.default = { provider };
    
    await invokeLLMWithProvider(testParams, 'default');
    
    featureProviderConfig.default = originalConfig;
    
    return {
      success: true,
      latency: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
