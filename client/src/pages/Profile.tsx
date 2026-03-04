import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc, API_BASE } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, Plus, X, Eye, Shield, Download, Trash2, AlertTriangle, Camera } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useLocation } from "wouter";

export default function Profile() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  usePageMeta({ title: "プロフィール", description: "あなたのプロフィール情報を管理しましょう。スキル、経歴、自己紹介を設定できます。", path: "/profile" });
  const { data: profile, isLoading, isError } = trpc.profile.get.useQuery();
  const { data: trustData } = trpc.trust.getScore.useQuery();
  const updateProfile = trpc.profile.update.useMutation();
  const uploadAvatar = trpc.profile.uploadAvatar.useMutation();

  // Account deletion state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const deleteAccount = trpc.auth.deleteAccount.useMutation();

  const [formData, setFormData] = useState({
    displayName: "",
    bio: "",
    skills: [] as string[],
    experience: "",
    businessInfo: "",
    expertise: [] as string[],
    industry: "",
    company: "",
    position: "",
  });

  const [newSkill, setNewSkill] = useState("");
  const [newExpertise, setNewExpertise] = useState("");

  useEffect(() => {
    if (profile) {
      setFormData({
        displayName: profile.displayName || "",
        bio: profile.bio || "",
        skills: profile.skills || [],
        experience: profile.experience || "",
        businessInfo: profile.businessInfo || "",
        expertise: profile.expertise || [],
        industry: profile.industry || "",
        company: profile.company || "",
        position: profile.position || "",
      });
    }
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateProfile.mutateAsync(formData);
      toast.success("プロフィールを更新しました");
    } catch (error) {
      toast.error("更新に失敗しました");
    }
  };

  const addSkill = () => {
    if (newSkill.trim() && !formData.skills.includes(newSkill.trim())) {
      setFormData({ ...formData, skills: [...formData.skills, newSkill.trim()] });
      setNewSkill("");
    }
  };

  const removeSkill = (skill: string) => {
    setFormData({ ...formData, skills: formData.skills.filter((s) => s !== skill) });
  };

  const addExpertise = () => {
    if (newExpertise.trim() && !formData.expertise.includes(newExpertise.trim())) {
      setFormData({ ...formData, expertise: [...formData.expertise, newExpertise.trim()] });
      setNewExpertise("");
    }
  };

  const removeExpertise = (exp: string) => {
    setFormData({ ...formData, expertise: formData.expertise.filter((e) => e !== exp) });
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

  if (isError) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <p className="text-muted-foreground">プロフィールの読み込みに失敗しました</p>
          <button onClick={() => window.location.reload()} className="text-primary underline text-sm">再読み込み</button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6" role="main" aria-label="プロフィール設定">
        <div>
          <h1 className="text-3xl font-bold">プロフィール設定</h1>
          <p className="text-muted-foreground mt-2">
            あなたの情報を入力して、分身AIの基盤を作成しましょう。
          </p>
        </div>

        {/* Completion & Preview */}
        {(() => {
          const fields = [
            { filled: !!formData.displayName, label: "表示名" },
            { filled: !!formData.bio, label: "自己紹介" },
            { filled: !!formData.company, label: "会社名" },
            { filled: !!formData.industry, label: "業種" },
            { filled: !!formData.position, label: "役職" },
            { filled: formData.skills.length > 0, label: "スキル" },
            { filled: formData.expertise.length > 0, label: "専門分野" },
            { filled: !!formData.experience, label: "経歴" },
          ];
          const filledCount = fields.filter(f => f.filled).length;
          const pct = Math.round((filledCount / fields.length) * 100);
          return (
            <Card className={pct === 100 ? "border-green-500/50 bg-green-500/5" : ""}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">プロフィール完成度</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">信頼度: {trustData?.score ?? 0}pt</span>
                    <span className="text-sm font-bold text-primary">{pct}%</span>
                  </div>
                </div>
                <Progress value={pct} className="h-2 mb-2" />
                {pct < 100 && (
                  <div className="flex flex-wrap gap-1">
                    {fields.filter(f => !f.filled).map(f => (
                      <Badge key={f.label} variant="outline" className="text-[10px] text-muted-foreground">{f.label}</Badge>
                    ))}
                  </div>
                )}
                {pct === 100 && <p className="text-xs text-green-600">すべての項目が入力済みです</p>}
              </CardContent>
            </Card>
          );
        })()}

        {/* Preview Card */}
        {(formData.displayName || formData.bio) && (
          <Card className="bg-muted/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Eye className="h-4 w-4" />
                プレビュー（他のユーザーに見える情報）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  {profile?.avatarUrl ? (
                    <img src={`${API_BASE}${profile.avatarUrl}`} alt="" className="h-10 w-10 rounded-full object-cover border" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center border text-sm font-medium text-muted-foreground">
                      {formData.displayName?.charAt(0) || user?.name?.charAt(0) || "?"}
                    </div>
                  )}
                  <div>
                    <p className="font-medium">{formData.displayName || user?.name || "名前未設定"}</p>
                    {formData.company && <p className="text-sm text-muted-foreground">{formData.company}{formData.position ? ` / ${formData.position}` : ""}</p>}
                  </div>
                </div>
                {formData.industry && <p className="text-xs text-muted-foreground">{formData.industry}</p>}
                {formData.bio && <p className="text-sm mt-2">{formData.bio.slice(0, 100)}{formData.bio.length > 100 ? "..." : ""}</p>}
                {formData.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {formData.skills.slice(0, 5).map(s => <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>)}
                    {formData.skills.length > 5 && <Badge variant="outline" className="text-xs">+{formData.skills.length - 5}</Badge>}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Avatar Upload */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-6">
              <div className="relative group">
                <div className="h-20 w-20 rounded-full bg-muted border-2 border-border overflow-hidden flex items-center justify-center">
                  {profile?.avatarUrl ? (
                    <img
                      src={`${API_BASE}${profile.avatarUrl}`}
                      alt="Avatar"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-2xl font-bold text-muted-foreground">
                      {formData.displayName?.charAt(0) || user?.name?.charAt(0) || "?"}
                    </span>
                  )}
                </div>
                <label className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                  {uploadAvatar.isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin text-white" />
                  ) : (
                    <Camera className="h-5 w-5 text-white" />
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    disabled={uploadAvatar.isPending}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 2 * 1024 * 1024) {
                        toast.error("画像サイズは2MB以下にしてください");
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = async () => {
                        try {
                          await uploadAvatar.mutateAsync({
                            imageData: reader.result as string,
                            contentType: file.type,
                          });
                          toast.success("プロフィール画像を更新しました");
                          window.location.reload();
                        } catch {
                          toast.error("画像のアップロードに失敗しました");
                        }
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
              </div>
              <div>
                <p className="font-medium">{formData.displayName || user?.name || "名前未設定"}</p>
                <p className="text-sm text-muted-foreground">{user?.email}</p>
                <p className="text-xs text-muted-foreground mt-1">クリックして画像を変更（2MB以下、JPG/PNG/WebP）</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle>基本情報</CardTitle>
              <CardDescription>あなたの基本的な情報を入力してください</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="displayName">表示名</Label>
                <Input
                  id="displayName"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  placeholder="山田 太郎"
                  required
                  maxLength={100}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="bio">自己紹介</Label>
                <Textarea
                  id="bio"
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  placeholder="あなた自身について簡単に紹介してください"
                  rows={4}
                  maxLength={500}
                />
              </div>
            </CardContent>
          </Card>

          {/* Professional Info */}
          <Card>
            <CardHeader>
              <CardTitle>職業情報</CardTitle>
              <CardDescription>現在の職業や所属について</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="company">会社名</Label>
                  <Input
                    id="company"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    placeholder="株式会社〇〇"
                    required
                    maxLength={100}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="position">役職</Label>
                  <Input
                    id="position"
                    value={formData.position}
                    onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                    placeholder="代表取締役"
                    maxLength={100}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="industry">業界</Label>
                <Input
                  id="industry"
                  value={formData.industry}
                  onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                  placeholder="IT・テクノロジー"
                />
              </div>
            </CardContent>
          </Card>

          {/* Skills */}
          <Card>
            <CardHeader>
              <CardTitle>スキル</CardTitle>
              <CardDescription>あなたが持っているスキルを追加してください</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  value={newSkill}
                  onChange={(e) => setNewSkill(e.target.value)}
                  placeholder="スキルを入力"
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSkill())}
                />
                <Button type="button" onClick={addSkill} variant="outline">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.skills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary/20 text-primary text-sm"
                  >
                    {skill}
                    <button type="button" onClick={() => removeSkill(skill)}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Expertise */}
          <Card>
            <CardHeader>
              <CardTitle>専門分野</CardTitle>
              <CardDescription>あなたの専門分野を追加してください</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  value={newExpertise}
                  onChange={(e) => setNewExpertise(e.target.value)}
                  placeholder="専門分野を入力"
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addExpertise())}
                />
                <Button type="button" onClick={addExpertise} variant="outline">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.expertise.map((exp) => (
                  <span
                    key={exp}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-accent/20 text-accent text-sm"
                  >
                    {exp}
                    <button type="button" onClick={() => removeExpertise(exp)}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Experience & Business */}
          <Card>
            <CardHeader>
              <CardTitle>経験・ビジネス情報</CardTitle>
              <CardDescription>詳細な経歴やビジネス情報</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="experience">経歴</Label>
                <Textarea
                  id="experience"
                  value={formData.experience}
                  onChange={(e) => setFormData({ ...formData, experience: e.target.value })}
                  placeholder="これまでの経歴や実績について"
                  rows={4}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="businessInfo">ビジネス情報</Label>
                <Textarea
                  id="businessInfo"
                  value={formData.businessInfo}
                  onChange={(e) => setFormData({ ...formData, businessInfo: e.target.value })}
                  placeholder="現在のビジネスや提供しているサービスについて"
                  rows={4}
                />
              </div>
            </CardContent>
          </Card>

          {/* Submit */}
          <div className="flex justify-end">
            <Button type="submit" disabled={updateProfile.isPending}>
              {updateProfile.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              保存する
            </Button>
          </div>
        </form>

        {/* Danger Zone */}
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              危険な操作
            </CardTitle>
            <CardDescription>
              アカウントに関する取り消し不可能な操作です。慎重に行ってください。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Data Export */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium">データエクスポート</p>
                <p className="text-xs text-muted-foreground">
                  あなたのデータをJSON形式でダウンロードします（GDPR対応）
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={isExporting}
                onClick={async () => {
                  setIsExporting(true);
                  try {
                    const res = await fetch(
                      `${API_BASE}/trpc/auth.exportMyData`,
                      { credentials: "include" }
                    );
                    if (!res.ok) throw new Error("Export failed");
                    const json = await res.json() as any;
                    // tRPC wraps the result — extract .result.data
                    const data = json?.result?.data?.json ?? json?.result?.data ?? json;
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `bunshin-ai-data-export-${new Date().toISOString().slice(0, 10)}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    toast.success("データをエクスポートしました");
                  } catch {
                    toast.error("データのエクスポートに失敗しました");
                  } finally {
                    setIsExporting(false);
                  }
                }}
              >
                {isExporting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                エクスポート
              </Button>
            </div>

            {/* Account Deletion */}
            <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div>
                <p className="text-sm font-medium text-destructive">アカウント削除</p>
                <p className="text-xs text-muted-foreground">
                  アカウントとすべてのデータが完全に削除されます
                </p>
              </div>
              <Dialog open={deleteDialogOpen} onOpenChange={(open) => {
                setDeleteDialogOpen(open);
                if (!open) {
                  setDeleteConfirmation("");
                  setDeletePassword("");
                }
              }}>
                <DialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    <Trash2 className="h-4 w-4 mr-2" />
                    アカウント削除
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="text-destructive flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5" />
                      アカウントを削除しますか？
                    </DialogTitle>
                    <DialogDescription>
                      この操作は取り消せません。すべてのデータが完全に削除されます。
                      分身AI、チャット履歴、マッチング結果、友達関係、ポイントなど、全てのデータが失われます。
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <Label htmlFor="delete-confirmation">
                        確認のため「DELETE」と入力してください
                      </Label>
                      <Input
                        id="delete-confirmation"
                        value={deleteConfirmation}
                        onChange={(e) => setDeleteConfirmation(e.target.value)}
                        placeholder="DELETE"
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="delete-password">パスワード</Label>
                      <Input
                        id="delete-password"
                        type="password"
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                        placeholder="パスワードを入力"
                        autoComplete="current-password"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setDeleteDialogOpen(false)}
                    >
                      キャンセル
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={
                        deleteConfirmation !== "DELETE" ||
                        !deletePassword ||
                        deleteAccount.isPending
                      }
                      onClick={async () => {
                        try {
                          await deleteAccount.mutateAsync({
                            password: deletePassword,
                            confirmation: "DELETE" as const,
                          });
                          toast.success("アカウントが削除されました");
                          // Clear session cookie
                          try {
                            await fetch(
                              `${API_BASE}/api/auth/logout`,
                              { method: "POST", credentials: "include" }
                            );
                          } catch { /* ignore */ }
                          navigate("/");
                        } catch (err: any) {
                          toast.error(
                            err?.message || "アカウントの削除に失敗しました"
                          );
                        }
                      }}
                    >
                      {deleteAccount.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 mr-2" />
                      )}
                      アカウントを削除する
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
