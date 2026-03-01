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
import { useTranslation } from "@/contexts/LanguageContext";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

export default function Login() {
  const { t } = useTranslation();
  usePageMeta({ title: "ログイン", description: "分身AIにログインして、デジタルツインの管理やビジネスマッチングを開始しましょう。", path: "/login" });
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const utils = trpc.useUtils();

  const [showResend, setShowResend] = useState(false);

  const resendMutation = trpc.auth.resendVerification.useMutation({
    onSuccess: () => {
      toast.success("確認メールを再送信しました");
      setShowResend(false);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async (data) => {
      // Set session cookie
      await fetch(`${API_BASE}/api/auth/set-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: data.token }),
      });
      await utils.auth.me.invalidate();
      toast.success(`ようこそ、${data.user.name}さん！`);
      // Route based on onboarding status
      const onboardingCompleted = (data.user as any).onboardingCompleted ?? 0;
      if (onboardingCompleted) {
        navigate("/dashboard");
      } else {
        navigate("/onboarding");
      }
    },
    onError: (error) => {
      if (error.message.includes("未認証")) {
        setShowResend(true);
      }
      toast.error(error.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    loginMutation.mutate({ email, password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" role="main" aria-label="ログイン">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
              <Bot className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">{t("login.title")}</CardTitle>
          <CardDescription>
            {t("login.desc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" aria-label="ログインフォーム">
            <div className="space-y-2">
              <Label htmlFor="email">{t("login.email")}</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                aria-label="メールアドレス"
                aria-invalid={loginMutation.isError || undefined}
                aria-describedby={showResend ? "login-error" : undefined}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t("login.password")}</Label>
                <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                  {t("login.forgotPassword")}
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="8文字以上"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                aria-label="パスワード"
                aria-invalid={loginMutation.isError || undefined}
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loginMutation.isPending}
              aria-label="ログイン"
            >
              {loginMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
              ) : null}
              {t("login.submit")}
            </Button>
          </form>

          {showResend && (
            <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm space-y-2" role="alert" id="login-error">
              <p className="text-amber-600 dark:text-amber-400">{t("login.unverified")}</p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={resendMutation.isPending}
                onClick={() => resendMutation.mutate({ email })}
              >
                {resendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {t("login.resend")}
              </Button>
            </div>
          )}

          <div className="mt-6 text-center text-sm">
            <span className="text-muted-foreground">{t("login.noAccount")}</span>{" "}
            <Link href="/register" className="text-primary hover:underline">
              {t("login.register")}
            </Link>
          </div>

          <div className="mt-4 text-center">
            <Link href="/" className="text-sm text-muted-foreground hover:underline">
              {t("login.backToTop")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
