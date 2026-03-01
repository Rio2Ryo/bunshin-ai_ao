import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { Crown, Users, MessageSquare, Database, FileUp, Zap, Check, Sparkles, CreditCard, Settings, AlertTriangle, Shield } from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { useSearch } from "wouter";

const planDetails = {
  free: {
    name: "フリープラン",
    priceMonthly: "無料",
    priceYearly: "無料",
    color: "bg-gray-500",
    icon: Zap,
  },
  premium: {
    name: "プレミアム",
    priceMonthly: "¥1,480/月",
    priceYearly: "¥14,800/年",
    color: "bg-cyan-500",
    icon: Crown,
  },
  enterprise: {
    name: "エンタープライズ",
    priceMonthly: "¥4,980/月",
    priceYearly: "¥49,800/年",
    color: "bg-purple-500",
    icon: Sparkles,
  },
};

export default function Plan() {
  usePageMeta({ title: "プラン", description: "料金プランの確認と変更", path: "/plan" });
  const { user } = useAuth();
  const search = useSearch();
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<"premium" | "enterprise">("premium");
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");

  const { data: stats, isLoading, refetch } = trpc.plan.getStats.useQuery();
  const { data: subscription } = trpc.plan.getSubscription.useQuery();
  
  const checkoutMutation = trpc.plan.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        toast.info("決済ページに移動します...");
        window.open(data.url, "_blank");
        setShowUpgradeDialog(false);
      } else {
        toast.info("Stripe APIキーが設定されていません。管理者にお問い合わせください。");
        setShowUpgradeDialog(false);
      }
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const portalMutation = trpc.plan.createPortalSession.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        toast.info("サブスクリプション管理ページに移動します...");
        window.open(data.url, "_blank");
      } else {
        toast.info("サブスクリプション管理は現在利用できません。管理者にお問い合わせください。");
      }
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Handle success/cancel URL params from Stripe redirect
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("status") === "success" || params.get("success") === "true") {
      toast.success("決済が完了しました！プランがアップグレードされました。");
      refetch();
    } else if (params.get("status") === "cancelled" || params.get("canceled") === "true") {
      toast.info("決済がキャンセルされました。");
    }
  }, [search, refetch]);

  if (isLoading || !stats) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
        </div>
      </DashboardLayout>
    );
  }

  const currentPlan = stats.plan as keyof typeof planDetails;
  const PlanIcon = planDetails[currentPlan].icon;

  const getUsagePercent = (current: number, max: number) => {
    if (max === -1) return 0;
    return Math.min((current / max) * 100, 100);
  };

  const formatLimit = (value: number) => {
    return value === -1 ? "無制限" : value.toString();
  };

  const handleUpgrade = (plan: "premium" | "enterprise") => {
    setSelectedPlan(plan);
    setShowUpgradeDialog(true);
  };

  const handleCheckout = () => {
    checkoutMutation.mutate({
      plan: selectedPlan,
      interval: billingInterval,
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6" role="main" aria-label="プラン管理">
        {/* Current Plan */}
        <Card className="bg-gradient-to-r from-gray-900 to-gray-800 border-cyan-500/30">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-lg ${planDetails[currentPlan].color}`}>
                  <PlanIcon className="h-6 w-6 text-white" />
                </div>
                <div>
                  <CardTitle className="text-xl">{planDetails[currentPlan].name}</CardTitle>
                  <CardDescription>現在のプラン</CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-lg px-4 py-2 border-cyan-500 text-cyan-400">
                  {planDetails[currentPlan].priceMonthly}
                </Badge>
                {subscription && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => portalMutation.mutate()}
                    disabled={portalMutation.isPending}
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    管理
                  </Button>
                )}
              </div>
            </div>
            {subscription && (
              <div className="mt-4 text-sm text-gray-400">
                {subscription.cancelAtPeriodEnd ? (
                  <span className="text-yellow-500">
                    {new Date(subscription.currentPeriodEnd).toLocaleDateString("ja-JP")}に解約予定
                  </span>
                ) : (
                  <span>
                    次回更新日: {new Date(subscription.currentPeriodEnd).toLocaleDateString("ja-JP")}
                  </span>
                )}
              </div>
            )}
          </CardHeader>
        </Card>

        {/* Rate Limits & Usage - powered by getRateLimits */}
        <RateLimitCard />

        {/* Storage Usage Stats */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="bg-gray-900/50 border-gray-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Database className="h-4 w-4 text-cyan-400" />
                知識ベース
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats.usage.knowledgeEntries} / {formatLimit(stats.limits.maxKnowledgeEntries)}
              </div>
              <Progress
                value={getUsagePercent(stats.usage.knowledgeEntries, stats.limits.maxKnowledgeEntries)}
                className="mt-2 h-2"
              />
            </CardContent>
          </Card>

          <Card className="bg-gray-900/50 border-gray-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <FileUp className="h-4 w-4 text-cyan-400" />
                ファイルアップロード
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats.usage.fileUploads} / {formatLimit(stats.limits.maxFileUploads)}
              </div>
              <Progress
                value={getUsagePercent(stats.usage.fileUploads, stats.limits.maxFileUploads)}
                className="mt-2 h-2"
              />
            </CardContent>
          </Card>
        </div>

        {/* Plan Comparison */}
        <h2 className="text-xl font-bold mt-8">プラン比較</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {(["free", "premium", "enterprise"] as const).map((plan) => {
            const details = planDetails[plan];
            const Icon = details.icon;
            const isCurrentPlan = currentPlan === plan;
            const limits = {
              free: { friends: 5, matchings: 3, knowledge: 10, files: 5, externalAI: false },
              premium: { friends: 50, matchings: 30, knowledge: 100, files: 50, externalAI: true },
              enterprise: { friends: -1, matchings: -1, knowledge: -1, files: -1, externalAI: true },
            }[plan];

            return (
              <Card 
                key={plan} 
                className={`bg-gray-900/50 border-2 ${isCurrentPlan ? 'border-cyan-500' : 'border-gray-700'}`}
              >
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${details.color}`}>
                      <Icon className="h-5 w-5 text-white" />
                    </div>
                    <CardTitle>{details.name}</CardTitle>
                  </div>
                  <div className="text-2xl font-bold mt-2">{details.priceMonthly}</div>
                  {plan !== "free" && (
                    <div className="text-sm text-gray-400">{details.priceYearly}（年払い）</div>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-cyan-400" />
                    友達: {formatLimit(limits.friends)}人
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-cyan-400" />
                    マッチング: {formatLimit(limits.matchings)}回/月
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-cyan-400" />
                    知識ベース: {formatLimit(limits.knowledge)}件
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-cyan-400" />
                    ファイル: {formatLimit(limits.files)}件
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {limits.externalAI ? (
                      <Check className="h-4 w-4 text-cyan-400" />
                    ) : (
                      <span className="h-4 w-4 text-gray-500">✕</span>
                    )}
                    外部AI連携
                  </div>

                  <div className="pt-4">
                    {isCurrentPlan ? (
                      <Button disabled className="w-full" variant="outline">
                        現在のプラン
                      </Button>
                    ) : plan === "free" ? (
                      <Button disabled className="w-full" variant="outline">
                        -
                      </Button>
                    ) : (
                      <Button 
                        className="w-full bg-cyan-600 hover:bg-cyan-700"
                        onClick={() => handleUpgrade(plan)}
                      >
                        <CreditCard className="h-4 w-4 mr-2" />
                        アップグレード
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Test Mode Notice */}
        <Card className="bg-yellow-900/20 border-yellow-500/30">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <CreditCard className="h-5 w-5 text-yellow-500 mt-0.5" />
              <div>
                <h3 className="font-semibold text-yellow-500">テストモード</h3>
                <p className="text-sm text-gray-400 mt-1">
                  現在テストモードで動作しています。テスト用カード番号: <code className="bg-gray-800 px-2 py-0.5 rounded">4242 4242 4242 4242</code>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upgrade Dialog */}
      <Dialog open={showUpgradeDialog} onOpenChange={setShowUpgradeDialog}>
        <DialogContent className="bg-gray-900 border-gray-700">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-cyan-400" />
              {planDetails[selectedPlan].name}にアップグレード
            </DialogTitle>
            <DialogDescription>
              お支払い方法を選択してください
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            {/* Billing Interval Selection */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setBillingInterval("monthly")}
                className={`p-4 rounded-lg border-2 text-left transition-colors ${
                  billingInterval === "monthly"
                    ? "border-cyan-500 bg-cyan-500/10"
                    : "border-gray-700 hover:border-gray-600"
                }`}
              >
                <div className="font-semibold">月額プラン</div>
                <div className="text-2xl font-bold mt-1">
                  {selectedPlan === "premium" ? "¥1,480" : "¥4,980"}
                  <span className="text-sm font-normal text-gray-400">/月</span>
                </div>
              </button>
              <button
                onClick={() => setBillingInterval("yearly")}
                className={`p-4 rounded-lg border-2 text-left transition-colors relative ${
                  billingInterval === "yearly"
                    ? "border-cyan-500 bg-cyan-500/10"
                    : "border-gray-700 hover:border-gray-600"
                }`}
              >
                <Badge className="absolute -top-2 -right-2 bg-green-600">2ヶ月分お得</Badge>
                <div className="font-semibold">年額プラン</div>
                <div className="text-2xl font-bold mt-1">
                  {selectedPlan === "premium" ? "¥14,800" : "¥49,800"}
                  <span className="text-sm font-normal text-gray-400">/年</span>
                </div>
              </button>
            </div>

            <Button
              className="w-full bg-cyan-600 hover:bg-cyan-700"
              onClick={handleCheckout}
              disabled={checkoutMutation.isPending}
            >
              {checkoutMutation.isPending ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
              ) : (
                <CreditCard className="h-4 w-4 mr-2" />
              )}
              決済に進む
            </Button>

            <p className="text-xs text-gray-500 text-center">
              決済はStripeで安全に処理されます
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function RateLimitCard() {
  const { data, isLoading } = trpc.plan.getRateLimits.useQuery(undefined, { staleTime: 60_000 });

  if (isLoading) {
    return (
      <Card className="bg-gray-900/50 border-gray-700">
        <CardContent className="py-8 flex items-center justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-400" />
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const fmt = (v: number) => (v === -1 ? "無制限" : v.toLocaleString());
  const pct = (cur: number, max: number) =>
    max === -1 ? 0 : Math.min((cur / max) * 100, 100);

  const statusOf = (cur: number, max: number) => {
    if (max === -1) return "ok" as const;
    const p = (cur / max) * 100;
    if (p >= 100) return "over" as const;
    if (p >= 80) return "warn" as const;
    return "ok" as const;
  };

  const barColor = (s: "ok" | "warn" | "over") => {
    if (s === "over") return "[&>div]:bg-red-500";
    if (s === "warn") return "[&>div]:bg-yellow-500";
    return "";
  };

  const items = [
    {
      icon: Users,
      label: "友達数",
      sub: "上限",
      current: data.usage.friends,
      max: data.limits.maxFriends,
    },
    {
      icon: MessageSquare,
      label: "チャット回数",
      sub: "今日 / 1日あたり上限",
      current: data.usage.chatMessagesToday,
      max: data.limits.chatMessagesPerDay,
    },
    {
      icon: Zap,
      label: "マッチング回数",
      sub: "今月 / 月間上限",
      current: data.usage.matchingsThisMonth,
      max: data.limits.matchingsPerMonth,
    },
  ];

  const hasWarning = items.some(
    (i) => statusOf(i.current, i.max) !== "ok"
  );

  return (
    <Card
      className={`bg-gray-900/50 ${
        hasWarning ? "border-yellow-500/50" : "border-gray-700"
      }`}
      role="region"
      aria-label="API利用制限"
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-cyan-400" />
            API利用制限
          </CardTitle>
          <Badge
            variant="outline"
            className="text-xs border-cyan-500/50 text-cyan-400"
          >
            {fmt(data.limits.requestsPerMin)} リクエスト/分
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {items.map((item) => {
          const status = statusOf(item.current, item.max);
          const percent = pct(item.current, item.max);
          const isUnlimited = item.max === -1;
          return (
            <div key={item.label}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <item.icon
                    className={`h-4 w-4 ${
                      status === "over"
                        ? "text-red-400"
                        : status === "warn"
                        ? "text-yellow-400"
                        : "text-cyan-400"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium">{item.label}</span>
                  {status === "over" && (
                    <Badge
                      variant="destructive"
                      className="text-[10px] px-1.5 py-0 h-4"
                    >
                      上限
                    </Badge>
                  )}
                  {status === "warn" && (
                    <Badge className="bg-yellow-600 text-[10px] px-1.5 py-0 h-4">
                      <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                      残りわずか
                    </Badge>
                  )}
                </div>
                <span
                  className={`text-sm tabular-nums ${
                    status === "over"
                      ? "text-red-400 font-semibold"
                      : status === "warn"
                      ? "text-yellow-400"
                      : "text-muted-foreground"
                  }`}
                >
                  {item.current.toLocaleString()}
                  <span className="text-muted-foreground">
                    {" "}
                    / {fmt(item.max)}
                  </span>
                </span>
              </div>
              {!isUnlimited ? (
                <div className="relative">
                  <Progress
                    value={percent}
                    className={`h-2.5 ${barColor(status)}`}
                    aria-label={`${item.label}: ${Math.round(percent)}%使用`}
                  />
                  <span className="absolute right-0 -top-5 text-[10px] text-muted-foreground">
                    {Math.round(percent)}%
                  </span>
                </div>
              ) : (
                <div className="h-2.5 rounded-full bg-muted/30 flex items-center justify-center">
                  <span className="text-[10px] text-muted-foreground">
                    無制限
                  </span>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground mt-1">
                {item.sub}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
