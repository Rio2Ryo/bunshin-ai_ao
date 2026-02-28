import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { Bot, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

export default function Register() {
  usePageMeta({ title: "新規登録", description: "分身AIアカウントを作成して、あなたのデジタルツインを始めましょう。無料で登録できます。", path: "/register" });
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);

  const utils = trpc.useUtils();

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: async (data: any) => {
      if (data.requiresVerification) {
        // Email service is configured: user must verify email first
        toast.success("確認メールを送信しました");
        navigate(`/verify-email?email=${encodeURIComponent(email)}`);
      } else if (data.token) {
        // No email service: auto-verified, set session and proceed
        await fetch(`${API_BASE}/api/auth/set-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token: data.token }),
        });
        await utils.auth.me.invalidate();
        toast.success(`ようこそ、${data.user?.name ?? name}さん！`);
        const onboardingCompleted = data.user?.onboardingCompleted ?? 0;
        if (onboardingCompleted) {
          navigate("/dashboard");
        } else {
          navigate("/onboarding");
        }
      }
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("パスワードが一致しません");
      return;
    }
    if (password.length < 6) {
      toast.error("パスワードは6文字以上で入力してください");
      return;
    }
    if (!tosAccepted) {
      toast.error("利用規約に同意してください");
      return;
    }
    registerMutation.mutate({ name, email, password, tosAccepted: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" role="main" aria-label="アカウント登録">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
              <Bot className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">新規アカウント作成</CardTitle>
          <CardDescription>
            分身AIを始めるためにアカウントを作成してください
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" aria-label="アカウント登録フォーム">
            <div className="space-y-2">
              <Label htmlFor="name">お名前</Label>
              <Input
                id="name"
                type="text"
                placeholder="山田 太郎"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
                aria-label="お名前"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">メールアドレス</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                aria-label="メールアドレス"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">パスワード</Label>
              <Input
                id="password"
                type="password"
                placeholder="6文字以上"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                aria-label="パスワード"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">パスワード（確認）</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="もう一度入力してください"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                aria-label="パスワード（確認）"
              />
            </div>
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                id="tos"
                checked={tosAccepted}
                onChange={(e) => setTosAccepted(e.target.checked)}
                className="mt-1 rounded border-input"
              />
              <Label htmlFor="tos" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                <Link href="/terms" className="text-primary hover:underline">利用規約</Link>および
                <Link href="/privacy" className="text-primary hover:underline">プライバシーポリシー</Link>に同意します
              </Label>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={registerMutation.isPending}
              aria-label="アカウント作成"
            >
              {registerMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              アカウント作成
            </Button>
          </form>

          <div className="mt-6 text-center text-sm">
            <span className="text-muted-foreground">既にアカウントをお持ちの方は</span>{" "}
            <Link href="/login" className="text-primary hover:underline">
              ログイン
            </Link>
          </div>

          <div className="mt-4 text-center">
            <Link href="/" className="text-sm text-muted-foreground hover:underline">
              トップページに戻る
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
