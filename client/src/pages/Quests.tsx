import { useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/contexts/LanguageContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Trophy,
  Target,
  Zap,
  Star,
  CheckCircle2,
  Circle,
  Flame,
  MessageSquare,
  Users,
  Brain,
  FileUp,
  Link2,
  Sparkles,
  Crown,
  Gift
} from "lucide-react";

const categoryIcons: Record<string, React.ReactNode> = {
  "対話": <MessageSquare className="h-5 w-5" />,
  "プロフィール": <Users className="h-5 w-5" />,
  "データ蓄積": <FileUp className="h-5 w-5" />,
  "診断": <Brain className="h-5 w-5" />,
  "評価": <Target className="h-5 w-5" />,
  "ソーシャル": <Users className="h-5 w-5" />,
  "マッチング": <Sparkles className="h-5 w-5" />,
  "外部連携": <Link2 className="h-5 w-5" />,
  "継続利用": <Flame className="h-5 w-5" />,
  "マイルストーン": <Trophy className="h-5 w-5" />,
  "特別": <Crown className="h-5 w-5" />,
};

const categoryColors: Record<string, string> = {
  "対話": "bg-blue-500",
  "プロフィール": "bg-purple-500",
  "データ蓄積": "bg-green-500",
  "診断": "bg-pink-500",
  "評価": "bg-amber-500",
  "ソーシャル": "bg-indigo-500",
  "マッチング": "bg-rose-500",
  "外部連携": "bg-cyan-500",
  "継続利用": "bg-orange-500",
  "マイルストーン": "bg-yellow-500",
  "特別": "bg-violet-500",
};


export default function Quests() {
  const { t } = useTranslation();
  usePageMeta({ title: t("quests.title"), description: t("quests.description"), path: "/quests" });
  const { data: quests, isLoading } = trpc.points.getQuests.useQuery();
  const { data: balance, refetch: refetchBalance } = trpc.points.getBalance.useQuery();
  
  const dailyLoginMutation = trpc.points.checkDailyLogin.useMutation({
    onSuccess: (data) => {
      if (data.awarded) {
        toast.success(`デイリーログインボーナス +${data.points}pt！`, {
          description: `連続ログイン: ${data.streak}日目`,
        });
        if (data.streakBonus) {
          toast.success(`${data.streakBonus.name}達成！ +${data.streakBonus.points}pt`, {
            icon: <Trophy className="h-5 w-5 text-yellow-500" />,
          });
        }
        refetchBalance();
      }
    },
  });

  const milestoneMutation = trpc.points.checkMilestones.useMutation({
    onSuccess: (data) => {
      data.awarded.forEach((milestone) => {
        toast.success(`${milestone.name}達成！ +${milestone.points}pt`, {
          icon: <Trophy className="h-5 w-5 text-yellow-500" />,
        });
      });
      if (data.awarded.length > 0) {
        refetchBalance();
      }
    },
  });

  // ページ読み込み時にデイリーログインとマイルストーンをチェック
  useEffect(() => {
    dailyLoginMutation.mutate();
    milestoneMutation.mutate();
  }, []);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Target className="h-6 w-6 text-primary" />
              {t("quests.title")}
            </h1>
            <p className="text-muted-foreground">
              {t("quests.description")}
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-amber-600">
              {balance?.balance?.toLocaleString() ?? 0}
              <span className="text-lg ml-1">pt</span>
            </div>
            <p className="text-sm text-muted-foreground">現在のポイント</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-green-100">
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{quests?.stats.totalCompleted ?? 0}</p>
                  <p className="text-sm text-muted-foreground">{t("quests.completed")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-amber-100">
                  <Star className="h-6 w-6 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{quests?.stats.totalPoints?.toLocaleString() ?? 0}</p>
                  <p className="text-sm text-muted-foreground">{t("quests.reward")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-purple-100">
                  <Zap className="h-6 w-6 text-purple-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{quests?.categories.length ?? 0}</p>
                  <p className="text-sm text-muted-foreground">カテゴリ</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quest Categories */}
        <Tabs defaultValue={quests?.categories[0]?.name ?? "対話"} className="space-y-4">
          <TabsList className="flex flex-wrap h-auto gap-2">
            {quests?.categories.map((category) => (
              <TabsTrigger 
                key={category.name} 
                value={category.name}
                className="flex items-center gap-2"
              >
                {categoryIcons[category.name] ?? <Target className="h-4 w-4" />}
                {category.name}
              </TabsTrigger>
            ))}
          </TabsList>

          {quests?.categories.map((category) => (
            <TabsContent key={category.name} value={category.name} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                {category.quests.map((quest) => (
                  <Card
                    key={quest.id}
                    className={`relative overflow-hidden ${quest.completed ? 'bg-muted/50' : ''}`}
                  >
                    {/* Category color bar */}
                    <div className={`absolute top-0 left-0 w-1 h-full ${categoryColors[category.name] ?? 'bg-gray-500'}`} />

                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          {quest.completed ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : (
                            <Circle className="h-5 w-5 text-muted-foreground" />
                          )}
                          <CardTitle className="text-base">{quest.name}</CardTitle>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-3">{quest.description}</p>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Gift className="h-4 w-4 text-amber-500" />
                          <span className="font-bold text-amber-600">{quest.points} pt</span>
                        </div>

                        {quest.completed && (
                          <div className="text-sm text-muted-foreground">
                            <span className="flex items-center gap-1 text-green-600">
                              <CheckCircle2 className="h-4 w-4" />
                              達成済み
                            </span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {/* Tips */}
        <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-800">
              <Sparkles className="h-5 w-5" />
              ポイントを効率よく貯めるコツ
            </CardTitle>
          </CardHeader>
          <CardContent className="text-amber-900">
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <Flame className="h-4 w-4 mt-0.5 text-orange-500" />
                <span><strong>毎日ログイン</strong>して連続ログインボーナスを獲得しよう（7日で+10pt、30日で+50pt）</span>
              </li>
              <li className="flex items-start gap-2">
                <MessageSquare className="h-4 w-4 mt-0.5 text-blue-500" />
                <span><strong>分身AIと会話</strong>するたびに1ptが貯まります。100回で+50ptボーナス！</span>
              </li>
              <li className="flex items-start gap-2">
                <Link2 className="h-4 w-4 mt-0.5 text-cyan-500" />
                <span><strong>外部AI APIを接続</strong>すると1000ptの大型ボーナスが獲得できます</span>
              </li>
              <li className="flex items-start gap-2">
                <Users className="h-4 w-4 mt-0.5 text-indigo-500" />
                <span><strong>友達を招待</strong>して登録してもらうと50pt、友達が増えるとマイルストーンボーナスも</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
