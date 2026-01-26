import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useParams, useLocation } from "wouter";
import { 
  ArrowLeft,
  CreditCard, 
  Building2,
  User,
  Star,
  Calendar,
  Copy,
  QrCode,
  Smartphone,
  ExternalLink,
  Check,
  Share2,
  Mail,
  Phone,
  Globe,
  MapPin,
  Download
} from "lucide-react";

// カードタイプの定義
const CARD_TYPES = {
  business_card: { label: "名刺", icon: CreditCard, color: "bg-blue-500" },
  shop_card: { label: "ショップカード", icon: Building2, color: "bg-green-500" },
  idol_sign: { label: "サイン", icon: Star, color: "bg-purple-500" },
  membership: { label: "メンバーシップ", icon: User, color: "bg-orange-500" },
  event: { label: "イベント", icon: Calendar, color: "bg-pink-500" },
  other: { label: "その他", icon: CreditCard, color: "bg-gray-500" },
} as const;

type CardType = keyof typeof CARD_TYPES;

export default function CardShare() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [copied, setCopied] = useState<string | null>(null);

  // カード情報を取得
  const { data: card, isLoading } = trpc.cards.getOwnedCardById.useQuery(
    { id: Number(id) },
    { enabled: !!id }
  );

  // 共有URL
  const shareUrl = card ? `${window.location.origin}/card/get/${card.code}` : "";

  // コピー機能
  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    toast.success("コピーしました");
    setTimeout(() => setCopied(null), 2000);
  };

  // QRコードURL（Google Chart APIを使用）
  const qrCodeUrl = shareUrl ? 
    `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(shareUrl)}` : "";

  // QRコードをダウンロード
  const downloadQRCode = async () => {
    if (!qrCodeUrl) return;
    
    try {
      const response = await fetch(qrCodeUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${card?.title || 'card'}-qrcode.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success("QRコードをダウンロードしました");
    } catch (error) {
      toast.error("ダウンロードに失敗しました");
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  if (!card) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-[400px]">
          <CreditCard className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">カードが見つかりません</h2>
          <Button className="mt-4" onClick={() => navigate("/cards/my")}>
            マイカードへ戻る
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const cardType = CARD_TYPES[card.cardType as CardType] || CARD_TYPES.other;
  const CardIcon = cardType.icon;

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* ヘッダー */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate("/cards/my")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            戻る
          </Button>
          <div>
            <h1 className="text-2xl font-bold">名刺を共有</h1>
            <p className="text-muted-foreground">
              QRコードやNFCで名刺を共有しましょう
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* 左側：カードプレビュー */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg ${cardType.color}`}>
                  <CardIcon className="h-4 w-4 text-white" />
                </div>
                <Badge variant="secondary">{cardType.label}</Badge>
              </div>
              <CardTitle className="mt-3">{card.title}</CardTitle>
              {card.subtitle && (
                <CardDescription>{card.subtitle}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {/* カード画像 */}
              {card.imageUrl ? (
                <div className="aspect-video rounded-lg overflow-hidden bg-muted">
                  <img 
                    src={card.imageUrl} 
                    alt={card.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="aspect-video rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                  <CardIcon className="h-16 w-16 text-primary/40" />
                </div>
              )}

              {/* 連絡先情報 */}
              {card.contactInfo && (
                <div className="space-y-2 pt-4 border-t">
                  {card.contactInfo.email && (
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span>{card.contactInfo.email}</span>
                    </div>
                  )}
                  {card.contactInfo.phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span>{card.contactInfo.phone}</span>
                    </div>
                  )}
                  {card.contactInfo.website && (
                    <div className="flex items-center gap-2 text-sm">
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      <span>{card.contactInfo.website}</span>
                    </div>
                  )}
                  {card.contactInfo.address && (
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span>{card.contactInfo.address}</span>
                    </div>
                  )}
                </div>
              )}

              {/* ビジネス情報 */}
              {card.businessInfo?.company && (
                <div className="pt-4 border-t">
                  <div className="flex items-center gap-2 text-sm">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span>{card.businessInfo.company}</span>
                    {card.businessInfo.position && (
                      <span className="text-muted-foreground">/ {card.businessInfo.position}</span>
                    )}
                  </div>
                </div>
              )}

              {/* 統計 */}
              <div className="pt-4 border-t flex items-center justify-between text-sm text-muted-foreground">
                <span>スキャン: {card.totalScans}</span>
                <span>保存: {card.totalSaves}</span>
              </div>
            </CardContent>
          </Card>

          {/* 右側：共有方法 */}
          <div className="space-y-6">
            <Tabs defaultValue="qr">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="qr">
                  <QrCode className="mr-2 h-4 w-4" />
                  QRコード
                </TabsTrigger>
                <TabsTrigger value="nfc">
                  <Smartphone className="mr-2 h-4 w-4" />
                  NFC設定
                </TabsTrigger>
              </TabsList>

              {/* QRコード */}
              <TabsContent value="qr" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">QRコードで共有</CardTitle>
                    <CardDescription>
                      このQRコードをスキャンすると名刺を取得できます
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* QRコード表示 */}
                    <div className="flex justify-center">
                      <div className="bg-white p-4 rounded-lg">
                        <img 
                          src={qrCodeUrl} 
                          alt="QRコード"
                          className="w-48 h-48"
                        />
                      </div>
                    </div>

                    {/* ダウンロードボタン */}
                    <Button variant="outline" className="w-full" onClick={downloadQRCode}>
                      <Download className="mr-2 h-4 w-4" />
                      QRコードをダウンロード
                    </Button>
                  </CardContent>
                </Card>

                {/* 共有URL */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">共有URL</CardTitle>
                    <CardDescription>
                      このURLを共有すると名刺を取得できます
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-2">
                      <div className="flex-1 p-3 bg-muted rounded-lg font-mono text-sm break-all">
                        {shareUrl}
                      </div>
                      <Button 
                        variant="outline" 
                        size="icon"
                        onClick={() => copyToClipboard(shareUrl, "url")}
                      >
                        {copied === "url" ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>

                    {/* カードコード */}
                    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div>
                        <p className="text-xs text-muted-foreground">カードコード</p>
                        <p className="font-mono font-bold">{card.code}</p>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => copyToClipboard(card.code, "code")}
                      >
                        {copied === "code" ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* NFC設定 */}
              <TabsContent value="nfc" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">NFC名刺の設定方法</CardTitle>
                    <CardDescription>
                      NFC対応のカードやシールに書き込む方法
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* ステップ1 */}
                    <div className="flex gap-4">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                        1
                      </div>
                      <div>
                        <h4 className="font-semibold">NFCライターアプリをインストール</h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          スマートフォンに「NFC Tools」などのNFCライターアプリをインストールします。
                        </p>
                        <div className="flex gap-2 mt-2">
                          <Button variant="outline" size="sm" asChild>
                            <a href="https://apps.apple.com/app/nfc-tools/id1252962749" target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="mr-2 h-3 w-3" />
                              iOS
                            </a>
                          </Button>
                          <Button variant="outline" size="sm" asChild>
                            <a href="https://play.google.com/store/apps/details?id=com.wakdev.wdnfc" target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="mr-2 h-3 w-3" />
                              Android
                            </a>
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* ステップ2 */}
                    <div className="flex gap-4">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                        2
                      </div>
                      <div>
                        <h4 className="font-semibold">書き込むURLをコピー</h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          以下のURLをコピーしてください。
                        </p>
                        <div className="flex gap-2 mt-2">
                          <div className="flex-1 p-2 bg-muted rounded text-xs font-mono break-all">
                            {shareUrl}
                          </div>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => copyToClipboard(shareUrl, "nfc-url")}
                          >
                            {copied === "nfc-url" ? (
                              <Check className="h-4 w-4 text-green-500" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* ステップ3 */}
                    <div className="flex gap-4">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                        3
                      </div>
                      <div>
                        <h4 className="font-semibold">NFCタグに書き込み</h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          NFC Toolsアプリで「Write」→「Add a record」→「URL/URI」を選択し、コピーしたURLを貼り付けてNFCタグに書き込みます。
                        </p>
                      </div>
                    </div>

                    {/* ステップ4 */}
                    <div className="flex gap-4">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                        4
                      </div>
                      <div>
                        <h4 className="font-semibold">完了！</h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          これでNFC名刺の設定は完了です。相手がスマホをかざすと、あなたの名刺ページが開きます。
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* NFCタグの購入案内 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">NFCタグの入手方法</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">
                      NFCタグは以下のような場所で購入できます：
                    </p>
                    <ul className="space-y-2 text-sm">
                      <li className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-green-500" />
                        Amazon、楽天などのECサイト（「NFC タグ」で検索）
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-green-500" />
                        家電量販店のスマートフォンアクセサリーコーナー
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-green-500" />
                        100円ショップ（一部店舗）
                      </li>
                    </ul>
                    <p className="text-xs text-muted-foreground mt-4">
                      ※ NTAG213、NTAG215、NTAG216などのNTAGシリーズがおすすめです
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
