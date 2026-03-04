import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { Bot, Loader2, ArrowLeft, Mail, CheckCircle } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "wouter";
import { toast } from "sonner";

type ForgotPasswordForm = { email: string };

export default function ForgotPassword() {
  usePageMeta({ title: "パスワードリセット", description: "パスワードをお忘れの方は、メールアドレスを入力してリセットリンクを受け取ってください。", path: "/forgot-password" });
  const { register, handleSubmit, watch, formState: { errors, isSubmitting }, reset } = useForm<ForgotPasswordForm>();
  const [sent, setSent] = useState(false);

  const emailValue = watch("email");

  const resetMutation = trpc.auth.requestPasswordReset.useMutation({
    onSuccess: () => {
      setSent(true);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    resetMutation.mutate({ email: data.email });
  });

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <CheckCircle className="h-8 w-8 text-emerald-500" />
              </div>
            </div>
            <CardTitle className="text-2xl">メールを送信しました</CardTitle>
            <CardDescription>
              {emailValue} にパスワードリセットのリンクを送信しました。メールをご確認ください。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              メールが届かない場合は、迷惑メールフォルダを確認するか、数分後に再度お試しください。
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => { setSent(false); reset(); }}
            >
              <Mail className="h-4 w-4 mr-2" />
              別のメールアドレスで再送
            </Button>
            <div className="text-center">
              <Link href="/login" className="text-sm text-primary hover:underline">
                ログインに戻る
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
              <Bot className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">パスワードリセット</CardTitle>
          <CardDescription>
            登録済みのメールアドレスを入力してください。パスワードリセットのリンクをお送りします。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">メールアドレス</Label>
              <Input
                id="email"
                {...register("email", {
                  required: "メールアドレスを入力してください",
                  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "有効なメールアドレスを入力してください" }
                })}
                type="email"
                placeholder="email@example.com"
                autoComplete="email"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? "email-error" : undefined}
              />
              {errors.email && <p id="email-error" className="text-sm text-destructive mt-1">{errors.email.message}</p>}
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting || resetMutation.isPending}
            >
              {resetMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Mail className="h-4 w-4 mr-2" />
              )}
              リセットリンクを送信
            </Button>
          </form>

          <div className="mt-6 text-center">
            <Link href="/login" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" />
              ログインに戻る
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
