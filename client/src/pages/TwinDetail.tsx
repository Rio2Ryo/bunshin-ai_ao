import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { useParams, Link } from "wouter";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Bot, Save, Loader2, Upload, FileText, Trash2, ArrowLeft, MessageSquare } from "lucide-react";

export default function TwinDetail() {
  const { id } = useParams<{ id: string }>();
  const twinId = parseInt(id || "0");

  const { data: twin, isLoading, refetch } = trpc.twins.get.useQuery({ id: twinId }, { enabled: twinId > 0 });
  const { data: knowledge, refetch: refetchKnowledge } = trpc.knowledge.list.useQuery({ twinId }, { enabled: twinId > 0 });
  const { data: files } = trpc.files.list.useQuery();

  const updateTwin = trpc.twins.update.useMutation();
  const uploadFile = trpc.files.upload.useMutation();
  const processFile = trpc.files.process.useMutation();
  const addKnowledge = trpc.knowledge.add.useMutation();
  const deleteKnowledge = trpc.knowledge.delete.useMutation();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    personality: "",
    systemPrompt: "",
    status: "inactive" as "active" | "inactive" | "training",
  });

  const [manualKnowledge, setManualKnowledge] = useState({
    title: "",
    content: "",
    summary: "",
  });

  useEffect(() => {
    if (twin) {
      setFormData({
        name: twin.name,
        description: twin.description || "",
        personality: twin.personality || "",
        systemPrompt: twin.systemPrompt || "",
        status: twin.status,
      });
    }
  }, [twin]);

  const handleSave = async () => {
    try {
      await updateTwin.mutateAsync({ id: twinId, ...formData });
      toast.success("保存しました");
      refetch();
    } catch (error) {
      toast.error("保存に失敗しました");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      try {
        const result = await uploadFile.mutateAsync({
          filename: file.name,
          content: base64,
          mimeType: file.type,
          twinId,
        });

        toast.success("ファイルをアップロードしました。処理中...");

        await processFile.mutateAsync({
          fileId: result.id,
          twinId,
        });

        toast.success("ファイルを処理しました");
        refetchKnowledge();
      } catch (error) {
        toast.error("アップロードに失敗しました");
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAddManualKnowledge = async () => {
    if (!manualKnowledge.title.trim() || !manualKnowledge.content.trim()) {
      toast.error("タイトルと内容を入力してください");
      return;
    }

    try {
      await addKnowledge.mutateAsync({
        twinId,
        sourceType: "manual",
        title: manualKnowledge.title,
        content: manualKnowledge.content,
        summary: manualKnowledge.summary || manualKnowledge.content.substring(0, 200),
      });
      toast.success("知識を追加しました");
      setManualKnowledge({ title: "", content: "", summary: "" });
      refetchKnowledge();
    } catch (error) {
      toast.error("追加に失敗しました");
    }
  };

  const handleDeleteKnowledge = async (knowledgeId: number) => {
    if (!confirm("この知識を削除しますか？")) return;

    try {
      await deleteKnowledge.mutateAsync({ id: knowledgeId, twinId });
      toast.success("削除しました");
      refetchKnowledge();
    } catch (error) {
      toast.error("削除に失敗しました");
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!twin) {
    return (
      <DashboardLayout>
        <div className="text-center py-16">
          <p className="text-muted-foreground">分身AIが見つかりません</p>
          <Link href="/twins">
            <Button className="mt-4">一覧に戻る</Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/twins">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{twin.name}</h1>
              <p className="text-muted-foreground">分身AIの設定と知識ベース</p>
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            <Link href={`/chat?twinId=${twinId}`}>
              <Button variant="outline">
                <MessageSquare className="h-4 w-4 mr-2" />
                チャット
              </Button>
            </Link>
          </div>
        </div>

        <Tabs defaultValue="settings">
          <TabsList>
            <TabsTrigger value="settings">設定</TabsTrigger>
            <TabsTrigger value="knowledge">知識ベース ({knowledge?.length || 0})</TabsTrigger>
            <TabsTrigger value="upload">アップロード</TabsTrigger>
          </TabsList>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>基本設定</CardTitle>
                <CardDescription>分身AIの基本情報を編集します</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">名前</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="status">ステータス</Label>
                    <Select
                      value={formData.status}
                      onValueChange={(value: "active" | "inactive" | "training") =>
                        setFormData({ ...formData, status: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">アクティブ</SelectItem>
                        <SelectItem value="inactive">非アクティブ</SelectItem>
                        <SelectItem value="training">学習中</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">説明</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="personality">性格・特徴</Label>
                  <Textarea
                    id="personality"
                    value={formData.personality}
                    onChange={(e) => setFormData({ ...formData, personality: e.target.value })}
                    rows={4}
                    placeholder="この分身AIの性格や特徴を詳しく記述してください"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="systemPrompt">システムプロンプト</Label>
                  <Textarea
                    id="systemPrompt"
                    value={formData.systemPrompt}
                    onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                    rows={4}
                    placeholder="AIへの詳細な指示（上級者向け）"
                  />
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSave} disabled={updateTwin.isPending}>
                    {updateTwin.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    <Save className="h-4 w-4 mr-2" />
                    保存
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Knowledge Tab */}
          <TabsContent value="knowledge" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>手動で知識を追加</CardTitle>
                <CardDescription>テキストで直接知識を追加します</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="knowledgeTitle">タイトル</Label>
                  <Input
                    id="knowledgeTitle"
                    value={manualKnowledge.title}
                    onChange={(e) => setManualKnowledge({ ...manualKnowledge, title: e.target.value })}
                    placeholder="知識のタイトル"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="knowledgeContent">内容</Label>
                  <Textarea
                    id="knowledgeContent"
                    value={manualKnowledge.content}
                    onChange={(e) => setManualKnowledge({ ...manualKnowledge, content: e.target.value })}
                    rows={4}
                    placeholder="詳細な内容"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="knowledgeSummary">要約（オプション）</Label>
                  <Textarea
                    id="knowledgeSummary"
                    value={manualKnowledge.summary}
                    onChange={(e) => setManualKnowledge({ ...manualKnowledge, summary: e.target.value })}
                    rows={2}
                    placeholder="内容の要約"
                  />
                </div>
                <Button onClick={handleAddManualKnowledge} disabled={addKnowledge.isPending}>
                  {addKnowledge.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  追加
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>知識ベース一覧</CardTitle>
                <CardDescription>この分身AIが学習した知識</CardDescription>
              </CardHeader>
              <CardContent>
                {knowledge && knowledge.length > 0 ? (
                  <div className="space-y-3">
                    {knowledge.map((k) => (
                      <div key={k.id} className="p-4 rounded-lg bg-muted/50 border border-border/50">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <FileText className="h-4 w-4 text-primary" />
                              <span className="font-medium">{k.title || "無題"}</span>
                              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                                {k.sourceType === "upload" ? "アップロード" :
                                 k.sourceType === "api" ? "API" : "手動"}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {k.summary || k.content?.substring(0, 200)}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteKnowledge(k.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">知識ベースが空です</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Upload Tab */}
          <TabsContent value="upload" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>ファイルアップロード</CardTitle>
                <CardDescription>
                  テキストファイルやPDFをアップロードして知識ベースに追加します
                </CardDescription>
              </CardHeader>
              <CardContent>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.pdf,.md"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                >
                  <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-lg font-medium mb-2">ファイルをアップロード</p>
                  <p className="text-sm text-muted-foreground">
                    .txt, .pdf, .md ファイルに対応
                  </p>
                  {(uploadFile.isPending || processFile.isPending) && (
                    <div className="mt-4 flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">処理中...</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
