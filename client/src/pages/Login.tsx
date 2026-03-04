import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc, API_BASE } from "@/lib/trpc";
import { Bot, Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { useTranslation } from "@/contexts/LanguageContext";

export default function Login() {
  const { t } = useTranslation();
  usePageMeta({ title: "ログイン", description: "分身AIにログインして、デジタルツインの管理やビジネスマッチングを開始しましょう。", path: "/login" });
  type LoginForm = { email: string; password: string };

  const [, navigate] = useLocation();
  const { register, handleSubmit, getValues, formState: { errors, isSubmitting } } = useForm<LoginForm>();
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
      const onboardingCompleted = data.user?.onboardingCompleted ?? 0;
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

  const onSubmit = handleSubmit(async (data) => {
    loginMutation.mutate({ email: data.email, password: data.password });
  });

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
          <form onSubmit={onSubmit} className="space-y-4" aria-label="ログインフォーム">
            <div className="space-y-2">
              <Label htmlFor="email">{t("login.email")}</Label>
              <Input
                id="email"
                {...register("email", {
                  required: "メールアドレスを入力してください",
                  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "有効なメールアドレスを入力してください" }
                })}
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                aria-label="メールアドレス"
                aria-invalid={!!errors.email || loginMutation.isError || undefined}
                aria-describedby={errors.email ? "email-error" : showResend ? "login-error" : undefined}
              />
              {errors.email && <p className="text-sm text-destructive mt-1" id="email-error">{errors.email.message}</p>}
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
                {...register("password", {
                  required: "パスワードを入力してください",
                  minLength: { value: 8, message: "パスワードは8文字以上で入力してください" }
                })}
                type="password"
                placeholder="8文字以上"
                autoComplete="current-password"
                aria-label="パスワード"
                aria-invalid={!!errors.password || loginMutation.isError || undefined}
                aria-describedby={errors.password ? "password-error" : undefined}
              />
              {errors.password && <p className="text-sm text-destructive mt-1" id="password-error">{errors.password.message}</p>}
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting || loginMutation.isPending}
              aria-label="ログイン"
            >
              {(isSubmitting || loginMutation.isPending) ? (
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
                onClick={() => resendMutation.mutate({ email: getValues("email") })}
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
