import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Bot, Edit, Loader2, MessageSquare, Save, Sparkles, User, Globe, Eye, EyeOff, Tag, X, Brain, Target, Zap, TrendingUp, BarChart3, Shield, Lock, Users, UserCheck, Check, BookOpen, Plus, Trash2, FileText } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { PersonalityRadarChart } from "@/components/PersonalityRadarChart";
import { PersonalityInterview } from "@/components/PersonalityInterview";
import { MBTIInterview } from "@/components/MBTIInterview";
import { ValueWaveformChart } from "@/components/ValueWaveformChart";
import { ValueScenarioInterview } from "@/components/ValueScenarioInterview";
import { CumulativeWaveformChart } from "@/components/CumulativeWaveformChart";
import { OtherPerspectiveWaveformChart } from "@/components/OtherPerspectiveWaveformChart";

export default function MyTwin() {
  const { data: twin, isLoading, isError, refetch } = trpc.myTwin.get.useQuery();
  const upsertMutation = trpc.myTwin.upsert.useMutation();
  const updateMutation = trpc.myTwin.update.useMutation();
  const updatePublicMutation = trpc.myTwin.updatePublicSettings.useMutation();
  const runFullAnalysisMutation = trpc.myTwin.runFullAnalysis.useMutation();
  const generateSelfWaveformMutation = trpc.myTwin.generateSelfWaveform.useMutation();
  const evaluateByAllTwinsMutation = trpc.myTwin.evaluateByAllTwins.useMutation();
  const generateFriendPredictionsMutation = trpc.friends.generateFriendPredictions.useMutation();

  // Visibility settings
  const { data: visibilityData, refetch: refetchVisibility } = trpc.myTwin.getVisibilitySettings.useQuery();
  const { data: friendsList } = trpc.friends.list.useQuery();
  const [visibility, setVisibility] = useState<"public" | "friends" | "private" | "custom">("public");
  const [selectedViewerIds, setSelectedViewerIds] = useState<number[]>([]);
  const [isSavingVisibility, setIsSavingVisibility] = useState(false);

  useEffect(() => {
    if (visibilityData) {
      setVisibility(visibilityData.visibility as "public" | "friends" | "private" | "custom");
      setSelectedViewerIds(visibilityData.allowedViewers.map((v) => v.id));
    }
  }, [visibilityData]);

  const handleSaveVisibility = async () => {
    setIsSavingVisibility(true);
    try {
      await updateMutation.mutateAsync({
        visibility,
        allowedViewerIds: visibility === "custom" ? selectedViewerIds : undefined,
      });
      toast.success("プライバシー設定を保存しました");
      refetchVisibility();
      refetch();
    } catch (error) {
      toast.error("プライバシー設定の保存に失敗しました");
    } finally {
      setIsSavingVisibility(false);
    }
  };

  const toggleViewer = (friendId: number) => {
    setSelectedViewerIds((prev) =>
      prev.includes(friendId) ? prev.filter((id) => id !== friendId) : [...prev, friendId]
    );
  };

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingWaveform, setIsGeneratingWaveform] = useState(false);
  const [isUpdatingOtherPerspective, setIsUpdatingOtherPerspective] = useState(false);

  // 全ての模倣AIによる評価を実行して累積波形を更新
  const handleGenerateWaveform = async () => {
    setIsGeneratingWaveform(true);
    try {
      const result = await evaluateByAllTwinsMutation.mutateAsync();
      if (result.totalResponses === 0) {
        toast.info("価値観シナリオに回答してから波形を更新してください");
      } else {
        toast.success(`${result.totalEvaluators}人の模倣AIが${result.evaluatedCount}件の回答を評価しました（合計${result.totalEvaluations}件の評価）`);
      }
      refetch();
    } catch (error: any) {
      toast.error(error.message || "波形の更新に失敗しました");
    } finally {
      setIsGeneratingWaveform(false);
    }
  };

  // 他者視点波形を生成（友達の分身AIから予測を取得）
  const handleUpdateOtherPerspective = async () => {
    setIsUpdatingOtherPerspective(true);
    try {
      const result = await generateFriendPredictionsMutation.mutateAsync();
      if (result.friendsProcessed === 0) {
        toast.info("友達がいないか、友達の分身AIが未設定です");
      } else if (result.totalPredictions === 0) {
        toast.info("価値観シナリオに回答してから他者視点波形を生成してください");
      } else {
        toast.success(`${result.friendsProcessed}人の友達から${result.successfulPredictions}件の予測を取得しました`);
      }
      refetch();
    } catch (error: any) {
      toast.error(error.message || "他者視点波形の生成に失敗しました");
    } finally {
      setIsUpdatingOtherPerspective(false);
    }
  };

  const handleRunAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      await runFullAnalysisMutation.mutateAsync();
      toast.success("人格分析が完了しました");
      refetch();
    } catch (error) {
      toast.error("分析中にエラーが発生しました");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState("");
  const [rawInput, setRawInput] = useState("");

  // 公開設定
  const [isPublic, setIsPublic] = useState(false);
  const [publicBio, setPublicBio] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");

  useEffect(() => {
    if (twin) {
      setIsPublic(twin.isPublic === 1);
      setPublicBio(twin.publicBio || "");
      setTags(twin.tags || []);
    }
  }, [twin]);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (isError) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <p className="text-muted-foreground">分身AIの読み込みに失敗しました</p>
          <button onClick={() => window.location.reload()} className="text-primary underline text-sm">再読み込み</button>
        </div>
      </DashboardLayout>
    );
  }

  const handleStartEdit = () => {
    setName(twin?.name || "");
    setRawInput(twin?.rawInput || "");
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("名前を入力してください");
      return;
    }

    try {
      if (twin) {
        await updateMutation.mutateAsync({
          name,
          rawInput,
        });
      } else {
        await upsertMutation.mutateAsync({
          name,
          rawInput,
        });
      }
      toast.success(twin ? "分身AIを更新しました" : "分身AIを作成しました");
      setIsEditing(false);
      refetch();
    } catch (error) {
      toast.error("エラーが発生しました");
    }
  };

  const handleUpdatePublicSettings = async () => {
    try {
      await updatePublicMutation.mutateAsync({
        isPublic,
        publicBio: publicBio || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });
      toast.success("公開設定を更新しました");
      refetch();
    } catch (error) {
      toast.error("エラーが発生しました");
    }
  };

  const addTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()]);
      setNewTag("");
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const isSaving = upsertMutation.isPending || updateMutation.isPending;

  const handleResetAndCreate = () => {
    // reset APIは現行routerにないため、編集画面へ誘導して再作成フローに寄せる
    setIsEditing(true);
    setName("");
    setRawInput("");
    toast.info("新規作成モードに切り替えました。保存すると上書き更新されます。");
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">自分の分身AI</h1>
            <p className="text-muted-foreground mt-1">
              あなたの分身AIを作成・管理します
            </p>
          </div>
        </div>

        {!twin && !isEditing ? (
          // 分身AIがない場合
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="rounded-full bg-primary/10 p-4 mb-4">
                <Bot className="h-12 w-12 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">分身AIを作成しよう</h3>
              <p className="text-muted-foreground text-center max-w-md mb-6">
                あなたの情報を入力するだけで、AIが自動で整理して分身AIを作成します。
                友達の分身AIとビジネスマッチングができるようになります。
              </p>
              <Button onClick={() => setIsEditing(true)} size="lg">
                <Sparkles className="mr-2 h-5 w-5" />
                分身AIを作成
              </Button>
            </CardContent>
          </Card>
        ) : isEditing ? (
          // 編集モード
          <Card>
            <CardHeader>
              <CardTitle>{twin ? "分身AIを編集" : "分身AIを作成"}</CardTitle>
              <CardDescription>
                あなたの情報を自由に入力してください。AIが自動で整理します。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="name">名前 *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="あなたの名前"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="rawInput">あなたの情報（なんでもOK）</Label>
                <Textarea
                  id="rawInput"
                  value={rawInput}
                  onChange={(e) => setRawInput(e.target.value)}
                  placeholder={`例:
・マーケティング10年やってます
・SNS運用が得意
・新規事業の立ち上げ経験あり
・趣味はキャンプ
・東京在住

雑に書いてOK！AIが整理します。`}
                  rows={10}
                />
                <p className="text-sm text-muted-foreground">
                  経歴、スキル、趣味、性格など、なんでも書いてください。AIが自動で整理してプロフィールを作成します。
                </p>
              </div>

              <div className="flex gap-3">
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      処理中...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      {twin ? "更新する" : "作成する"}
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={() => setIsEditing(false)} disabled={isSaving}>
                  キャンセル
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : twin ? (
          // 分身AIの表示
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={handleResetAndCreate}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                新規作成モード
              </Button>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
            {/* 基本情報 */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-full bg-primary/10 p-3">
                      <User className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <CardTitle>{twin.name}</CardTitle>
                      <div className="flex gap-2 mt-1">
                        <Badge variant={twin.status === "active" ? "default" : "secondary"}>
                          {twin.status === "active" ? "アクティブ" : twin.status}
                        </Badge>
                        {twin.isPublic === 1 && (
                          <Badge variant="outline" className="text-cyan-400 border-cyan-400">
                            <Globe className="h-3 w-3 mr-1" />
                            公開中
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={handleStartEdit}>
                    <Edit className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {twin.description && (
                  <div>
                    <h4 className="font-medium text-sm text-muted-foreground mb-1">紹介</h4>
                    <p>{twin.description}</p>
                  </div>
                )}
                {twin.personality && (
                  <div>
                    <h4 className="font-medium text-sm text-muted-foreground mb-1">特徴・スキル</h4>
                    <p className="whitespace-pre-wrap">{twin.personality}</p>
                  </div>
                )}
                <div className="pt-4">
                  <Link href="/chat">
                    <Button className="w-full">
                      <MessageSquare className="mr-2 h-4 w-4" />
                      分身AIとチャット
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>

            {/* 公開設定 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Globe className="h-5 w-5" />
                  公開設定
                </CardTitle>
                <CardDescription>
                  分身AIを公開すると、他のユーザーから発見・マッチングリクエストを受けられます
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* 公開スイッチ */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isPublic ? (
                      <Eye className="h-5 w-5 text-cyan-400" />
                    ) : (
                      <EyeOff className="h-5 w-5 text-gray-400" />
                    )}
                    <div>
                      <p className="font-medium">分身AIを公開</p>
                      <p className="text-sm text-muted-foreground">
                        {isPublic ? "他のユーザーから見つけられます" : "友達のみがアクセス可能"}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={isPublic}
                    onCheckedChange={setIsPublic}
                  />
                </div>

                {/* 公開プロフィール */}
                <div className="space-y-2">
                  <Label htmlFor="publicBio">公開プロフィール</Label>
                  <Textarea
                    id="publicBio"
                    value={publicBio}
                    onChange={(e) => setPublicBio(e.target.value)}
                    placeholder="他のユーザーに表示される自己紹介文..."
                    rows={3}
                    disabled={!isPublic}
                  />
                </div>

                {/* タグ */}
                <div className="space-y-2">
                  <Label>タグ（検索用）</Label>
                  <div className="flex gap-2">
                    <Input
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      placeholder="タグを追加..."
                      disabled={!isPublic}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                    />
                    <Button onClick={addTag} disabled={!isPublic || !newTag.trim()}>
                      <Tag className="h-4 w-4" />
                    </Button>
                  </div>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {tags.map((tag, i) => (
                        <Badge key={i} variant="secondary" className="gap-1">
                          {tag}
                          <button onClick={() => removeTag(tag)} className="ml-1 hover:text-destructive">
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <Button 
                  onClick={handleUpdatePublicSettings} 
                  className="w-full"
                  disabled={updatePublicMutation.isPending}
                >
                  {updatePublicMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  公開設定を保存
                </Button>
              </CardContent>
            </Card>

            {/* 知識ベース */}
            <KnowledgeBaseSection />

            {/* プライバシー設定 */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  プライバシー設定
                </CardTitle>
                <CardDescription>
                  分身AIの公開範囲を細かく制御できます
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <RadioGroup
                  value={visibility}
                  onValueChange={(val) => setVisibility(val as "public" | "friends" | "private" | "custom")}
                  className="space-y-3"
                >
                  <div className="flex items-center space-x-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                    <RadioGroupItem value="public" id="vis-public" />
                    <Label htmlFor="vis-public" className="flex items-center gap-2 cursor-pointer flex-1">
                      <Globe className="h-4 w-4 text-green-500" />
                      <div>
                        <p className="font-medium">公開</p>
                        <p className="text-xs text-muted-foreground">全てのユーザーが発見・閲覧できます</p>
                      </div>
                    </Label>
                  </div>

                  <div className="flex items-center space-x-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                    <RadioGroupItem value="friends" id="vis-friends" />
                    <Label htmlFor="vis-friends" className="flex items-center gap-2 cursor-pointer flex-1">
                      <Users className="h-4 w-4 text-blue-500" />
                      <div>
                        <p className="font-medium">友達のみ</p>
                        <p className="text-xs text-muted-foreground">承認済みの友達だけが閲覧できます</p>
                      </div>
                    </Label>
                  </div>

                  <div className="flex items-center space-x-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                    <RadioGroupItem value="private" id="vis-private" />
                    <Label htmlFor="vis-private" className="flex items-center gap-2 cursor-pointer flex-1">
                      <Lock className="h-4 w-4 text-red-500" />
                      <div>
                        <p className="font-medium">非公開</p>
                        <p className="text-xs text-muted-foreground">自分だけが閲覧できます（誰にも表示されません）</p>
                      </div>
                    </Label>
                  </div>

                  <div className="flex items-center space-x-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                    <RadioGroupItem value="custom" id="vis-custom" />
                    <Label htmlFor="vis-custom" className="flex items-center gap-2 cursor-pointer flex-1">
                      <UserCheck className="h-4 w-4 text-purple-500" />
                      <div>
                        <p className="font-medium">カスタム</p>
                        <p className="text-xs text-muted-foreground">指定したユーザーのみ閲覧を許可します</p>
                      </div>
                    </Label>
                  </div>
                </RadioGroup>

                {/* カスタムモード：友達選択 */}
                {visibility === "custom" && (
                  <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
                    <Label className="flex items-center gap-2">
                      <UserCheck className="h-4 w-4" />
                      閲覧を許可する友達
                    </Label>
                    {friendsList && friendsList.length > 0 ? (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {friendsList.map((f) => (
                          <div
                            key={f.friend.id}
                            className="flex items-center space-x-3 rounded-md border p-2 hover:bg-muted/50 transition-colors cursor-pointer"
                            onClick={() => toggleViewer(f.friend.id)}
                          >
                            <Checkbox
                              checked={selectedViewerIds.includes(f.friend.id)}
                              onCheckedChange={() => toggleViewer(f.friend.id)}
                            />
                            <div className="flex items-center gap-2 flex-1">
                              <div className="rounded-full bg-primary/10 p-1.5">
                                <User className="h-3 w-3 text-primary" />
                              </div>
                              <div>
                                <p className="text-sm font-medium">{f.friend.name || "名前未設定"}</p>
                                {f.friend.isNpc && (
                                  <Badge variant="outline" className="text-xs">NPC</Badge>
                                )}
                              </div>
                            </div>
                            {selectedViewerIds.includes(f.friend.id) && (
                              <Check className="h-4 w-4 text-green-500" />
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground py-2">
                        友達がいません。まず友達を追加してください。
                      </p>
                    )}
                    {selectedViewerIds.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {selectedViewerIds.length}人を選択中
                      </p>
                    )}
                  </div>
                )}

                <Button
                  onClick={handleSaveVisibility}
                  className="w-full"
                  disabled={isSavingVisibility}
                >
                  {isSavingVisibility ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Shield className="h-4 w-4 mr-2" />
                  )}
                  プライバシー設定を保存
                </Button>
              </CardContent>
            </Card>

            {/* 人格評価システム */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Brain className="h-5 w-5" />
                      人格分析
                    </CardTitle>
                    <CardDescription>
                      ビッグ・ファイブ性格診断・9つの判断基準・分身AI精度
                    </CardDescription>
                  </div>
                  <Button 
                    onClick={handleRunAnalysis} 
                    disabled={isAnalyzing || !twin.rawInput}
                    variant="outline"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        分析中...
                      </>
                    ) : (
                      <>
                        <Zap className="h-4 w-4 mr-2" />
                        分析を実行
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* 精度スコア */}
                <div className="bg-gradient-to-r from-primary/10 to-primary/5 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium flex items-center gap-2">
                      <Target className="h-4 w-4" />
                      分身AI精度
                    </span>
                    <span className="text-2xl font-bold text-primary">
                      {twin.accuracyScore ? `${twin.accuracyScore}%` : "未分析"}
                    </span>
                  </div>
                  <Progress value={Number(twin.accuracyScore) || 0} className="h-2" />
                  <p className="text-sm text-muted-foreground mt-2">
                    学習回数: {twin.trainingIterations || 0}回
                  </p>
                </div>

                {/* ビッグ・ファイブ */}
                {twin.bigFiveTraits && (
                  <div>
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" />
                      ビッグ・ファイブ性格特性
                    </h4>
                    <div className="grid gap-3">
                      {[
                        { key: 'openness', label: '開放性', desc: '新しい経験への関心' },
                        { key: 'conscientiousness', label: '誠実性', desc: '計画性と責任感' },
                        { key: 'extraversion', label: '外向性', desc: '社交性と積極性' },
                        { key: 'agreeableness', label: '協調性', desc: '思いやりと協力性' },
                        { key: 'neuroticism', label: '神経症的傾向', desc: '感情の安定性（逆転）' },
                      ].map(({ key, label, desc }) => (
                        <div key={key} className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span>{label}</span>
                            <span className="text-muted-foreground">{((twin.bigFiveTraits as unknown) as Record<string, number>)[key]}%</span>
                          </div>
                          <Progress value={((twin.bigFiveTraits as unknown) as Record<string, number>)[key]} className="h-1.5" />
                          <p className="text-xs text-muted-foreground">{desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 9つの判断基準 */}
                {twin.judgmentThresholds && (
                  <div>
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      9つの判断基準（価値観の閾値）
                    </h4>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { key: 'goodEvil', label: '善悪', low: '寛容', high: '厳格' },
                        { key: 'likesDislike', label: '好き嫌い', low: '何でもOK', high: 'こだわり' },
                        { key: 'profitLoss', label: '損得', low: '気にしない', high: '重視' },
                        { key: 'interest', label: '利害', low: '気にしない', high: '重視' },
                        { key: 'pleasurePain', label: '苦楽', low: '苦労OK', high: '楽さ重視' },
                        { key: 'difficulty', label: '難易', low: '挑戦的', high: '簡単好み' },
                        { key: 'possibility', label: '可否', low: '何でも試す', high: '確実のみ' },
                        { key: 'comfort', label: '快不快', low: '不快に寛容', high: '快適重視' },
                        { key: 'rightWrong', label: '正誤', low: '曖昧OK', high: '正確さ重視' },
                      ].map(({ key, label, low, high }) => (
                        <div key={key} className="bg-muted/50 rounded-lg p-3 text-center">
                          <p className="text-xs text-muted-foreground mb-1">{label}</p>
                          <p className="text-lg font-bold">{((twin.judgmentThresholds as unknown) as Record<string, number>)[key]}</p>
                          <p className="text-xs text-muted-foreground">
                            {((twin.judgmentThresholds as unknown) as Record<string, number>)[key] < 50 ? low : high}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* MBTIタイプ */}
                {(twin as { mbtiType?: { type: string; dimensions: { EI: number; SN: number; TF: number; JP: number }; description: string; strengths: string[]; weaknesses: string[]; compatibleTypes: string[]; careerSuggestions: string[] } }).mbtiType && (
                  <div>
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      MBTI性格タイプ
                    </h4>
                    <div className="text-center mb-4">
                      <Badge className="bg-purple-500 text-white text-xl px-4 py-1">
                        {(twin as { mbtiType: { type: string } }).mbtiType.type}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground text-center mb-4">
                      {(twin as { mbtiType: { description: string } }).mbtiType.description}
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <h5 className="text-sm font-medium text-green-600 mb-2">強み</h5>
                        <ul className="text-xs space-y-1">
                          {(twin as { mbtiType: { strengths: string[] } }).mbtiType.strengths.slice(0, 3).map((s: string, i: number) => (
                            <li key={i} className="flex items-center gap-1">
                              <Sparkles className="h-3 w-3 text-green-500" />
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h5 className="text-sm font-medium text-orange-600 mb-2">課題</h5>
                        <ul className="text-xs space-y-1">
                          {(twin as { mbtiType: { weaknesses: string[] } }).mbtiType.weaknesses.slice(0, 3).map((w: string, i: number) => (
                            <li key={i} className="text-muted-foreground">• {w}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="mt-4">
                      <h5 className="text-sm font-medium mb-2">相性の良いタイプ</h5>
                      <div className="flex flex-wrap gap-1">
                        {(twin as { mbtiType: { compatibleTypes: string[] } }).mbtiType.compatibleTypes.map((t: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-xs">{t}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {!twin.bigFiveTraits && !twin.judgmentThresholds && !(twin as { mbtiType?: unknown }).mbtiType && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Brain className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>まだ人格分析が実行されていません</p>
                    <p className="text-sm">「分析を実行」ボタンをクリックするか、下の性格診断インタビューをお試しください</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* レーダーチャート表示 */}
            {(twin.bigFiveTraits || twin.judgmentThresholds) && (
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    人格レーダーチャート
                  </CardTitle>
                  <CardDescription>
                    あなたの分身AIの性格特性をレーダーチャートで可視化
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <PersonalityRadarChart
                    bigFiveTraits={twin.bigFiveTraits as { openness: number; conscientiousness: number; extraversion: number; agreeableness: number; neuroticism: number } | null}
                    judgmentThresholds={twin.judgmentThresholds as { goodEvil: number; likesDislike: number; profitLoss: number; interest: number; pleasurePain: number; difficulty: number; possibility: number; comfort: number; rightWrong: number } | null}
                    size={220}
                  />
                </CardContent>
              </Card>
            )}

            {/* 累積価値観波形（特許図7準拠） */}
            <div className="lg:col-span-2">
              <CumulativeWaveformChart
                waveform={twin.cumulativeWaveform as any}
                onGenerate={handleGenerateWaveform}
                isGenerating={isGeneratingWaveform}
                scenarioProgress={twin.scenarioProgress as any}
              />
            </div>

            {/* 他者視点波形 */}
            <div className="lg:col-span-2">
              <OtherPerspectiveWaveformChart
                waveform={(twin as any).otherPerspectiveWaveform}
                selfWaveform={twin.cumulativeWaveform as any}
                onUpdate={handleUpdateOtherPerspective}
                isUpdating={isUpdatingOtherPerspective}
              />
            </div>

            {/* ビッグ・ファイブ性格診断インタビュー */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  ビッグ・ファイブ性格診断
                </CardTitle>
                <CardDescription>
                  5つの性格特性を診断します
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PersonalityInterview
                  onComplete={() => {
                    refetch();
                    toast.success("ビッグ・ファイブ診断が完了しました！");
                  }}
                />
              </CardContent>
            </Card>

            {/* MBTI性格診断インタビュー */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  MBTI性格診断
                </CardTitle>
                <CardDescription>
                  16タイプの性格を診断します
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MBTIInterview
                  onComplete={() => {
                    refetch();
                    toast.success("MBTI診断が完了しました！");
                  }}
                />
              </CardContent>
            </Card>

            {/* 価値観シナリオインタビュー */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Target className="h-5 w-5 text-orange-500" />
                  価値観シナリオインタビュー
                </CardTitle>
                <CardDescription>
                  具体的な状況に対するあなたの考えを教えてください。友達の分身AIがあなたの価値観を評価し、徳波形・地雷波形を動的に生成します。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ValueScenarioInterview
                  onComplete={() => {
                    refetch();
                    toast.success("価値観シナリオが完了しました！");
                  }}
                />
              </CardContent>
            </Card>

            {/* 入力情報 */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg">入力した情報</CardTitle>
                <CardDescription>AIが整理する前の元データ</CardDescription>
              </CardHeader>
              <CardContent>
                {twin.rawInput ? (
                  <p className="whitespace-pre-wrap text-sm">{twin.rawInput}</p>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    入力情報がありません。編集して情報を追加してください。
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}

/** Knowledge Base Management Section */
function KnowledgeBaseSection() {
  const { data: entries, isLoading, refetch } = trpc.knowledge.list.useQuery();
  const addMutation = trpc.knowledge.add.useMutation({
    onSuccess: () => {
      refetch();
      setTitle("");
      setContent("");
      setIsAdding(false);
      toast.success("知識エントリを追加しました");
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteMutation = trpc.knowledge.delete.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("知識エントリを削除しました");
    },
    onError: (err) => toast.error(err.message),
  });

  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const handleAdd = () => {
    if (!content.trim()) {
      toast.error("内容を入力してください");
      return;
    }
    addMutation.mutate({
      sourceType: "manual",
      title: title.trim() || undefined,
      content: content.trim(),
      summary: content.trim().slice(0, 200),
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
      toast.error("ファイルサイズは500KB以下にしてください");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      if (!text.trim()) {
        toast.error("ファイルの内容が空です");
        return;
      }
      addMutation.mutate({
        sourceType: "upload",
        title: file.name,
        content: text.trim(),
        summary: text.trim().slice(0, 200),
      });
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              知識ベース
            </CardTitle>
            <CardDescription>
              ドキュメント、経験、専門知識を追加して分身AIの回答品質を向上させましょう
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <label>
              <Button variant="outline" size="sm" asChild className="cursor-pointer">
                <span>
                  <FileText className="h-4 w-4 mr-1" />
                  ファイル
                </span>
              </Button>
              <input type="file" accept=".txt,.md,.csv,.json" className="hidden" onChange={handleFileUpload} />
            </label>
            <Button size="sm" onClick={() => setIsAdding(!isAdding)}>
              <Plus className="h-4 w-4 mr-1" />
              追加
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add form */}
        {isAdding && (
          <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
            <div className="space-y-2">
              <Label htmlFor="kb-title">タイトル（任意）</Label>
              <Input
                id="kb-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例: マーケティング戦略メモ"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kb-content">内容 *</Label>
              <Textarea
                id="kb-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="分身AIに覚えさせたい知識、経験、専門情報を入力..."
                rows={5}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleAdd} disabled={addMutation.isPending} size="sm">
                {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                保存
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setIsAdding(false); setTitle(""); setContent(""); }}>
                キャンセル
              </Button>
            </div>
          </div>
        )}

        {/* Entries list */}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !entries || entries.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">知識ベースにエントリがありません</p>
            <p className="text-xs mt-1">「追加」ボタンからテキストやファイルを追加して、分身AIの回答品質を向上させましょう</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{entries.length}件のエントリ</p>
            {entries.map((entry: any) => (
              <div key={entry.id} className="flex items-start justify-between gap-3 rounded-lg border p-3 bg-card hover:bg-muted/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {entry.sourceType === "upload" ? "ファイル" : entry.sourceType === "api" ? "API" : "手動"}
                    </Badge>
                    <p className="text-sm font-medium truncate">{entry.title || "無題"}</p>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {entry.summary || (entry.content ? entry.content.slice(0, 150) : "内容なし")}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {new Date(entry.createdAt).toLocaleDateString("ja-JP")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    if (confirm("このエントリを削除しますか？")) {
                      deleteMutation.mutate({ id: entry.id });
                    }
                  }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
