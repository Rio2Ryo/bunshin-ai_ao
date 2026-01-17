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
import { Bot, Edit, Loader2, MessageSquare, Save, Sparkles, User, Globe, Eye, EyeOff, Tag, X } from "lucide-react";

export default function MyTwin() {
  const { data: twin, isLoading, refetch } = trpc.myTwin.get.useQuery();
  const upsertMutation = trpc.myTwin.upsert.useMutation();
  const updateMutation = trpc.myTwin.update.useMutation();
  const updatePublicMutation = trpc.myTwin.updatePublicSettings.useMutation();

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
        ) : null}
      </div>
    </DashboardLayout>
  );
}
