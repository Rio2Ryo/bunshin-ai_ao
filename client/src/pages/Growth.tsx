import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Sparkles, Star, Trophy, Heart, Zap, Brain, MessageSquare, Users, Palette, Search, Target, Crown, Loader2 } from "lucide-react";

// スキルアイコンのマッピング
const skillIcons: Record<string, React.ElementType> = {
  conversation: MessageSquare,
  empathy: Heart,
  analysis: Brain,
  creativity: Palette,
  social: Users,
  research: Search,
};

// 進化タイプアイコンのマッピング
const evolutionIcons: Record<string, string> = {
  basic: "🥚",
  social: "🤝",
  creative: "🎨",
  analyst: "📊",
  empath: "💖",
  sage: "📚",
  legendary: "👑",
};

export default function Growth() {
  const { data: growthStatus, isLoading: statusLoading } = trpc.growth.getStatus.useQuery();
  const { data: skillsData, isLoading: skillsLoading } = trpc.growth.getSkills.useQuery();
  const { data: milestonesData, isLoading: milestonesLoading } = trpc.growth.getMilestones.useQuery();

  const isLoading = statusLoading || skillsLoading || milestonesLoading;

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  const status = growthStatus;
  const levelProgress = status ? (status.progressToNextLevel || 0) : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* ヘッダー */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" />
              分身AI育成
            </h1>
            <p className="text-muted-foreground">
              あなたの分身AIを育てて、より強力なパートナーに成長させましょう
            </p>
          </div>
        </div>

        {/* メインステータスカード */}
        <Card className="bg-gradient-to-br from-primary/10 via-background to-secondary/10 border-primary/20">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row items-center gap-6">
              {/* アバター・進化タイプ */}
              <div className="flex flex-col items-center gap-2">
                <div className="relative">
                  <div className="h-24 w-24 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-5xl shadow-lg">
                    {status?.evolutionType ? evolutionIcons[status.evolutionType] || "🥚" : "🥚"}
                  </div>
                  <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-1 shadow">
                    <Badge variant="secondary" className="text-xs font-bold">
                      Lv.{status?.level || 1}
                    </Badge>
                  </div>
                </div>
                <span className="text-sm font-medium text-muted-foreground">
                  {status?.evolutionInfo?.name || "基本型"}
                </span>
              </div>

              {/* レベル・経験値 */}
              <div className="flex-1 w-full space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold">{status?.evolutionInfo?.name || "見習い"}</h2>
                    <p className="text-sm text-muted-foreground">
                      次のレベルまで: {status?.expToNextLevel || 0} EXP
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-primary">{status?.experience?.toLocaleString() || 0}</p>
                    <p className="text-xs text-muted-foreground">総経験値</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>EXP</span>
                    <span>{status?.experience || 0} / {(status?.expToNextLevel || 0) + (status?.experience || 0)}</span>
                  </div>
                  <Progress value={levelProgress} className="h-3" />
                </div>

                {/* ステータスバー */}
                <div className="grid grid-cols-3 gap-4 pt-2">
                  <div className="flex items-center gap-2">
                    <Heart className="h-4 w-4 text-red-500" />
                    <div className="flex-1">
                      <div className="flex justify-between text-xs">
                        <span>元気度</span>
                        <span>{status?.energy || 100}%</span>
                      </div>
                      <Progress value={status?.energy || 100} className="h-1.5 bg-red-100" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-yellow-500" />
                    <div className="flex-1">
                      <div className="flex justify-between text-xs">
                        <span>満腹度</span>
                        <span>{status?.fullness || 100}%</span>
                      </div>
                      <Progress value={status?.fullness || 100} className="h-1.5 bg-yellow-100" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 text-blue-500" />
                    <div className="flex-1">
                      <div className="flex justify-between text-xs">
                        <span>機嫌</span>
                        <span>{status?.mood || 100}%</span>
                      </div>
                      <Progress value={status?.mood || 100} className="h-1.5 bg-blue-100" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* タブコンテンツ */}
        <Tabs defaultValue="skills" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="skills" className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              スキル
            </TabsTrigger>
            <TabsTrigger value="milestones" className="flex items-center gap-2">
              <Trophy className="h-4 w-4" />
              図鑑
            </TabsTrigger>
            <TabsTrigger value="evolution" className="flex items-center gap-2">
              <Crown className="h-4 w-4" />
              進化
            </TabsTrigger>
          </TabsList>

          {/* スキルタブ */}
          <TabsContent value="skills" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {skillsData?.map((skill) => {
                const Icon = skillIcons[skill.skillType] || Target;
                const nextLevelExp = (skill.level + 1) * 100; // 簡易計算
                const progress = (skill.experience / nextLevelExp) * 100;
                return (
                  <Card key={skill.skillType} className="hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-xl">
                            {skill.definition?.icon || "⭐"}
                          </div>
                          <div>
                            <CardTitle className="text-base">{skill.definition?.name || skill.skillType}</CardTitle>
                            <CardDescription className="text-xs">Lv.{skill.level}</CardDescription>
                          </div>
                        </div>
                        <Badge variant="outline">{skill.experience} EXP</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-3">{skill.definition?.description || "スキル"}</p>
                      <Progress value={progress} className="h-2" />
                      <p className="text-xs text-muted-foreground mt-1 text-right">
                        次のレベルまで: {nextLevelExp - skill.experience} EXP
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
              {(!skillsData || skillsData.length === 0) && (
                <Card className="col-span-full">
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <Zap className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>まだスキルを習得していません</p>
                    <p className="text-sm">分身AIを使い続けるとスキルが習得されます</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* 図鑑タブ */}
          <TabsContent value="milestones" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {milestonesData?.map((milestone) => (
                <Card 
                  key={milestone.id} 
                  className="transition-all bg-primary/5 border-primary/20"
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-10 w-10 rounded-lg flex items-center justify-center text-2xl bg-primary/10">
                          {milestone.icon || "🏆"}
                        </div>
                        <div>
                          <CardTitle className="text-base">{milestone.title}</CardTitle>
                          {milestone.achievedAt && (
                            <CardDescription className="text-xs">
                              {new Date(milestone.achievedAt).toLocaleDateString('ja-JP')}達成
                            </CardDescription>
                          )}
                        </div>
                      </div>
                      <Badge className="bg-primary">達成</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{milestone.description}</p>
                  </CardContent>
                </Card>
              ))}
              {(!milestonesData || milestonesData.length === 0) && (
                <Card className="col-span-full">
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <Trophy className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>まだマイルストーンを達成していません</p>
                    <p className="text-sm">様々なアクションを行うとマイルストーンが達成されます</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* 進化タブ */}
          <TabsContent value="evolution" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[
                { type: "basic", name: "基本型", icon: "🥚", description: "生まれたての分身AI", minLevel: 1 },
                { type: "social", name: "ソーシャル型", icon: "🤝", description: "人間関係に強い分身AI", minLevel: 15 },
                { type: "creative", name: "クリエイティブ型", icon: "🎨", description: "創造性が高い分身AI", minLevel: 20 },
                { type: "analyst", name: "アナリスト型", icon: "📊", description: "分析力が高い分身AI", minLevel: 25 },
                { type: "empath", name: "エンパス型", icon: "💖", description: "共感力が高い分身AI", minLevel: 30 },
                { type: "sage", name: "賢者型", icon: "📚", description: "知識が豊富な分身AI", minLevel: 50 },
                { type: "legendary", name: "レジェンド型", icon: "👑", description: "すべてを極めた分身AI", minLevel: 80 },
              ].map((evo) => {
                const isUnlocked = (status?.level || 1) >= evo.minLevel;
                const isCurrent = status?.evolutionType === evo.type;
                return (
                  <Card 
                    key={evo.type} 
                    className={`transition-all ${isCurrent ? 'ring-2 ring-primary bg-primary/5' : ''} ${!isUnlocked ? 'opacity-50' : ''}`}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`h-12 w-12 rounded-lg flex items-center justify-center text-3xl ${isUnlocked ? 'bg-primary/10' : 'bg-muted'}`}>
                            {isUnlocked ? evo.icon : "❓"}
                          </div>
                          <div>
                            <CardTitle className="text-base">{isUnlocked ? evo.name : "???"}</CardTitle>
                            <CardDescription className="text-xs">Lv.{evo.minLevel}以上</CardDescription>
                          </div>
                        </div>
                        {isCurrent && <Badge className="bg-primary">現在</Badge>}
                        {!isUnlocked && <Badge variant="outline">未解放</Badge>}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        {isUnlocked ? evo.description : "レベルを上げると解放されます"}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
