/**
 * Stripe Products and Prices Configuration
 * 分身AI プラン定義
 */

export const PRODUCTS = {
  premium: {
    name: "分身AI プレミアムプラン",
    description: "友達50人、月30回マッチング、外部AI連携、カスタムオーケストレーション",
    features: [
      "分身AI 3体まで作成可能",
      "友達 50人まで追加可能",
      "月間マッチング 30回まで",
      "知識ベース 100件まで",
      "ファイルアップロード 50件まで（25MBまで）",
      "外部AI API連携",
      "カスタムオーケストレーション設定",
    ],
    priceMonthly: 980, // JPY
    priceYearly: 9800, // JPY (2ヶ月分お得)
  },
  enterprise: {
    name: "分身AI エンタープライズプラン",
    description: "無制限の機能、優先サポート、カスタム機能",
    features: [
      "分身AI 無制限",
      "友達 無制限",
      "月間マッチング 無制限",
      "知識ベース 無制限",
      "ファイルアップロード 無制限（100MBまで）",
      "外部AI API連携",
      "カスタムオーケストレーション設定",
      "優先サポート",
      "カスタム機能開発",
    ],
    priceMonthly: 4980, // JPY
    priceYearly: 49800, // JPY (2ヶ月分お得)
  },
} as const;

export type ProductKey = keyof typeof PRODUCTS;
export type BillingInterval = "monthly" | "yearly";

/**
 * Get price in cents/smallest currency unit for Stripe
 */
export function getPriceAmount(product: ProductKey, interval: BillingInterval): number {
  const productInfo = PRODUCTS[product];
  return interval === "monthly" ? productInfo.priceMonthly : productInfo.priceYearly;
}

/**
 * Get plan name from product key
 */
export function getPlanFromProduct(product: ProductKey): "premium" | "enterprise" {
  return product;
}
