import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Crown, Users, MessageSquare, Database, FileUp, Zap, Check, Sparkles } from "lucide-react";
import { toast } from "sonner";

const planDetails = {
  free: {
    name: "フリープラン",
    price: "無料",
    color: "bg-gray-500",
    icon: Zap,
  },
  premium: {
    name: "プレミアム",
    price: "¥980/月",
    color: "bg-cyan-500",
    icon: Crown,
  },
  enterprise: {
    name: "エンタープライズ",
    price: "お問い合わせ",
    color: "bg-purple-500",
    icon: Sparkles,
  },
};

export default function Plan() {
  const { user } = useAuth();
  const { data: stats, isLoading, refetch } = trpc.plan.getStats.useQuery();
  const upgradeMutation = trpc.plan.upgrade.useMutation({
    onSuccess: () => {
      toast.success("プランを変更しました");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  if (isLoading || !stats) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
        </div>
      </DashboardLayout>
    );
  }

  const currentPlan = stats.plan;
  const PlanIcon = planDetails[currentPlan].icon;

  const getUsagePercent = (current: number, max: number) => {
    if (max === -1) return 0; // Unlimited
    return Math.min((current / max) * 100, 100);
  };

  const formatLimit = (value: number) => {
    return value === -1 ? "無制限" : value.toString();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
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
              <Badge variant="outline" className="text-lg px-4 py-2 border-cyan-500 text-cyan-400">
                {planDetails[currentPlan].price}
              </Badge>
            </div>
          </CardHeader>
        </Card>

        {/* Usage Stats */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="bg-gray-900/50 border-gray-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4 text-cyan-400" />
                友達数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats.usage.friends} / {formatLimit(stats.limits.maxFriends)}
              </div>
              <Progress 
                value={getUsagePercent(stats.usage.friends, stats.limits.maxFriends)} 
                className="mt-2 h-2"
              />
            </CardContent>
          </Card>

          <Card className="bg-gray-900/50 border-gray-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-cyan-400" />
                今月のマッチング
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats.usage.matchingsThisMonth} / {formatLimit(stats.limits.maxMatchingsPerMonth)}
              </div>
              <Progress 
                value={getUsagePercent(stats.usage.matchingsThisMonth, stats.limits.maxMatchingsPerMonth)} 
                className="mt-2 h-2"
              />
            </CardContent>
          </Card>

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
                  <div className="text-2xl font-bold mt-2">{details.price}</div>
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
                    ) : plan === "enterprise" ? (
                      <Button className="w-full" variant="outline">
                        お問い合わせ
                      </Button>
                    ) : (
                      <Button 
                        className="w-full bg-cyan-600 hover:bg-cyan-700"
                        onClick={() => upgradeMutation.mutate({ plan })}
                        disabled={upgradeMutation.isPending}
                      >
                        {plan === "premium" && currentPlan === "free" ? "アップグレード" : "変更する"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </DashboardLayout>
  );
}
