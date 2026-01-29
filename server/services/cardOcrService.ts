/**
 * Card OCR Service
 * Gemini Vision APIを使用してカード画像からテキストを抽出・解析
 */

import { invokeLLM } from "../_core/llm";
import { cardTypes, CardType } from "../../drizzle/schema";

// カードタイプを検出するプロンプト
const CARD_TYPE_DETECTION_PROMPT = `
あなたは画像解析の専門家です。
提供された画像を分析し、どのタイプのカードかを判定してください。

以下のカードタイプから最も適切なものを選んでください：
- business_card: 名刺（会社名、名前、連絡先が記載されたビジネスカード）
- point_card: ポイントカード（店舗のポイントカード、スタンプカード）
- membership_card: 会員証（各種会員証、メンバーシップカード）
- medical_card: 診察券（病院・クリニックの診察券）
- insurance_card: 保険証（健康保険証、各種保険証）
- student_id: 学生証（学生証、学生ID）
- employee_id: 社員証（社員証、従業員ID）
- library_card: 図書館カード（図書館の利用カード）
- credit_card: クレジットカード（クレジットカード、デビットカード）
- other: その他のカード

JSON形式で回答してください：
{
  "cardType": "検出されたカードタイプ",
  "confidence": 0-100の信頼度,
  "reason": "判定理由"
}
`;

// カード情報抽出プロンプト（カードタイプ別）
const EXTRACTION_PROMPTS: Record<string, string> = {
  business_card: `
この名刺から以下の情報を抽出してください：
- name: 氏名
- nameKana: ふりがな（あれば）
- company: 会社名
- companyKana: 会社名のふりがな（あれば）
- position: 役職
- department: 部署
- email: メールアドレス
- phone: 電話番号
- mobile: 携帯電話番号
- fax: FAX番号
- address: 住所
- postalCode: 郵便番号
- website: ウェブサイト

JSON形式で回答してください。情報がない場合はnullを設定してください。
`,
  point_card: `
このポイントカードから以下の情報を抽出してください：
- storeName: 店舗名
- memberNumber: 会員番号
- memberName: 会員名（あれば）
- expiryDate: 有効期限
- barcode: バーコード番号（あれば）

JSON形式で回答してください。情報がない場合はnullを設定してください。
`,
  membership_card: `
この会員証から以下の情報を抽出してください：
- organizationName: 組織名
- memberNumber: 会員番号
- memberName: 会員名
- membershipType: 会員種別
- expiryDate: 有効期限

JSON形式で回答してください。情報がない場合はnullを設定してください。
`,
  medical_card: `
この診察券から以下の情報を抽出してください：
- hospitalName: 病院名
- patientNumber: 患者番号
- patientName: 患者名
- department: 診療科
- phone: 電話番号

JSON形式で回答してください。情報がない場合はnullを設定してください。
`,
  insurance_card: `
この保険証から以下の情報を抽出してください：
- insurerName: 保険者名
- insurerNumber: 保険者番号
- insuredNumber: 被保険者番号
- insuredName: 被保険者名
- expiryDate: 有効期限

JSON形式で回答してください。情報がない場合はnullを設定してください。
`,
  student_id: `
この学生証から以下の情報を抽出してください：
- schoolName: 学校名
- studentNumber: 学籍番号
- studentName: 学生名
- department: 学部・学科
- expiryDate: 有効期限

JSON形式で回答してください。情報がない場合はnullを設定してください。
`,
  employee_id: `
この社員証から以下の情報を抽出してください：
- companyName: 会社名
- employeeNumber: 社員番号
- employeeName: 社員名
- department: 部署
- position: 役職

JSON形式で回答してください。情報がない場合はnullを設定してください。
`,
  library_card: `
この図書館カードから以下の情報を抽出してください：
- libraryName: 図書館名
- memberNumber: 利用者番号
- memberName: 利用者名
- expiryDate: 有効期限

JSON形式で回答してください。情報がない場合はnullを設定してください。
`,
  credit_card: `
このクレジットカードから以下の情報を抽出してください（セキュリティのため一部情報のみ）：
- cardBrand: カードブランド（VISA, Mastercard, JCB等）
- lastFourDigits: カード番号の下4桁
- cardholderName: カード名義人
- expiryDate: 有効期限（MM/YY形式）

JSON形式で回答してください。情報がない場合はnullを設定してください。
注意：カード番号の全桁は抽出しないでください。
`,
  other: `
このカードから読み取れる情報を抽出してください：
- title: カードのタイトルや名称
- description: カードの説明
- notes: その他の重要な情報

JSON形式で回答してください。情報がない場合はnullを設定してください。
`,
};

/**
 * カード画像を解析して情報を抽出
 */
export async function analyzeCardImage(
  imageUrl: string,
  suggestedCardType?: string
): Promise<{
  success: boolean;
  cardType: string;
  extractedData: Record<string, string | null>;
  rawText: string;
  confidence: number;
  error?: string;
}> {
  try {
    // 1. カードタイプを検出（指定がない場合）
    let cardType = suggestedCardType;
    let typeConfidence = 100;
    
    if (!cardType) {
      const typeDetectionResult = await invokeLLM({
        messages: [
          { role: "system", content: CARD_TYPE_DETECTION_PROMPT },
          { 
            role: "user", 
            content: [
              { type: "text", text: "この画像のカードタイプを判定してください。" },
              { type: "image_url", image_url: { url: imageUrl } }
            ]
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "card_type_detection",
            strict: true,
            schema: {
              type: "object",
              properties: {
                cardType: { type: "string" },
                confidence: { type: "number" },
                reason: { type: "string" }
              },
              required: ["cardType", "confidence", "reason"],
              additionalProperties: false
            }
          }
        }
      });
      
      const typeContent = typeDetectionResult.choices[0]?.message?.content;
      if (typeContent && typeof typeContent === 'string') {
        const parsed = JSON.parse(typeContent);
        cardType = parsed.cardType;
        typeConfidence = parsed.confidence;
      }
    }
    
    // デフォルトは名刺
    if (!cardType || !EXTRACTION_PROMPTS[cardType]) {
      cardType = "business_card";
    }
    
    // 2. カード情報を抽出
    const extractionPrompt = EXTRACTION_PROMPTS[cardType];
    
    const extractionResult = await invokeLLM({
      messages: [
        { role: "system", content: `あなたはOCR（光学文字認識）の専門家です。画像から正確にテキストを読み取り、構造化されたデータとして抽出します。\n\n${extractionPrompt}` },
        { 
          role: "user", 
          content: [
            { type: "text", text: "この画像から情報を抽出してください。" },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        }
      ]
    });
    
    const extractionContent = extractionResult.choices[0]?.message?.content;
    
    if (!extractionContent || typeof extractionContent !== 'string') {
      return {
        success: false,
        cardType,
        extractedData: {},
        rawText: "",
        confidence: 0,
        error: "情報の抽出に失敗しました"
      };
    }
    
    // JSONを抽出（マークダウンコードブロックを考慮）
    let extractedData: Record<string, string | null> = {};
    const rawText: string = extractionContent;
    
    try {
      // ```json ... ``` 形式を処理
      const jsonMatch = extractionContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : extractionContent;
      extractedData = JSON.parse(jsonStr);
    } catch {
      // JSONパースに失敗した場合は生テキストとして保存
      extractedData = { rawText: extractionContent };
    }
    
    return {
      success: true,
      cardType,
      extractedData,
      rawText,
      confidence: typeConfidence
    };
    
  } catch (error) {
    console.error("[CardOCR] Error analyzing image:", error);
    return {
      success: false,
      cardType: suggestedCardType || "other",
      extractedData: {},
      rawText: "",
      confidence: 0,
      error: error instanceof Error ? error.message : "画像解析中にエラーが発生しました"
    };
  }
}

/**
 * 抽出データからカードタイトルを生成
 */
export function generateCardTitle(cardType: string, extractedData: Record<string, string | null>): string {
  switch (cardType) {
    case "business_card":
      const name = extractedData.name || "";
      const company = extractedData.company || "";
      if (name && company) return `${name} - ${company}`;
      return name || company || "名刺";
      
    case "point_card":
      return extractedData.storeName || "ポイントカード";
      
    case "membership_card":
      return extractedData.organizationName || "会員証";
      
    case "medical_card":
      return extractedData.hospitalName || "診察券";
      
    case "insurance_card":
      return extractedData.insurerName || "保険証";
      
    case "student_id":
      return extractedData.schoolName || "学生証";
      
    case "employee_id":
      return extractedData.companyName || "社員証";
      
    case "library_card":
      return extractedData.libraryName || "図書館カード";
      
    case "credit_card":
      const brand = extractedData.cardBrand || "";
      const last4 = extractedData.lastFourDigits || "";
      if (brand && last4) return `${brand} ****${last4}`;
      return brand || "クレジットカード";
      
    default:
      return extractedData.title || "カード";
  }
}
