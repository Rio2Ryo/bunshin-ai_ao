import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { 
  CheckCircle2, 
  XCircle, 
  CreditCard, 
  Building2, 
  User, 
  Star, 
  Calendar,
  Loader2,
  LogIn
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

export default function CardGetBulk() {
  const params = useParams<{ codes: string }>();
  const [, navigate] = useLocation();
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<"loading" | "success" | "error" | "login_required">("loading");
  const [results, setResults] = useState<Array<{ code: string; success: boolean; card?: any; error?: string }>>([]);

  const codes = params.codes?.split(",") || [];

  // 複数カードを取得するミューテーション
  const acquireCardMutation = trpc.cards.acquire.useMutation();

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setStatus("login_required");
      return;
    }

    // 各カードを取得
    const acquireCards = async () => {
      const results: Array<{ code: string; success: boolean; card?: any; error?: string }> = [];
      
      for (const code of codes) {
        try {
          const result = await acquireCardMutation.mutateAsync({ code: code.trim() });
          results.push({ code, success: true, card: result });
        } catch (error: any) {
          results.push({ code, success: false, error: error.message });
        }
      }

      setResults(results);
      
      const successCount = results.filter(r => r.success).length;
      if (successCount === codes.length) {
        setStatus("success");
        toast.success(`${successCount}枚のカードを取得しました`);
      } else if (successCount > 0) {
        setStatus("success");
        toast.success(`${successCount}/${codes.length}枚のカードを取得しました`);
      } else {
        setStatus("error");
        toast.error("カードの取得に失敗しました");
      }
    };

    if (codes.length > 0) {
      acquireCards();
    } else {
      setStatus("error");
    }
  }, [user, authLoading, params.codes]);

  // ログインが必要な場合
  if (status === "login_required") {
    const currentUrl = window.location.pathname;
    const loginUrl = getLoginUrl();

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <LogIn className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>ログインが必要です</CardTitle>
            <CardDescription>
              {codes.length}枚のカードを取得するにはログインしてください
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button className="w-full" onClick={() => window.location.href = loginUrl}>
              ログインして取得
            </Button>
            <Button variant="outline" className="w-full" onClick={() => navigate("/")}>
              ホームに戻る
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ローディング中
  if (status === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Loader2 className="h-6 w-6 text-primary animate-spin" />
            </div>
            <CardTitle>カードを取得中...</CardTitle>
            <CardDescription>
              {codes.length}枚のカードを取得しています
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {codes.map((code, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 結果表示
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 ${
            status === "success" ? "bg-green-500/10" : "bg-red-500/10"
          }`}>
            {status === "success" ? (
              <CheckCircle2 className="h-6 w-6 text-green-500" />
            ) : (
              <XCircle className="h-6 w-6 text-red-500" />
            )}
          </div>
          <CardTitle>
            {status === "success" ? "カードを取得しました" : "取得に失敗しました"}
          </CardTitle>
          <CardDescription>
            {results.filter(r => r.success).length}/{codes.length}枚のカードを取得
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 取得結果一覧 */}
          <div className="space-y-2">
            {results.map((result, i) => {
              const cardType = result.card?.cardType 
                ? CARD_TYPES[result.card.cardType as CardType] || CARD_TYPES.other
                : CARD_TYPES.other;
              const CardIcon = cardType.icon;

              return (
                <div 
                  key={i} 
                  className={`p-3 rounded-lg border flex items-center gap-3 ${
                    result.success ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"
                  }`}
                >
                  {result.success ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                  )}
                  
                  {result.card ? (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className={`p-1.5 rounded ${cardType.color}`}>
                        <CardIcon className="h-3 w-3 text-white" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{result.card.title}</p>
                        {result.card.subtitle && (
                          <p className="text-sm text-muted-foreground truncate">{result.card.subtitle}</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1">
                      <p className="font-mono text-sm">{result.code}</p>
                      {result.error && (
                        <p className="text-sm text-red-500">{result.error}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* アクションボタン */}
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => navigate("/cards")}>
              カード一覧を見る
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => navigate("/")}>
              ホームに戻る
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
