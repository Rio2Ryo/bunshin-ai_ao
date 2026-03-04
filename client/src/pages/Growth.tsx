import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/contexts/LanguageContext";
import { Sparkles, Star, Trophy, Heart, Zap, Brain, MessageSquare, Target, Crown, Loader2, Settings, ImageIcon, Stethoscope, Handshake, Info, X } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

// スキルアイコンのマッピング
const skillIcons: Record<string, React.ElementType> = {
  conversation: MessageSquare,
  imageGeneration: ImageIcon,
  analysis: Brain,
  diagnosis: Stethoscope,
  matching: Handshake,
};

// スキル情報
const skillInfo: Record<string, { name: string; description: string; icon: string }> = {
  conversation: { name: "会話スキル", description: "会話の質と深さ", icon: "💬" },
  imageGeneration: { name: "画像生成スキル", description: "画像を生成する力", icon: "🎨" },
  analysis: { name: "分析スキル", description: "情報を整理・分析する力", icon: "📊" },
  diagnosis: { name: "診断スキル", description: "性格や価値観を診断する力", icon: "🔮" },
  matching: { name: "マッチングスキル", description: "相性の良い人を見つける力", icon: "🤝" },
};

// レベルに応じた精度表示（AIプロバイダー名を隠す）
const levelQualityLabels: Record<number, string> = {
  1: "基本",
  2: "標準",
  3: "高品質",
  4: "プレミアム",
  5: "最高精度",
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

type SkillType = "conversation" | "imageGeneration" | "analysis" | "diagnosis" | "matching";

export default function Growth() {
  const { t } = useTranslation();
  usePageMeta({ title: t("growth.title"), description: t("growth.description"), path: "/growth" });
  const { data: growthStatus, isLoading: statusLoading, isError: statusError, refetch: refetchStatus } = trpc.growth.getStatus.useQuery();
  const { data: skillsData, isLoading: skillsLoading, isError: skillsError, refetch: refetchSkills } = trpc.growth.getSkills.useQuery();
  const { data: milestonesData, isLoading: milestonesLoading, isError: milestonesError } = trpc.growth.getMilestones.useQuery();
  const { data: areSkillsConfigured, refetch: refetchSkillsConfigured } = trpc.growth.areSkillsConfigured.useQuery();
  const { data: availablePoints } = trpc.growth.getAvailableSkillPoints.useQuery({ isCampaign: true }); // キャンペーン中

  const setSkillLevelsMutation = trpc.growth.setSkillLevels.useMutation({
    onSuccess: () => {
      toast.success("スキルレベルを設定しました！");
      refetchStatus();
      refetchSkills();
      refetchSkillsConfigured();
      setShowSkillSetup(false);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const [showSkillSetup, setShowSkillSetup] = useState(false);
  const [hasAutoShownDialog, setHasAutoShownDialog] = useState(false);
  const [skillLevels, setSkillLevels] = useState<Record<SkillType, number>>({
    conversation: 5,
    imageGeneration: 5,
    analysis: 5,
    diagnosis: 5,
    matching: 5,
  });

  const isLoading = statusLoading || skillsLoading || milestonesLoading;
  const isError = statusError || skillsError || milestonesError;

  // スキルが未設定の場合は自動でダイアログを表示（初回のみ）
  useEffect(() => {
    if (areSkillsConfigured === false && !showSkillSetup && !hasAutoShownDialog && growthStatus) {
      setShowSkillSetup(true);
      setHasAutoShownDialog(true);
    }
  }, [areSkillsConfigured, showSkillSetup, hasAutoShownDialog, growthStatus]);

  const totalPoints = Object.values(skillLevels).reduce((sum, level) => sum + level, 0);
  const maxPoints = availablePoints || 25; // キャンペーン時は25
  const remainingPoints = maxPoints - totalPoints;

  const handleSkillChange = (skill: SkillType, value: number[]) => {
    const newValue = value[0];
    const currentValue = skillLevels[skill];
    const diff = newValue - currentValue;
    
    // ポイントが足りない場合は変更しない
    if (diff > 0 && remainingPoints < diff) {
      return;
    }
    
    setSkillLevels(prev => ({ ...prev, [skill]: newValue }));
  };

  const handleSaveSkills = () => {
    if (totalPoints > maxPoints) {
      toast.error(`合計ポイントが上限（${maxPoints}）を超えています`);
      return;
    }
    
    setSkillLevelsMutation.mutate({
      skillLevels,
      isCampaign: true, // キャンペーン中
    });
  };

  const handleCloseDialog = () => {
    setShowSkillSetup(false);
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  if (isError) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
          <p className="text-muted-foreground">育成データの読み込みに失敗しました</p>
          <button onClick={() => window.location.reload()} className="text-primary underline text-sm">再読み込み</button>
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
              <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
              {t("growth.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("growth.description")}
            </p>
          </div>
          <Button 
            variant="outline" 
            onClick={() => setShowSkillSetup(true)}
            className="flex items-center gap-2 w-full sm:w-auto"
          >
            <Settings className="h-4 w-4" />
            スキル設定
          </Button>
        </div>

        {/* キャンペーンバナー */}
        {!areSkillsConfigured && (
          <Card className="bg-gradient-to-r from-yellow-500/10 via-orange-500/10 to-red-500/10 border-yellow-500/30">
            <CardContent className="py-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="text-3xl sm:text-4xl">🎉</div>
                <div className="flex-1">
                  <h3 className="font-bold text-base sm:text-lg">オープニングキャンペーン実施中！</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    今なら全スキルをレベル5（最大）でスタートできます！
                  </p>
                </div>
                <Button 
                  onClick={() => setShowSkillSetup(true)} 
                  className="bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 w-full sm:w-auto"
                >
                  スキルを設定する
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* メインステータスカード */}
        <Card className="bg-gradient-to-br from-primary/10 via-background to-secondary/10 border-primary/20">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row items-center gap-6">
              {/* アバター・進化タイプ */}
              <div className="flex flex-col items-center gap-2">
                <div className="relative">
                  <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-4xl sm:text-5xl shadow-lg">
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
                    <h2 className="text-lg sm:text-xl font-bold">{status?.evolutionInfo?.name || "見習い"}</h2>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      次のレベルまで: {status?.expToNextLevel || 0} EXP
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl sm:text-2xl font-bold text-primary">{status?.experience?.toLocaleString() || 0}</p>
                    <p className="text-xs text-muted-foreground">{t("growth.experience")}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs sm:text-sm">
                    <span>EXP</span>
                    <span>{status?.experience || 0} / {(status?.expToNextLevel || 0) + (status?.experience || 0)}</span>
                  </div>
                  <Progress value={levelProgress} className="h-2 sm:h-3" />
                </div>

                {/* ステータスバー */}
                <div className="grid grid-cols-3 gap-2 sm:gap-4 pt-2">
                  <div className="flex items-center gap-1 sm:gap-2">
                    <Heart className="h-3 w-3 sm:h-4 sm:w-4 text-red-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-[10px] sm:text-xs">
                        <span>元気度</span>
                        <span>{status?.energy || 100}%</span>
                      </div>
                      <Progress value={status?.energy || 100} className="h-1 sm:h-1.5 bg-red-100" />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 sm:gap-2">
                    <Zap className="h-3 w-3 sm:h-4 sm:w-4 text-yellow-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-[10px] sm:text-xs">
                        <span>満腹度</span>
                        <span>{status?.fullness || 100}%</span>
                      </div>
                      <Progress value={status?.fullness || 100} className="h-1 sm:h-1.5 bg-yellow-100" />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 sm:gap-2">
                    <Star className="h-3 w-3 sm:h-4 sm:w-4 text-blue-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-[10px] sm:text-xs">
                        <span>機嫌</span>
                        <span>{status?.mood || 100}%</span>
                      </div>
                      <Progress value={status?.mood || 100} className="h-1 sm:h-1.5 bg-blue-100" />
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
            <TabsTrigger value="skills" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
              <Zap className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden xs:inline">スキル</span>
              <span className="xs:hidden">スキル</span>
            </TabsTrigger>
            <TabsTrigger value="milestones" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
              <Trophy className="h-3 w-3 sm:h-4 sm:w-4" />
              <span>{t("growth.milestones")}</span>
            </TabsTrigger>
            <TabsTrigger value="evolution" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
              <Crown className="h-3 w-3 sm:h-4 sm:w-4" />
              <span>{t("growth.evolution")}</span>
            </TabsTrigger>
          </TabsList>

          {/* スキルタブ */}
          <TabsContent value="skills" className="space-y-4">
            <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {skillsData?.map((skill) => {
                const info = skillInfo[skill.skillType] || { name: skill.skillType, description: "スキル", icon: "⭐" };
                
                return (
                  <Card key={skill.skillType} className="hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2 p-3 sm:p-6 sm:pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-lg bg-primary/10 flex items-center justify-center text-lg sm:text-xl">
                            {info.icon}
                          </div>
                          <div>
                            <CardTitle className="text-sm sm:text-base">{info.name}</CardTitle>
                            <CardDescription className="text-xs">Lv.{skill.level} / 5</CardDescription>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px] sm:text-xs">
                          {levelQualityLabels[skill.level] || "基本"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                      <p className="text-xs sm:text-sm text-muted-foreground mb-2 sm:mb-3">{info.description}</p>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((level) => (
                          <div
                            key={level}
                            className={`flex-1 h-1.5 sm:h-2 rounded ${level <= skill.level ? 'bg-primary' : 'bg-muted'}`}
                          />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {(!skillsData || skillsData.length === 0) && (
                <Card className="col-span-full">
                  <CardContent className="py-6 sm:py-8 text-center text-muted-foreground">
                    <Zap className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-3 sm:mb-4 opacity-50" />
                    <p className="text-sm sm:text-base">まだスキルを設定していません</p>
                    <Button onClick={() => setShowSkillSetup(true)} className="mt-3 sm:mt-4">
                      スキルを設定する
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* 図鑑タブ */}
          <TabsContent value="milestones" className="space-y-4">
            <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {milestonesData?.map((milestone) => (
                <Card 
                  key={milestone.id} 
                  className="transition-all bg-primary/5 border-primary/20"
                >
                  <CardHeader className="pb-2 p-3 sm:p-6 sm:pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-lg flex items-center justify-center text-xl sm:text-2xl bg-primary/10">
                          {milestone.icon || "🏆"}
                        </div>
                        <div>
                          <CardTitle className="text-sm sm:text-base">{milestone.title}</CardTitle>
                          {milestone.achievedAt && (
                            <CardDescription className="text-xs">
                              {new Date(milestone.achievedAt).toLocaleDateString('ja-JP')}達成
                            </CardDescription>
                          )}
                        </div>
                      </div>
                      <Badge className="bg-primary text-xs">達成</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                    <p className="text-xs sm:text-sm text-muted-foreground">{milestone.description}</p>
                  </CardContent>
                </Card>
              ))}
              {(!milestonesData || milestonesData.length === 0) && (
                <Card className="col-span-full">
                  <CardContent className="py-6 sm:py-8 text-center text-muted-foreground">
                    <Trophy className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-3 sm:mb-4 opacity-50" />
                    <p className="text-sm sm:text-base">まだマイルストーンを達成していません</p>
                    <p className="text-xs sm:text-sm">様々なアクションを行うとマイルストーンが達成されます</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* 進化タブ */}
          <TabsContent value="evolution" className="space-y-4">
            <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
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
                    <CardHeader className="pb-2 p-3 sm:p-6 sm:pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`h-10 w-10 sm:h-12 sm:w-12 rounded-lg flex items-center justify-center text-2xl sm:text-3xl ${isUnlocked ? 'bg-primary/10' : 'bg-muted'}`}>
                            {isUnlocked ? evo.icon : "❓"}
                          </div>
                          <div>
                            <CardTitle className="text-sm sm:text-base">{isUnlocked ? evo.name : "???"}</CardTitle>
                            <CardDescription className="text-xs">Lv.{evo.minLevel}以上</CardDescription>
                          </div>
                        </div>
                        {isCurrent && <Badge className="bg-primary text-xs">現在</Badge>}
                        {!isUnlocked && <Badge variant="outline" className="text-xs">未解放</Badge>}
                      </div>
                    </CardHeader>
                    <CardContent className="p-3 sm:p-6 pt-0 sm:pt-0">
                      <p className="text-xs sm:text-sm text-muted-foreground">
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

      {/* スキル設定ダイアログ */}
      <Dialog open={showSkillSetup} onOpenChange={setShowSkillSetup}>
        <DialogContent className="w-[95vw] max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          {/* カスタム閉じるボタン */}
          <button
            onClick={handleCloseDialog}
            className="absolute right-3 top-3 sm:right-4 sm:top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground z-10"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">閉じる</span>
          </button>

          <DialogHeader className="pr-8">
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Settings className="h-4 w-4 sm:h-5 sm:w-5" />
              スキルレベル設定
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              各スキルにポイントを割り振ってください。レベルが高いほど高精度になります。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 sm:py-4">
            {/* ポイント表示 */}
            <div className="flex items-center justify-between p-3 sm:p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                <span className="text-sm sm:text-base font-medium">残りポイント</span>
              </div>
              <div className="flex items-center gap-1 sm:gap-2">
                <span className={`text-xl sm:text-2xl font-bold ${remainingPoints < 0 ? 'text-destructive' : 'text-primary'}`}>
                  {remainingPoints}
                </span>
                <span className="text-xs sm:text-sm text-muted-foreground">/ {maxPoints}</span>
              </div>
            </div>

            {/* キャンペーン情報 */}
            <div className="flex items-start gap-2 p-2 sm:p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30">
              <Info className="h-4 w-4 sm:h-5 sm:w-5 text-yellow-600 mt-0.5 shrink-0" />
              <div className="text-xs sm:text-sm">
                <p className="font-medium text-yellow-700">オープニングキャンペーン中！</p>
                <p className="text-yellow-600">25ポイント（オール5）で開始できます。</p>
              </div>
            </div>

            {/* スキルスライダー */}
            <div className="space-y-4 sm:space-y-5">
              {(Object.keys(skillInfo) as SkillType[]).map((skillType) => {
                const info = skillInfo[skillType];
                const level = skillLevels[skillType];
                
                return (
                  <div key={skillType} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-primary/10 flex items-center justify-center text-base sm:text-lg">
                          {info.icon}
                        </div>
                        <div>
                          <p className="text-sm sm:text-base font-medium">{info.name}</p>
                          <p className="text-[10px] sm:text-xs text-muted-foreground">{info.description}</p>
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-sm sm:text-lg px-2 sm:px-3">
                        Lv.{level}
                      </Badge>
                    </div>
                    <Slider
                      value={[level]}
                      onValueChange={(value) => handleSkillChange(skillType, value)}
                      min={1}
                      max={5}
                      step={1}
                      className="w-full"
                    />
                    <div className="flex justify-between text-[10px] sm:text-xs text-muted-foreground px-1">
                      <span>基本</span>
                      <span>標準</span>
                      <span>最高</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 pt-2">
            <Button 
              variant="outline" 
              onClick={handleCloseDialog}
              className="w-full sm:w-auto order-2 sm:order-1"
            >
              キャンセル
            </Button>
            <Button 
              onClick={handleSaveSkills}
              disabled={remainingPoints < 0 || setSkillLevelsMutation.isPending}
              className="w-full sm:w-auto order-1 sm:order-2"
            >
              {setSkillLevelsMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  保存中...
                </>
              ) : (
                "スキルを設定"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
