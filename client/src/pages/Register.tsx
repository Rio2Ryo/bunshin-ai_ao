import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc, API_BASE } from "@/lib/trpc";
import { Bot, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { useTranslation } from "@/contexts/LanguageContext";

export default function Register() {
  const { t } = useTranslation();
  usePageMeta({ title: "新規登録", description: "分身AIアカウントを作成して、あなたのデジタルツインを始めましょう。無料で登録できます。", path: "/register" });
  type RegisterForm = { name: string; email: string; password: string; confirmPassword: string; tosAccepted: boolean };

  const [, navigate] = useLocation();
  const { register, handleSubmit, watch, getValues, formState: { errors, isSubmitting } } = useForm<RegisterForm>({
    defaultValues: { tosAccepted: false },
  });

  const utils = trpc.useUtils();

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: async (data: any) => {
      if (data.requiresVerification) {
        // Email service is configured: user must verify email first
        toast.success("確認メールを送信しました");
        navigate(`/verify-email?email=${encodeURIComponent(getValues("email"))}`);
      } else if (data.token) {
        // No email service: auto-verified, set session and proceed
        await fetch(`${API_BASE}/api/auth/set-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token: data.token }),
        });
        await utils.auth.me.invalidate();
        toast.success(`ようこそ、${data.user?.name ?? getValues("name")}さん！`);
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

  const onSubmit = handleSubmit(async (data) => {
    registerMutation.mutate({ name: data.name, email: data.email, password: data.password, tosAccepted: true });
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" role="main" aria-label="アカウント登録">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
              <Bot className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">{t("register.title")}</CardTitle>
          <CardDescription>
            {t("register.desc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" aria-label="アカウント登録フォーム">
            <div className="space-y-2">
              <Label htmlFor="name">{t("register.name")}</Label>
              <Input
                id="name"
                {...register("name", {
                  required: "お名前を入力してください",
                })}
                type="text"
                placeholder="山田 太郎"
                autoComplete="name"
                aria-label="お名前"
                aria-invalid={!!errors.name || undefined}
                aria-describedby={errors.name ? "name-error" : undefined}
              />
              {errors.name && <p className="text-sm text-destructive mt-1" id="name-error">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t("register.email")}</Label>
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
                aria-invalid={!!errors.email || undefined}
                aria-describedby={errors.email ? "email-error" : undefined}
              />
              {errors.email && <p className="text-sm text-destructive mt-1" id="email-error">{errors.email.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("register.password")}</Label>
              <Input
                id="password"
                {...register("password", {
                  required: "パスワードを入力してください",
                  minLength: { value: 8, message: "パスワードは8文字以上で入力してください" }
                })}
                type="password"
                placeholder="8文字以上"
                autoComplete="new-password"
                aria-label="パスワード"
                aria-invalid={!!errors.password || undefined}
                aria-describedby={errors.password ? "password-error" : "password-hint"}
              />
              {errors.password ? (
                <p className="text-sm text-destructive mt-1" id="password-error">{errors.password.message}</p>
              ) : (
                <p id="password-hint" className="sr-only">パスワードは8文字以上で入力してください</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t("register.confirmPassword")}</Label>
              <Input
                id="confirmPassword"
                {...register("confirmPassword", {
                  required: "パスワードを再入力してください",
                  validate: (val) => val === watch("password") || "パスワードが一致しません"
                })}
                type="password"
                placeholder="もう一度入力してください"
                autoComplete="new-password"
                aria-label="パスワード（確認）"
                aria-invalid={!!errors.confirmPassword || undefined}
                aria-describedby={errors.confirmPassword ? "confirm-password-error" : undefined}
              />
              {errors.confirmPassword && <p className="text-sm text-destructive mt-1" id="confirm-password-error">{errors.confirmPassword.message}</p>}
            </div>
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                id="tos"
                {...register("tosAccepted", {
                  required: "利用規約に同意してください"
                })}
                className="mt-1 rounded border-input focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-required="true"
                aria-invalid={!!errors.tosAccepted || undefined}
              />
              <Label htmlFor="tos" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                <Link href="/terms" className="text-primary hover:underline">利用規約</Link>および
                <Link href="/privacy" className="text-primary hover:underline">プライバシーポリシー</Link>に同意します
              </Label>
            </div>
            {errors.tosAccepted && <p className="text-sm text-destructive -mt-2">{errors.tosAccepted.message}</p>}
            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting || registerMutation.isPending}
              aria-label="アカウント作成"
            >
              {(isSubmitting || registerMutation.isPending) ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {t("register.submit")}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm">
            <span className="text-muted-foreground">{t("register.hasAccount")}</span>{" "}
            <Link href="/login" className="text-primary hover:underline">
              {t("register.login")}
            </Link>
          </div>

          <div className="mt-4 text-center">
            <Link href="/" className="text-sm text-muted-foreground hover:underline">
              {t("register.backToTop")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
