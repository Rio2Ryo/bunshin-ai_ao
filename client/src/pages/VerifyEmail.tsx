import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { Bot, Loader2, Mail, CheckCircle, AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { toast } from "sonner";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

export default function VerifyEmail() {
  usePageMeta({ title: "メール確認", description: "メールアドレスを確認してアカウントを有効化してください。", path: "/verify-email" });
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const token = params.get("token");
  const emailParam = params.get("email");
  const utils = trpc.useUtils();

  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verifyMutation = trpc.auth.verifyEmail.useMutation({
    onSuccess: async (data) => {
      setVerified(true);
      // Set session cookie (auto-login)
      await fetch(`${API_BASE}/api/auth/set-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: data.token }),
      });
      await utils.auth.me.invalidate();
      toast.success("メールアドレスが確認されました！");
      // Redirect to onboarding after short delay
      setTimeout(() => navigate("/onboarding"), 1500);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const resendMutation = trpc.auth.resendVerification.useMutation({
    onSuccess: () => {
      toast.success("確認メールを再送信しました");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  // Auto-verify if token is in URL
  useEffect(() => {
    if (token && !verified && !error) {
      verifyMutation.mutate({ token });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Verifying mode: token present, processing
  if (token) {
    if (verified) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <CheckCircle className="h-8 w-8 text-emerald-500" />
                </div>
              </div>
              <CardTitle className="text-2xl">確認完了</CardTitle>
              <CardDescription>
                メールアドレスが確認されました。オンボーディングへ移動します...
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
            </CardContent>
          </Card>
        </div>
      );
    }

    if (error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-destructive/20 flex items-center justify-center">
                  <AlertCircle className="h-8 w-8 text-destructive" />
                </div>
              </div>
              <CardTitle className="text-2xl">確認できませんでした</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-center">
                <Link href="/login" className="text-sm text-primary hover:underline">
                  ログインページへ戻る
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    // Loading state
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            </div>
            <CardTitle className="text-2xl">確認中...</CardTitle>
            <CardDescription>メールアドレスを確認しています。しばらくお待ちください。</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Waiting mode: no token, show "check your email" message
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
              <Mail className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">確認メールを送信しました</CardTitle>
          <CardDescription>
            {emailParam ? (
              <>{emailParam} に確認メールを送信しました。メール内のリンクをクリックしてアカウントを有効化してください。</>
            ) : (
              <>ご登録のメールアドレスに確認メールを送信しました。メール内のリンクをクリックしてアカウントを有効化してください。</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            メールが届かない場合は、迷惑メールフォルダを確認するか、再送信ボタンをお試しください。
          </p>
          {emailParam && (
            <Button
              variant="outline"
              className="w-full"
              disabled={resendMutation.isPending}
              onClick={() => resendMutation.mutate({ email: emailParam })}
            >
              {resendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Mail className="h-4 w-4 mr-2" />}
              確認メールを再送信
            </Button>
          )}
          <div className="text-center">
            <Link href="/login" className="text-sm text-primary hover:underline">
              ログインページへ戻る
            </Link>
          </div>
          <div className="text-center">
            <Link href="/" className="text-sm text-muted-foreground hover:underline">
              トップページに戻る
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
