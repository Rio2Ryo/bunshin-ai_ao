/**
 * Web検索サービス
 * マッチング対話中に世の中の情報を検索して反映する
 */

import { invokeLLM } from "../_core/llm";

interface SearchResult {
  title: string;
  snippet: string;
  url?: string;
}

export interface WebSearchResponse {
  query: string;
  results: SearchResult[];
  summary: string;
}

/**
 * 対話コンテキストから検索クエリを生成
 */
export async function generateSearchQuery(
  dialogueContext: string,
  topic: string
): Promise<string[]> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `あなたはビジネスマッチングの対話を分析し、有用な情報を検索するためのクエリを生成する専門家です。
対話の文脈から、具体的なビジネス提案や協業に役立つ情報を検索するためのクエリを3つ生成してください。`
      },
      {
        role: "user",
        content: `【対話テーマ】
${topic}

【対話内容】
${dialogueContext}

この対話をより具体的で実現可能なものにするために、検索すべき情報のクエリを3つ生成してください。
市場規模、競合情報、成功事例、技術トレンド、規制情報などを考慮してください。`
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "search_queries",
        strict: true,
        schema: {
          type: "object",
          properties: {
            queries: {
              type: "array",
              items: { type: "string" },
              description: "検索クエリ（3つ）"
            },
            reasoning: {
              type: "string",
              description: "なぜこれらのクエリが有用か"
            }
          },
          required: ["queries", "reasoning"],
          additionalProperties: false
        }
      }
    }
  });

  const rawContent = response.choices[0]?.message?.content;
  const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
  if (!content) {
    return [];
  }

  const result = JSON.parse(content);
  return result.queries || [];
}

/**
 * LLMを使用してWeb検索をシミュレート
 * （実際のWeb検索APIがない場合のフォールバック）
 */
export async function searchWithLLM(
  query: string,
  context: string
): Promise<WebSearchResponse> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `あなたはビジネス情報の専門家です。
与えられたクエリに対して、最新のビジネストレンド、市場情報、成功事例などの知識を活用して、
具体的で実用的な情報を提供してください。

【重要】
- 具体的な数字（市場規模、成長率など）を含める
- 実在する企業や事例を参照する
- 最新のトレンドや技術動向を反映する
- 日本市場と世界市場の両方を考慮する`
      },
      {
        role: "user",
        content: `【検索クエリ】
${query}

【対話の文脈】
${context}

このクエリに関連する具体的なビジネス情報を提供してください。`
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "search_results",
        strict: true,
        schema: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string", description: "情報のタイトル" },
                  snippet: { type: "string", description: "情報の要約（100-200文字）" }
                },
                required: ["title", "snippet"],
                additionalProperties: false
              },
              description: "検索結果（3-5件）"
            },
            summary: {
              type: "string",
              description: "検索結果の総合的なまとめ（200-300文字）"
            }
          },
          required: ["results", "summary"],
          additionalProperties: false
        }
      }
    }
  });

  const rawContent = response.choices[0]?.message?.content;
  const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
  if (!content) {
    return {
      query,
      results: [],
      summary: "検索結果を取得できませんでした。"
    };
  }

  const result = JSON.parse(content);
  return {
    query,
    results: result.results || [],
    summary: result.summary || ""
  };
}

/**
 * 対話を強化するための情報を検索・統合
 */
export async function enhanceDialogueWithSearch(
  dialogueHistory: { speaker: string; content: string }[],
  topic: string,
  twin1Name: string,
  twin2Name: string
): Promise<{
  searchResults: WebSearchResponse[];
  enhancedContext: string;
}> {
  // 対話履歴をテキストに変換
  const dialogueText = dialogueHistory
    .map(d => `${d.speaker}: ${d.content}`)
    .join("\n");

  // 検索クエリを生成
  const queries = await generateSearchQuery(dialogueText, topic);

  // 各クエリで検索を実行
  const searchResults: WebSearchResponse[] = [];
  for (const query of queries.slice(0, 3)) {
    const result = await searchWithLLM(query, dialogueText);
    searchResults.push(result);
  }

  // 検索結果を統合したコンテキストを生成
  const enhancedContext = searchResults
    .map(r => `【${r.query}】\n${r.summary}`)
    .join("\n\n");

  return {
    searchResults,
    enhancedContext
  };
}

/**
 * 検索結果を対話に反映するためのプロンプト補強
 */
export function createSearchEnhancedPrompt(
  basePrompt: string,
  searchResults: WebSearchResponse[]
): string {
  if (searchResults.length === 0) {
    return basePrompt;
  }

  const searchContext = searchResults
    .map(r => {
      const resultsText = r.results
        .map(item => `- ${item.title}: ${item.snippet}`)
        .join("\n");
      return `【${r.query}に関する情報】\n${resultsText}\n\n要約: ${r.summary}`;
    })
    .join("\n\n---\n\n");

  return `${basePrompt}

【参考情報（Web検索結果）】
以下の情報を参考にして、より具体的で実現可能な提案をしてください：

${searchContext}

【重要】
- 上記の情報を活用して、具体的な数字や事例を含めた提案をしてください
- 市場規模や成長率などの具体的なデータを引用してください
- 成功事例を参考にした実現可能なアクションプランを提案してください`;
}
