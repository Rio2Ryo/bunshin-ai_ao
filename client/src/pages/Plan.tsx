import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { Crown, Users, MessageSquare, Database, FileUp, Zap, Check, Sparkles, CreditCard, Settings, AlertTriangle, Shield, Pause, Gift } from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { useSearch } from "wouter";
import { useTranslation } from "@/contexts/LanguageContext";

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
  const { t } = useTranslation();
  usePageMeta({ title: "プラン", description: "料金プランの確認と変更", path: "/plan" });
  const { user } = useAuth();
  const search = useSearch();
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<"premium" | "enterprise">("premium");
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");

  const { data: stats, isLoading, refetch } = trpc.plan.getStats.useQuery();
  const { data: subscription } = trpc.plan.getSubscription.useQuery();
  const { data: dunningStatus } = trpc.plan.getDunningStatus.useQuery();
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelStep, setCancelStep] = useState<"reason" | "offer" | "confirm">("reason");
  const [cancelReason, setCancelReason] = useState("");

  const cancelMutation = trpc.plan.cancelSubscription.useMutation({
    onSuccess: (data) => {
      toast.success(`解約予約が完了しました。${new Date(data.cancelAt).toLocaleDateString("ja-JP")}まで現プランをご利用いただけます。`);
      setShowCancelDialog(false);
      setCancelStep("reason");
      refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const handleCancelFlow = () => {
    setCancelStep("reason");
    setShowCancelDialog(true);
  };

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
    return value === -1 ? t("plan.unlimited") : value.toString();
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
                  <CardDescription>{t("plan.currentPlan")}</CardDescription>
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
                    {t("plan.manage")}
                  </Button>
                )}
                {currentPlan !== "free" && !subscription?.cancelAtPeriodEnd && (
                  <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={handleCancelFlow}>
                    {t("plan.cancel")}
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
            {dunningStatus && (
              <div className="mt-4 p-3 rounded-lg border border-red-500/50 bg-red-950/30 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-red-400">決済失敗</p>
                  <p className="text-xs text-red-400/70">
                    {dunningStatus.daysRemaining > 0
                      ? `支払い方法を${dunningStatus.daysRemaining}日以内に更新してください`
                      : "猶予期間が終了しました。今すぐ更新してください"}
                  </p>
                </div>
                <Button size="sm" className="bg-red-600 hover:bg-red-700" onClick={() => portalMutation.mutate()}>
                  支払い更新
                </Button>
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
                {t("plan.knowledgeBase")}
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
                {t("plan.fileUpload")}
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
        <h2 id="pricing-section" className="text-xl font-bold mt-8 scroll-mt-20">{t("plan.comparison")}</h2>
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
                    {t("plan.externalAI")}
                  </div>

                  <div className="pt-4">
                    {isCurrentPlan ? (
                      <Button disabled className="w-full" variant="outline">
                        {t("plan.currentPlan")}
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
                        {t("plan.upgrade")}
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
                <h3 className="font-semibold text-yellow-500">{t("plan.testMode")}</h3>
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
                <div className="font-semibold">{t("plan.monthly")}</div>
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
                <div className="font-semibold">{t("plan.yearly")}</div>
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
              {t("plan.checkout")}
            </Button>

            <p className="text-xs text-gray-500 text-center">
              決済はStripeで安全に処理されます
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel / Retention Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent className="bg-gray-900 border-gray-700">
          {cancelStep === "reason" && (
            <>
              <DialogHeader>
                <DialogTitle>解約の理由を教えてください</DialogTitle>
                <DialogDescription>サービス改善のため、よろしければ理由をお聞かせください</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 mt-4">
                {["料金が高い", "使用頻度が低い", "必要な機能がない", "他のサービスに乗り換え", "その他"].map((reason) => (
                  <button
                    key={reason}
                    onClick={() => { setCancelReason(reason); setCancelStep("offer"); }}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      cancelReason === reason ? "border-cyan-500 bg-cyan-500/10" : "border-gray-700 hover:border-gray-600"
                    }`}
                  >
                    {reason}
                  </button>
                ))}
                <Textarea
                  placeholder="詳しい理由（任意）"
                  className="mt-2"
                  value={cancelReason.startsWith("詳細:") ? cancelReason.slice(3) : ""}
                  onChange={(e) => setCancelReason(`詳細:${e.target.value}`)}
                />
              </div>
            </>
          )}
          {cancelStep === "offer" && (
            <>
              <DialogHeader>
                <DialogTitle>特別オファー</DialogTitle>
                <DialogDescription>解約の前に、こちらのオプションはいかがですか？</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 mt-4">
                <button
                  onClick={() => {
                    toast.info("割引クーポンは次回更新時に自動適用されます（開発中）");
                    setShowCancelDialog(false);
                  }}
                  className="w-full p-4 rounded-lg border border-green-500/30 bg-green-950/20 hover:bg-green-950/30 text-left transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Gift className="h-5 w-5 text-green-400" />
                    <div>
                      <p className="font-semibold text-green-400">次月50%割引</p>
                      <p className="text-xs text-gray-400">来月のお支払いが半額になります</p>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => {
                    toast.info("一時停止機能は開発中です。現時点ではサブスクリプション管理から操作可能です。");
                    setShowCancelDialog(false);
                  }}
                  className="w-full p-4 rounded-lg border border-yellow-500/30 bg-yellow-950/20 hover:bg-yellow-950/30 text-left transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Pause className="h-5 w-5 text-yellow-400" />
                    <div>
                      <p className="font-semibold text-yellow-400">1ヶ月一時停止</p>
                      <p className="text-xs text-gray-400">データを保持したまま1ヶ月休止できます</p>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => setCancelStep("confirm")}
                  className="w-full p-3 rounded-lg border border-gray-700 hover:border-gray-600 text-left text-sm text-muted-foreground transition-colors"
                >
                  それでも解約する
                </button>
              </div>
            </>
          )}
          {cancelStep === "confirm" && (
            <>
              <DialogHeader>
                <DialogTitle className="text-red-400">本当に解約しますか？</DialogTitle>
                <DialogDescription>
                  解約すると現在の請求期間末にフリープランに変更されます。データは保持されますが、プレミアム機能は使用できなくなります。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-4 flex gap-2">
                <Button variant="outline" onClick={() => setShowCancelDialog(false)}>
                  キャンセル
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => cancelMutation.mutate()}
                  disabled={cancelMutation.isPending}
                >
                  {cancelMutation.isPending ? "処理中..." : "解約を確定する"}
                </Button>
              </DialogFooter>
            </>
          )}
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
    return "[&>div]:bg-cyan-500";
  };

  const remaining = (cur: number, max: number) => {
    if (max === -1) return -1;
    return Math.max(max - cur, 0);
  };

  // Calculate hours until midnight JST for daily reset
  const hoursUntilDailyReset = () => {
    const now = new Date();
    const jst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    return 24 - jst.getHours();
  };

  // Days until end of month for monthly reset
  const daysUntilMonthlyReset = () => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return lastDay - now.getDate();
  };

  const items = [
    {
      icon: Users,
      label: "友達数",
      sub: "上限",
      current: data.usage.friends,
      max: data.limits.maxFriends,
      resetLabel: null as string | null,
    },
    {
      icon: MessageSquare,
      label: "チャット回数",
      sub: "今日 / 1日あたり上限",
      current: data.usage.chatMessagesToday,
      max: data.limits.chatMessagesPerDay,
      resetLabel: `リセットまで約${hoursUntilDailyReset()}時間`,
    },
    {
      icon: Zap,
      label: "マッチング回数",
      sub: "今月 / 月間上限",
      current: data.usage.matchingsThisMonth,
      max: data.limits.matchingsPerMonth,
      resetLabel: `月末リセットまで${daysUntilMonthlyReset()}日`,
    },
  ];

  const hasWarning = items.some(
    (i) => statusOf(i.current, i.max) !== "ok"
  );
  const hasOver = items.some(
    (i) => statusOf(i.current, i.max) === "over"
  );
  const isFree = data.plan === "free";

  return (
    <div className="space-y-3">
      {/* Top-level warning banner */}
      {hasOver && (
        <Card className="border-red-500/50 bg-red-950/30" role="alert">
          <CardContent className="py-3 flex items-center gap-3">
            <div className="p-2 rounded-full bg-red-500/10">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-400">利用制限に達しました</p>
              <p className="text-xs text-red-400/70">
                一部の機能が制限されています。{isFree ? "プランをアップグレードするとすぐに制限が解除されます。" : "リセットまでお待ちください。"}
              </p>
            </div>
            {isFree && (
              <a href="#pricing-section">
                <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white gap-1.5">
                  <Crown className="h-3.5 w-3.5" />
                  アップグレード
                </Button>
              </a>
            )}
          </CardContent>
        </Card>
      )}
      {!hasOver && hasWarning && (
        <Card className="border-yellow-500/40 bg-yellow-950/20" role="alert">
          <CardContent className="py-3 flex items-center gap-3">
            <div className="p-2 rounded-full bg-yellow-500/10">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-yellow-400">利用制限が近づいています</p>
              <p className="text-xs text-yellow-400/70">
                上限の80%以上を使用しています。{isFree ? "アップグレードで上限を大幅に増やせます。" : "リセットまでの残量をご確認ください。"}
              </p>
            </div>
            {isFree && (
              <a href="#pricing-section">
                <Button size="sm" variant="outline" className="border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10 gap-1.5">
                  <Crown className="h-3.5 w-3.5" />
                  プラン確認
                </Button>
              </a>
            )}
          </CardContent>
        </Card>
      )}

      {/* Main rate limit card */}
      <Card
        className={`bg-gray-900/50 ${
          hasOver ? "border-red-500/50" : hasWarning ? "border-yellow-500/50" : "border-gray-700"
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
            const rem = remaining(item.current, item.max);
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
                        上限到達
                      </Badge>
                    )}
                    {status === "warn" && (
                      <Badge className="bg-yellow-600 text-[10px] px-1.5 py-0 h-4">
                        <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                        残りわずか
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!isUnlimited && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          status === "over"
                            ? "bg-red-500/10 text-red-400"
                            : status === "warn"
                            ? "bg-yellow-500/10 text-yellow-400"
                            : "bg-cyan-500/10 text-cyan-400"
                        }`}
                      >
                        残り {rem.toLocaleString()}
                      </span>
                    )}
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
                        {" "}/ {fmt(item.max)}
                      </span>
                    </span>
                  </div>
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
                <div className="flex items-center justify-between mt-1">
                  <p className="text-[11px] text-muted-foreground">
                    {item.sub}
                  </p>
                  {item.resetLabel && !isUnlimited && (
                    <p className="text-[11px] text-muted-foreground">
                      {item.resetLabel}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
