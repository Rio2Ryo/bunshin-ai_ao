import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, Save, Plus, X } from "lucide-react";

export default function Profile() {
  const { user } = useAuth();
  const { data: profile, isLoading } = trpc.profile.get.useQuery();
  const updateProfile = trpc.profile.update.useMutation();

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

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">プロフィール設定</h1>
          <p className="text-muted-foreground mt-2">
            あなたの情報を入力して、分身AIの基盤を作成しましょう。
          </p>
        </div>

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
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="position">役職</Label>
                  <Input
                    id="position"
                    value={formData.position}
                    onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                    placeholder="代表取締役"
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
      </div>
    </DashboardLayout>
  );
}
