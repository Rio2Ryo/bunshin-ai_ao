import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useLocation, useRoute } from "wouter";
import { 
  ArrowLeft,
  CreditCard, 
  Star, 
  StarOff, 
  Building2,
  User,
  Mail,
  Phone,
  Globe,
  MapPin,
  Twitter,
  Instagram,
  Facebook,
  Linkedin,
  MessageCircle,
  Copy,
  Share2,
  Edit,
  Trash2,
  ExternalLink,
  CheckCircle2
} from "lucide-react";

// カードタイプの定義
const CARD_TYPES = {
  business_card: { label: "名刺", icon: CreditCard, color: "bg-blue-500" },
  shop_card: { label: "ショップカード", icon: Building2, color: "bg-green-500" },
  idol_sign: { label: "サイン", icon: Star, color: "bg-purple-500" },
  membership: { label: "メンバーシップ", icon: User, color: "bg-orange-500" },
  event: { label: "イベント", icon: CreditCard, color: "bg-pink-500" },
  other: { label: "その他", icon: CreditCard, color: "bg-gray-500" },
} as const;

type CardType = keyof typeof CARD_TYPES;

export default function CardDetail() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/cards/:id");
  const cardId = params?.id ? parseInt(params.id) : null;
  
  const [memo, setMemo] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  // URLパラメータから取得状態を確認
  const urlParams = new URLSearchParams(window.location.search);
  const justAcquired = urlParams.get("acquired") === "true";
  const alreadyOwned = urlParams.get("already_owned") === "true";

  // カード一覧から該当カードを取得
  const { data: cards, isLoading, refetch } = trpc.cards.getMyCards.useQuery();
  
  const userCard = cards?.find(uc => uc.card.id === cardId);
  const card = userCard?.card;

  // メモを初期化
  useEffect(() => {
    if (userCard?.memo) {
      setMemo(userCard.memo);
    }
  }, [userCard?.memo]);

  // カードを更新
  const updateCardMutation = trpc.cards.updateUserCard.useMutation({
    onSuccess: () => {
      toast.success("保存しました");
      setIsEditing(false);
      refetch();
    },
    onError: (error) => {
      toast.error("エラー", { description: error.message });
    },
  });

  // カードを削除
  const removeCardMutation = trpc.cards.removeUserCard.useMutation({
    onSuccess: () => {
      toast.success("カードを削除しました");
      navigate("/cards");
    },
    onError: (error) => {
      toast.error("エラー", { description: error.message });
    },
  });

  // お気に入りを切り替え
  const toggleFavorite = () => {
    if (!cardId) return;
    updateCardMutation.mutate({
      cardId,
      isFavorite: userCard?.isFavorite !== 1,
    });
  };

  // メモを保存
  const saveMemo = () => {
    if (!cardId) return;
    updateCardMutation.mutate({
      cardId,
      memo,
    });
  };

  // URLをコピー
  const copyCardUrl = () => {
    if (!card) return;
    const url = `${window.location.origin}/api/card/get?code=${card.code}`;
    navigator.clipboard.writeText(url);
    toast.success("URLをコピーしました");
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </DashboardLayout>
    );
  }

  if (!card || !userCard) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center py-12">
          <CreditCard className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">カードが見つかりません</h3>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/cards")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            カード一覧に戻る
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const cardType = CARD_TYPES[card.cardType as CardType] || CARD_TYPES.other;
  const CardIcon = cardType.icon;
  const contactInfo = card.contactInfo as any;
  const businessInfo = card.businessInfo as any;
  const customFields = card.customFields as any[];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 取得完了メッセージ */}
        {justAcquired && (
          <Card className="border-green-500 bg-green-500/10">
            <CardContent className="flex items-center gap-3 py-4">
              <CheckCircle2 className="h-6 w-6 text-green-500" />
              <div>
                <p className="font-medium text-green-500">カードを取得しました！</p>
                <p className="text-sm text-muted-foreground">マイカードに追加されました</p>
              </div>
            </CardContent>
          </Card>
        )}

        {alreadyOwned && (
          <Card className="border-yellow-500 bg-yellow-500/10">
            <CardContent className="flex items-center gap-3 py-4">
              <Star className="h-6 w-6 text-yellow-500" />
              <div>
                <p className="font-medium text-yellow-500">このカードは既に取得済みです</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ヘッダー */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate("/cards")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            戻る
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={toggleFavorite}>
              {userCard.isFavorite === 1 ? (
                <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
              ) : (
                <StarOff className="h-4 w-4" />
              )}
            </Button>
            <Button variant="outline" size="icon" onClick={copyCardUrl}>
              <Copy className="h-4 w-4" />
            </Button>
            <Button 
              variant="outline" 
              size="icon" 
              className="text-destructive"
              onClick={() => {
                if (confirm("このカードを削除しますか？")) {
                  removeCardMutation.mutate({ cardId: card.id });
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* メインカード */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-lg ${cardType.color}`}>
                <CardIcon className="h-6 w-6 text-white" />
              </div>
              <div>
                <Badge variant="secondary" className="mb-2">{cardType.label}</Badge>
                <CardTitle className="text-2xl">{card.title}</CardTitle>
                {card.subtitle && (
                  <CardDescription className="text-lg">{card.subtitle}</CardDescription>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* カード画像 */}
            {card.imageUrl && (
              <div className="aspect-video rounded-lg overflow-hidden bg-muted">
                <img 
                  src={card.imageUrl} 
                  alt={card.title}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* 説明 */}
            {card.description && (
              <div>
                <h3 className="font-medium mb-2">説明</h3>
                <p className="text-muted-foreground whitespace-pre-wrap">{card.description}</p>
              </div>
            )}

            {/* ビジネス情報 */}
            {businessInfo && (businessInfo.company || businessInfo.position) && (
              <div>
                <h3 className="font-medium mb-3">ビジネス情報</h3>
                <div className="grid gap-2">
                  {businessInfo.company && (
                    <div className="flex items-center gap-3">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span>{businessInfo.company}</span>
                    </div>
                  )}
                  {businessInfo.department && (
                    <div className="flex items-center gap-3 ml-7">
                      <span className="text-muted-foreground">{businessInfo.department}</span>
                    </div>
                  )}
                  {businessInfo.position && (
                    <div className="flex items-center gap-3 ml-7">
                      <span>{businessInfo.position}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 連絡先情報 */}
            {contactInfo && (
              <div>
                <h3 className="font-medium mb-3">連絡先</h3>
                <div className="grid gap-2">
                  {contactInfo.email && (
                    <a 
                      href={`mailto:${contactInfo.email}`}
                      className="flex items-center gap-3 hover:text-primary transition-colors"
                    >
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span>{contactInfo.email}</span>
                    </a>
                  )}
                  {contactInfo.phone && (
                    <a 
                      href={`tel:${contactInfo.phone}`}
                      className="flex items-center gap-3 hover:text-primary transition-colors"
                    >
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span>{contactInfo.phone}</span>
                    </a>
                  )}
                  {contactInfo.website && (
                    <a 
                      href={contactInfo.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 hover:text-primary transition-colors"
                    >
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      <span>{contactInfo.website}</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {contactInfo.address && (
                    <div className="flex items-center gap-3">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span>{contactInfo.address}</span>
                    </div>
                  )}
                </div>

                {/* SNS */}
                {(contactInfo.twitter || contactInfo.instagram || contactInfo.facebook || contactInfo.linkedin || contactInfo.line) && (
                  <div className="flex items-center gap-3 mt-4">
                    {contactInfo.twitter && (
                      <a 
                        href={`https://twitter.com/${contactInfo.twitter}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
                      >
                        <Twitter className="h-5 w-5" />
                      </a>
                    )}
                    {contactInfo.instagram && (
                      <a 
                        href={`https://instagram.com/${contactInfo.instagram}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
                      >
                        <Instagram className="h-5 w-5" />
                      </a>
                    )}
                    {contactInfo.facebook && (
                      <a 
                        href={`https://facebook.com/${contactInfo.facebook}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
                      >
                        <Facebook className="h-5 w-5" />
                      </a>
                    )}
                    {contactInfo.linkedin && (
                      <a 
                        href={`https://linkedin.com/in/${contactInfo.linkedin}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
                      >
                        <Linkedin className="h-5 w-5" />
                      </a>
                    )}
                    {contactInfo.line && (
                      <a 
                        href={`https://line.me/R/ti/p/${contactInfo.line}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
                      >
                        <MessageCircle className="h-5 w-5" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* カスタムフィールド */}
            {customFields && customFields.length > 0 && (
              <div>
                <h3 className="font-medium mb-3">その他の情報</h3>
                <div className="grid gap-2">
                  {customFields.map((field, index) => (
                    <div key={index} className="flex items-center justify-between py-2 border-b last:border-0">
                      <span className="text-muted-foreground">{field.label}</span>
                      {field.type === "url" ? (
                        <a 
                          href={field.value}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline flex items-center gap-1"
                        >
                          {field.value}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : field.type === "email" ? (
                        <a href={`mailto:${field.value}`} className="text-primary hover:underline">
                          {field.value}
                        </a>
                      ) : field.type === "phone" ? (
                        <a href={`tel:${field.value}`} className="text-primary hover:underline">
                          {field.value}
                        </a>
                      ) : (
                        <span>{field.value}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* メモ */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">メモ</CardTitle>
              {!isEditing && (
                <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                  <Edit className="mr-2 h-4 w-4" />
                  編集
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isEditing ? (
              <div className="space-y-3">
                <Textarea
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="このカードについてのメモを入力..."
                  rows={4}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => {
                    setMemo(userCard.memo || "");
                    setIsEditing(false);
                  }}>
                    キャンセル
                  </Button>
                  <Button onClick={saveMemo} disabled={updateCardMutation.isPending}>
                    保存
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground whitespace-pre-wrap">
                {userCard.memo || "メモはありません"}
              </p>
            )}
          </CardContent>
        </Card>

        {/* 取得情報 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">取得情報</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">取得日時</span>
                <span>{new Date(userCard.acquiredAt).toLocaleString("ja-JP")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">取得方法</span>
                <span>
                  {userCard.acquiredMethod === "nfc_scan" && "NFCタッチ"}
                  {userCard.acquiredMethod === "qr_scan" && "QRスキャン"}
                  {userCard.acquiredMethod === "link" && "リンク"}
                  {userCard.acquiredMethod === "manual" && "手動追加"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">カードコード</span>
                <span className="font-mono">{card.code}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
