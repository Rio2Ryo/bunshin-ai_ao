import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Coins, 
  Gift, 
  History, 
  TrendingUp, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Package,
  ArrowUpRight,
  ArrowDownRight,
  Timer
} from "lucide-react";

export default function Points() {
  usePageMeta({ title: "ポイント", description: "ポイント残高・履歴・特典交換", path: "/points" });
  const [selectedProduct, setSelectedProduct] = useState<{
    id: number;
    name: string;
    pointsCost: number;
  } | null>(null);
  const [shippingInfo, setShippingInfo] = useState({
    name: "",
    address: "",
    phone: "",
    email: "",
    notes: "",
  });
  const [isRedeemDialogOpen, setIsRedeemDialogOpen] = useState(false);

  const { data: balance, refetch: refetchBalance } = trpc.points.getBalance.useQuery();
  const { data: transactions } = trpc.points.getTransactions.useQuery({ limit: 50 });
  const { data: products } = trpc.points.getProducts.useQuery();
  const { data: redemptions, refetch: refetchRedemptions } = trpc.points.getRedemptions.useQuery();

  const redeemMutation = trpc.points.redeemProduct.useMutation({
    onSuccess: () => {
      toast.success("製品との交換が完了しました！");
      refetchBalance();
      refetchRedemptions();
      setIsRedeemDialogOpen(false);
      setSelectedProduct(null);
      setShippingInfo({ name: "", address: "", phone: "", email: "", notes: "" });
    },
    onError: (error) => {
      toast.error(error.message || "交換に失敗しました");
    },
  });

  const handleRedeem = () => {
    if (!selectedProduct) return;
    redeemMutation.mutate({
      productId: selectedProduct.id,
      shippingInfo: shippingInfo.name ? shippingInfo : undefined,
    });
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case "earn":
        return <ArrowUpRight className="h-4 w-4 text-green-500" />;
      case "spend":
        return <ArrowDownRight className="h-4 w-4 text-red-500" />;
      case "expire":
        return <Timer className="h-4 w-4 text-orange-500" />;
      default:
        return <Coins className="h-4 w-4 text-gray-500" />;
    }
  };

  const getRedemptionStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">処理待ち</Badge>;
      case "processing":
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">処理中</Badge>;
      case "completed":
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">完了</Badge>;
      case "cancelled":
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">キャンセル</Badge>;
      case "refunded":
        return <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">返金済み</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const daysUntilExpiry = balance?.expiresAt 
    ? Math.ceil((new Date(balance.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <DashboardLayout>
      <div className="space-y-6" role="main" aria-label="ポイント管理">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ポイント</h1>
          <p className="text-muted-foreground">
            評価データの提供でポイントを獲得し、製品と交換できます
          </p>
        </div>

        {/* Balance Card */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="md:col-span-2 bg-gradient-to-br from-amber-500 to-orange-600 text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-medium opacity-90">現在のポイント残高</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold">{balance?.balance?.toLocaleString() ?? 0}</span>
                <span className="text-xl opacity-80">pt</span>
              </div>
              {daysUntilExpiry !== null && daysUntilExpiry > 0 && (
                <p className="mt-2 text-sm opacity-80 flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  有効期限まであと {daysUntilExpiry} 日
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">累計獲得</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-500" />
                <span className="text-2xl font-bold">{balance?.totalEarned?.toLocaleString() ?? 0}</span>
                <span className="text-muted-foreground">pt</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">累計使用</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Gift className="h-5 w-5 text-blue-500" />
                <span className="text-2xl font-bold">{balance?.totalSpent?.toLocaleString() ?? 0}</span>
                <span className="text-muted-foreground">pt</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="products" className="space-y-4">
          <TabsList>
            <TabsTrigger value="products" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              交換製品
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              ポイント履歴
            </TabsTrigger>
            <TabsTrigger value="redemptions" className="flex items-center gap-2">
              <Gift className="h-4 w-4" />
              交換履歴
            </TabsTrigger>
          </TabsList>

          {/* Products Tab */}
          <TabsContent value="products" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {products?.map((product) => (
                <Card key={product.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">{product.name}</CardTitle>
                        {product.category && (
                          <Badge variant="secondary" className="mt-1">{product.category}</Badge>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-amber-600">
                          {product.pointsCost.toLocaleString()}
                        </div>
                        <div className="text-xs text-muted-foreground">ポイント</div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <p className="text-sm text-muted-foreground">{product.description}</p>
                    {product.priceYen && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        参考価格: ¥{product.priceYen.toLocaleString()}
                      </p>
                    )}
                  </CardContent>
                  <div className="p-4 pt-0">
                    <Dialog open={isRedeemDialogOpen && selectedProduct?.id === product.id} onOpenChange={(open) => {
                      setIsRedeemDialogOpen(open);
                      if (!open) setSelectedProduct(null);
                    }}>
                      <DialogTrigger asChild>
                        <Button 
                          className="w-full" 
                          disabled={(balance?.balance ?? 0) < product.pointsCost}
                          onClick={() => setSelectedProduct(product)}
                        >
                          {(balance?.balance ?? 0) < product.pointsCost 
                            ? `あと ${(product.pointsCost - (balance?.balance ?? 0)).toLocaleString()} pt 必要`
                            : "交換する"
                          }
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-[500px]">
                        <DialogHeader>
                          <DialogTitle>製品との交換</DialogTitle>
                          <DialogDescription>
                            {product.name}と交換します。配送先情報を入力してください。
                          </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                          <div className="grid gap-2">
                            <Label htmlFor="name">お名前</Label>
                            <Input
                              id="name"
                              value={shippingInfo.name}
                              onChange={(e) => setShippingInfo({ ...shippingInfo, name: e.target.value })}
                              placeholder="山田 太郎"
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="address">住所</Label>
                            <Textarea
                              id="address"
                              value={shippingInfo.address}
                              onChange={(e) => setShippingInfo({ ...shippingInfo, address: e.target.value })}
                              placeholder="〒000-0000 東京都..."
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="phone">電話番号</Label>
                            <Input
                              id="phone"
                              value={shippingInfo.phone}
                              onChange={(e) => setShippingInfo({ ...shippingInfo, phone: e.target.value })}
                              placeholder="090-0000-0000"
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="email">メールアドレス</Label>
                            <Input
                              id="email"
                              type="email"
                              value={shippingInfo.email}
                              onChange={(e) => setShippingInfo({ ...shippingInfo, email: e.target.value })}
                              placeholder="example@email.com"
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="notes">備考</Label>
                            <Textarea
                              id="notes"
                              value={shippingInfo.notes}
                              onChange={(e) => setShippingInfo({ ...shippingInfo, notes: e.target.value })}
                              placeholder="配送に関するご要望など"
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setIsRedeemDialogOpen(false)}>
                            キャンセル
                          </Button>
                          <Button 
                            onClick={handleRedeem} 
                            disabled={redeemMutation.isPending}
                          >
                            {redeemMutation.isPending ? "処理中..." : `${product.pointsCost.toLocaleString()} pt で交換`}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </Card>
              ))}

              {(!products || products.length === 0) && (
                <Card className="md:col-span-3">
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Package className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">交換可能な製品はまだありません</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>ポイント履歴</CardTitle>
                <CardDescription>ポイントの獲得・使用履歴</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {transactions?.map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between py-3 border-b last:border-0">
                      <div className="flex items-center gap-3">
                        {getTransactionIcon(tx.type)}
                        <div>
                          <p className="font-medium">{tx.description}</p>
                          <p className="text-sm text-muted-foreground">{formatDate(tx.createdAt)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-bold ${tx.type === "earn" ? "text-green-600" : tx.type === "spend" ? "text-red-600" : "text-orange-600"}`}>
                          {tx.type === "earn" ? "+" : "-"}{tx.amount.toLocaleString()} pt
                        </p>
                        <p className="text-sm text-muted-foreground">
                          残高: {tx.balanceAfter.toLocaleString()} pt
                        </p>
                      </div>
                    </div>
                  ))}

                  {(!transactions || transactions.length === 0) && (
                    <div className="flex flex-col items-center justify-center py-12">
                      <History className="h-12 w-12 text-muted-foreground mb-4" />
                      <p className="text-muted-foreground">ポイント履歴はまだありません</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Redemptions Tab */}
          <TabsContent value="redemptions" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>交換履歴</CardTitle>
                <CardDescription>製品との交換履歴</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {redemptions?.map((redemption) => (
                    <div key={redemption.id} className="flex items-center justify-between py-3 border-b last:border-0">
                      <div className="flex items-center gap-3">
                        <Gift className="h-5 w-5 text-amber-500" />
                        <div>
                          <p className="font-medium">{redemption.productName}</p>
                          <p className="text-sm text-muted-foreground">{formatDate(redemption.createdAt)}</p>
                        </div>
                      </div>
                      <div className="text-right flex items-center gap-3">
                        {getRedemptionStatusBadge(redemption.status)}
                        <p className="font-medium text-muted-foreground">
                          {redemption.pointsUsed.toLocaleString()} pt
                        </p>
                      </div>
                    </div>
                  ))}

                  {(!redemptions || redemptions.length === 0) && (
                    <div className="flex flex-col items-center justify-center py-12">
                      <Gift className="h-12 w-12 text-muted-foreground mb-4" />
                      <p className="text-muted-foreground">交換履歴はまだありません</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* How to Earn Points */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-amber-500" />
              ポイントの貯め方
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <div className="p-2 rounded-full bg-green-100">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <p className="font-medium">分身AI作成</p>
                  <p className="text-sm text-muted-foreground">20 pt</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <div className="p-2 rounded-full bg-blue-100">
                  <CheckCircle2 className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="font-medium">ビッグファイブ診断</p>
                  <p className="text-sm text-muted-foreground">10 pt</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <div className="p-2 rounded-full bg-purple-100">
                  <CheckCircle2 className="h-4 w-4 text-purple-600" />
                </div>
                <div>
                  <p className="font-medium">MBTI診断</p>
                  <p className="text-sm text-muted-foreground">10 pt</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <div className="p-2 rounded-full bg-amber-100">
                  <CheckCircle2 className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <p className="font-medium">価値観シナリオ回答</p>
                  <p className="text-sm text-muted-foreground">3 pt / 回答</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <div className="p-2 rounded-full bg-pink-100">
                  <CheckCircle2 className="h-4 w-4 text-pink-600" />
                </div>
                <div>
                  <p className="font-medium">友達追加</p>
                  <p className="text-sm text-muted-foreground">5 pt</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <div className="p-2 rounded-full bg-indigo-100">
                  <CheckCircle2 className="h-4 w-4 text-indigo-600" />
                </div>
                <div>
                  <p className="font-medium">マッチング完了</p>
                  <p className="text-sm text-muted-foreground">15 pt</p>
                </div>
              </div>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              ※ ポイントは最終活動日から1年間有効です。1年間ポイントの増減がない場合、ポイントは失効します。
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
