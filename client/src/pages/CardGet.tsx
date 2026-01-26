import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2, CreditCard, Building2, Phone, Mail, Globe, MapPin } from "lucide-react";
import { toast } from "sonner";

export default function CardGet() {
  const { code } = useParams<{ code: string }>();
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<"loading" | "success" | "error" | "already_owned" | "not_found">("loading");
  const [cardData, setCardData] = useState<any>(null);

  // カード情報を取得
  const { data: card, isLoading: cardLoading, error: cardError } = trpc.cards.getByCode.useQuery(
    { code: code || "" },
    { enabled: !!code && !!user }
  );

  // カード取得ミューテーション
  const acquireMutation = trpc.cards.acquire.useMutation({
    onSuccess: (data) => {
      setStatus("success");
      setCardData(data.card);
      toast.success("カードを取得しました！");
    },
    onError: (error) => {
      if (error.message.includes("既に取得済み")) {
        setStatus("already_owned");
        setCardData(card);
      } else if (error.message.includes("見つかりません")) {
        setStatus("not_found");
      } else {
        setStatus("error");
        toast.error(error.message);
      }
    },
  });

  // 未ログインの場合はログインページへリダイレクト
  useEffect(() => {
    if (!authLoading && !user) {
      // 現在のURLをリダイレクト先として保存
      const currentUrl = window.location.href;
      // ログイン後に戻ってくるURLをセッションストレージに保存
      sessionStorage.setItem('redirect_after_login', currentUrl);
      const loginUrl = getLoginUrl();
      window.location.href = loginUrl;
    }
  }, [authLoading, user]);

  // カード情報取得後、自動でカードを取得
  useEffect(() => {
    if (card && user && !acquireMutation.isPending && status === "loading") {
      acquireMutation.mutate({ code: code || "", method: "link" });
    }
  }, [card, user, code]);

  // カードが見つからない場合
  useEffect(() => {
    if (cardError) {
      if (cardError.message.includes("見つかりません")) {
        setStatus("not_found");
      } else {
        setStatus("error");
      }
    }
  }, [cardError]);

  // ローディング中
  if (authLoading || (cardLoading && status === "loading")) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-muted-foreground">カードを取得中...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // カードが見つからない
  if (status === "not_found") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <XCircle className="h-12 w-12 text-destructive" />
              <h2 className="text-xl font-semibold">カードが見つかりません</h2>
              <p className="text-muted-foreground text-center">
                このカードコードは無効か、削除された可能性があります。
              </p>
              <Button onClick={() => setLocation("/cards")}>
                マイカードへ
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // エラー
  if (status === "error") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <XCircle className="h-12 w-12 text-destructive" />
              <h2 className="text-xl font-semibold">エラーが発生しました</h2>
              <p className="text-muted-foreground text-center">
                カードの取得中にエラーが発生しました。もう一度お試しください。
              </p>
              <Button onClick={() => window.location.reload()}>
                再試行
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 既に所有している
  if (status === "already_owned") {
    const displayCard = cardData || card;
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <CheckCircle className="h-12 w-12 text-primary" />
            </div>
            <CardTitle>このカードは既に取得済みです</CardTitle>
            <CardDescription>
              マイカードで確認できます
            </CardDescription>
          </CardHeader>
          {displayCard && (
            <CardContent>
              <div className="border rounded-lg p-4 mb-4">
                <div className="flex items-start gap-4">
                  {displayCard.imageUrl ? (
                    <img
                      src={displayCard.imageUrl}
                      alt={displayCard.title}
                      className="w-16 h-16 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center">
                      <CreditCard className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1">
                    <h3 className="font-semibold">{displayCard.title}</h3>
                    {displayCard.subtitle && (
                      <p className="text-sm text-muted-foreground">{displayCard.subtitle}</p>
                    )}
                    {displayCard.businessInfo?.company && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                        <Building2 className="h-3 w-3" />
                        {displayCard.businessInfo.company}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <Button className="w-full" onClick={() => setLocation("/cards")}>
                マイカードを見る
              </Button>
            </CardContent>
          )}
        </Card>
      </div>
    );
  }

  // 取得成功
  if (status === "success" && cardData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <CheckCircle className="h-12 w-12 text-green-500" />
            </div>
            <CardTitle>カードを取得しました！</CardTitle>
            <CardDescription>
              マイカードに保存されました
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg p-4 mb-4">
              <div className="flex items-start gap-4">
                {cardData.imageUrl ? (
                  <img
                    src={cardData.imageUrl}
                    alt={cardData.title}
                    className="w-16 h-16 rounded-lg object-cover"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center">
                    <CreditCard className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1">
                  <h3 className="font-semibold">{cardData.title}</h3>
                  {cardData.subtitle && (
                    <p className="text-sm text-muted-foreground">{cardData.subtitle}</p>
                  )}
                  {cardData.businessInfo?.company && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                      <Building2 className="h-3 w-3" />
                      {cardData.businessInfo.company}
                    </p>
                  )}
                </div>
              </div>

              {/* 連絡先情報 */}
              {cardData.contactInfo && (
                <div className="mt-4 pt-4 border-t space-y-2">
                  {cardData.contactInfo.email && (
                    <p className="text-sm flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <a href={`mailto:${cardData.contactInfo.email}`} className="text-primary hover:underline">
                        {cardData.contactInfo.email}
                      </a>
                    </p>
                  )}
                  {cardData.contactInfo.phone && (
                    <p className="text-sm flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <a href={`tel:${cardData.contactInfo.phone}`} className="text-primary hover:underline">
                        {cardData.contactInfo.phone}
                      </a>
                    </p>
                  )}
                  {cardData.contactInfo.website && (
                    <p className="text-sm flex items-center gap-2">
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      <a href={cardData.contactInfo.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        {cardData.contactInfo.website}
                      </a>
                    </p>
                  )}
                  {cardData.contactInfo.address && (
                    <p className="text-sm flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      {cardData.contactInfo.address}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setLocation(`/cards/${cardData.id}`)}>
                詳細を見る
              </Button>
              <Button className="flex-1" onClick={() => setLocation("/cards")}>
                マイカードへ
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 取得中
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground">カードを取得中...</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
