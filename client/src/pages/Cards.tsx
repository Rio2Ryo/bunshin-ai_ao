import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { 
  CreditCard, 
  Search, 
  Star, 
  StarOff, 
  MoreVertical, 
  Trash2, 
  Edit, 
  ExternalLink,
  Building2,
  User,
  Mail,
  Phone,
  Globe,
  MapPin,
  Plus,
  Filter,
  SortAsc
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

export default function Cards() {
  const [, navigate] = useLocation();
  // toastはsonnerからインポート済み
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  // URLパラメータからエラーや成功メッセージを取得
  const urlParams = new URLSearchParams(window.location.search);
  const error = urlParams.get("error");
  const acquired = urlParams.get("acquired");

  // カード一覧を取得
  const { data: cards, isLoading, refetch } = trpc.cards.getMyCards.useQuery(
    showFavoritesOnly ? { favoritesOnly: true } : selectedType !== "all" ? { cardType: selectedType } : undefined
  );

  // カードを削除
  const removeCardMutation = trpc.cards.removeUserCard.useMutation({
    onSuccess: () => {
      toast.success("カードを削除しました");
      refetch();
    },
    onError: (error) => {
      toast.error("エラー", { description: error.message });
    },
  });

  // お気に入りを切り替え
  const updateCardMutation = trpc.cards.updateUserCard.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  // エラーメッセージを表示
  if (error) {
    const errorMessages: Record<string, string> = {
      invalid_code: "無効なカードコードです",
      card_not_found: "カードが見つかりません",
      server_error: "サーバーエラーが発生しました",
    };
    toast.error("エラー", { description: errorMessages[error] || "エラーが発生しました" });
  }

  // 成功メッセージを表示
  if (acquired === "true") {
    toast.success("カードを取得しました！", { description: "マイカードに追加されました" });
  }

  // フィルタリング
  const filteredCards = cards?.filter((uc) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        uc.card.title.toLowerCase().includes(query) ||
        uc.card.subtitle?.toLowerCase().includes(query) ||
        uc.card.description?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const toggleFavorite = (cardId: number, currentFavorite: number) => {
    updateCardMutation.mutate({
      cardId,
      isFavorite: currentFavorite !== 1,
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* ヘッダー */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">マイカード</h1>
            <p className="text-muted-foreground">
              NFCタッチやQRスキャンで取得したカードを管理
            </p>
          </div>
          <Button onClick={() => navigate("/cards/create")}>
            <Plus className="mr-2 h-4 w-4" />
            自分の名刺を作成
          </Button>
        </div>

        {/* 検索・フィルター */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="カードを検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant={showFavoritesOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            >
              <Star className="mr-2 h-4 w-4" />
              お気に入り
            </Button>
          </div>
        </div>

        {/* タブ（カードタイプ別） */}
        <Tabs value={selectedType} onValueChange={setSelectedType}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="all">すべて</TabsTrigger>
            {Object.entries(CARD_TYPES).map(([key, { label }]) => (
              <TabsTrigger key={key} value={key}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={selectedType} className="mt-6">
            {isLoading ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[...Array(6)].map((_, i) => (
                  <Card key={i}>
                    <CardHeader>
                      <Skeleton className="h-6 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-32 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : filteredCards?.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <CreditCard className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium">カードがありません</h3>
                  <p className="text-muted-foreground text-center mt-2">
                    NFC名刺をタッチするか、QRコードをスキャンしてカードを取得しましょう
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredCards?.map((uc) => {
                  const cardType = CARD_TYPES[uc.card.cardType as CardType] || CARD_TYPES.other;
                  const CardIcon = cardType.icon;
                  
                  return (
                    <Card 
                      key={uc.card.id} 
                      className="group cursor-pointer hover:shadow-lg transition-shadow"
                      onClick={() => navigate(`/cards/${uc.card.id}`)}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`p-2 rounded-lg ${cardType.color}`}>
                              <CardIcon className="h-4 w-4 text-white" />
                            </div>
                            <Badge variant="secondary">{cardType.label}</Badge>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite(uc.card.id, uc.isFavorite);
                              }}
                            >
                              {uc.isFavorite === 1 ? (
                                <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                              ) : (
                                <StarOff className="h-4 w-4" />
                              )}
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/cards/${uc.card.id}`);
                                }}>
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  詳細を見る
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  className="text-destructive"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeCardMutation.mutate({ cardId: uc.card.id });
                                  }}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  削除
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                        <CardTitle className="mt-3 line-clamp-1">{uc.card.title}</CardTitle>
                        {uc.card.subtitle && (
                          <CardDescription className="line-clamp-1">
                            {uc.card.subtitle}
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent>
                        {/* カード画像 */}
                        {uc.card.imageUrl ? (
                          <div className="aspect-video rounded-lg overflow-hidden bg-muted mb-3">
                            <img 
                              src={uc.card.imageUrl} 
                              alt={uc.card.title}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        ) : (
                          <div className="aspect-video rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-3">
                            <CardIcon className="h-12 w-12 text-primary/40" />
                          </div>
                        )}

                        {/* 連絡先情報（一部） */}
                        {uc.card.contactInfo && (
                          <div className="space-y-1 text-sm text-muted-foreground">
                            {(uc.card.contactInfo as any).email && (
                              <div className="flex items-center gap-2">
                                <Mail className="h-3 w-3" />
                                <span className="truncate">{(uc.card.contactInfo as any).email}</span>
                              </div>
                            )}
                            {(uc.card.contactInfo as any).phone && (
                              <div className="flex items-center gap-2">
                                <Phone className="h-3 w-3" />
                                <span>{(uc.card.contactInfo as any).phone}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* 取得日時 */}
                        <div className="mt-3 text-xs text-muted-foreground">
                          {new Date(uc.acquiredAt).toLocaleDateString("ja-JP")} に取得
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
