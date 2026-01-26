import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { 
  ArrowLeft,
  CreditCard, 
  Building2,
  User,
  Star,
  Calendar,
  Plus,
  MoreVertical,
  Edit,
  Copy,
  QrCode,
  Eye,
  BarChart3
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

export default function MyCards() {
  const [, navigate] = useLocation();
  const [selectedCard, setSelectedCard] = useState<any>(null);

  // 自分のカード一覧を取得
  const { data: cards, isLoading, refetch } = trpc.cards.getOwnedCards.useQuery();

  // URLをコピー
  const copyCardUrl = (code: string) => {
    const url = `${window.location.origin}/api/card/get?code=${code}`;
    navigator.clipboard.writeText(url);
    toast.success("URLをコピーしました");
  };

  // コードをコピー
  const copyCardCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success("カードコードをコピーしました");
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* ヘッダー */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate("/cards")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              戻る
            </Button>
            <div>
              <h1 className="text-2xl font-bold">マイ名刺</h1>
              <p className="text-muted-foreground">
                作成した名刺・カードを管理
              </p>
            </div>
          </div>
          <Button onClick={() => navigate("/cards/create")}>
            <Plus className="mr-2 h-4 w-4" />
            新しいカードを作成
          </Button>
        </div>

        {/* カード一覧 */}
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(3)].map((_, i) => (
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
        ) : cards?.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <CreditCard className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">カードがありません</h3>
              <p className="text-muted-foreground text-center mt-2">
                最初のカードを作成して、NFCやQRコードで共有しましょう
              </p>
              <Button className="mt-4" onClick={() => navigate("/cards/create")}>
                <Plus className="mr-2 h-4 w-4" />
                カードを作成
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {cards?.map((card) => {
              const cardType = CARD_TYPES[card.cardType as CardType] || CARD_TYPES.other;
              const CardIcon = cardType.icon;
              
              return (
                <Card key={card.id} className="group">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`p-2 rounded-lg ${cardType.color}`}>
                          <CardIcon className="h-4 w-4 text-white" />
                        </div>
                        <Badge variant="secondary">{cardType.label}</Badge>
                        {card.isPublic === 1 ? (
                          <Badge variant="outline" className="text-green-500 border-green-500">公開</Badge>
                        ) : (
                          <Badge variant="outline" className="text-gray-500">非公開</Badge>
                        )}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/cards/edit/${card.id}`)}>
                            <Edit className="mr-2 h-4 w-4" />
                            編集
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => copyCardUrl(card.code)}>
                            <Copy className="mr-2 h-4 w-4" />
                            URLをコピー
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => copyCardCode(card.code)}>
                            <QrCode className="mr-2 h-4 w-4" />
                            コードをコピー
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSelectedCard(card)}>
                            <BarChart3 className="mr-2 h-4 w-4" />
                            統計を見る
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <CardTitle className="mt-3 line-clamp-1">{card.title}</CardTitle>
                    {card.subtitle && (
                      <CardDescription className="line-clamp-1">
                        {card.subtitle}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    {/* カード画像 */}
                    {card.imageUrl ? (
                      <div className="aspect-video rounded-lg overflow-hidden bg-muted mb-3">
                        <img 
                          src={card.imageUrl} 
                          alt={card.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="aspect-video rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-3">
                        <CardIcon className="h-12 w-12 text-primary/40" />
                      </div>
                    )}

                    {/* 統計 */}
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <div className="flex items-center gap-4">
                        <span>スキャン: {card.totalScans}</span>
                        <span>保存: {card.totalSaves}</span>
                      </div>
                      <span className="font-mono text-xs">{card.code}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* 統計ダイアログ */}
        <Dialog open={!!selectedCard} onOpenChange={() => setSelectedCard(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>カード統計</DialogTitle>
              <DialogDescription>
                {selectedCard?.title} の利用状況
              </DialogDescription>
            </DialogHeader>
            {selectedCard && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold">{selectedCard.totalScans}</div>
                      <p className="text-sm text-muted-foreground">スキャン回数</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold">{selectedCard.totalSaves}</div>
                      <p className="text-sm text-muted-foreground">保存回数</p>
                    </CardContent>
                  </Card>
                </div>
                <div className="text-sm text-muted-foreground">
                  <p>作成日: {new Date(selectedCard.createdAt).toLocaleDateString("ja-JP")}</p>
                  {selectedCard.lastScannedAt && (
                    <p>最終スキャン: {new Date(selectedCard.lastScannedAt).toLocaleString("ja-JP")}</p>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
