import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Bot, Users, Zap, MessageSquare, BarChart3, Settings2 } from "lucide-react";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-sm fixed top-0 w-full z-50 bg-background/80">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-8 w-8 text-primary" />
            <span className="text-xl font-bold text-gradient">分身AI</span>
          </div>
          <nav className="flex items-center gap-4">
            {loading ? (
              <div className="h-9 w-20 bg-muted animate-pulse rounded-md" />
            ) : isAuthenticated ? (
              <Link href="/dashboard">
                <Button>ダッシュボード</Button>
              </Link>
            ) : (
              <Link href="/login">
                <Button>ログイン</Button>
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-20" />
        <div className="container relative">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-5xl md:text-6xl font-bold mb-6">
              <span className="text-gradient">あなたの分身AI</span>を
              <br />
              創造する
            </h1>
            <p className="text-xl text-muted-foreground mb-8">
              あなたの知識、経験、スキルを学習したAIが、
              <br />
              ビジネスパートナーを見つけ、新たな可能性を開拓します。
            </p>
            <div className="flex gap-4 justify-center">
              {isAuthenticated ? (
                <Link href="/dashboard">
                  <Button size="lg" className="glow-primary">
                    ダッシュボードへ
                  </Button>
                </Link>
              ) : (
                <a href="/login">
                  <Button size="lg" className="glow-primary">
                    無料で始める
                  </Button>
                </a>
              )}
              <Button size="lg" variant="outline">
                詳しく見る
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-card/50">
        <div className="container">
          <h2 className="text-3xl font-bold text-center mb-12">主な機能</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              icon={<Bot className="h-8 w-8" />}
              title="分身AI作成"
              description="あなたのプロフィール、スキル、経験を学習した分身AIを作成。ドキュメントやデータをアップロードして知識を拡張できます。"
            />
            <FeatureCard
              icon={<MessageSquare className="h-8 w-8" />}
              title="1対1チャット"
              description="作成した分身AIと対話して、学習内容を確認。あなたの代わりに質問に答えられるか検証できます。"
            />
            <FeatureCard
              icon={<Users className="h-8 w-8" />}
              title="分身AI同士の対話"
              description="異なるユーザーの分身AI同士が自動で対話。ビジネステーマに沿って協業の可能性を探ります。"
            />
            <FeatureCard
              icon={<BarChart3 className="h-8 w-8" />}
              title="マッチング分析"
              description="AI同士の対話を分析し、相性スコア、協業可能性、具体的な提案を自動生成します。"
            />
            <FeatureCard
              icon={<Zap className="h-8 w-8" />}
              title="外部AI連携"
              description="ChatGPT、Gemini、Claudeなど複数のAIモデルを連携。タスクに応じて最適なAIを自動選択します。"
            />
            <FeatureCard
              icon={<Settings2 className="h-8 w-8" />}
              title="AIオーケストレーション"
              description="複数のAIに役割を割り当て、全体をプロジェクトマネジメント。効率的なAI活用を実現します。"
            />
          </div>
        </div>
      </section>

      {/* How it Works Section */}
      <section className="py-20">
        <div className="container">
          <h2 className="text-3xl font-bold text-center mb-12">使い方</h2>
          <div className="max-w-4xl mx-auto">
            <div className="grid gap-8">
              <StepCard
                number={1}
                title="プロフィールを設定"
                description="あなたのスキル、経歴、ビジネス情報を入力します。"
              />
              <StepCard
                number={2}
                title="分身AIを作成"
                description="プロフィールを基に分身AIを作成。ドキュメントをアップロードして知識を追加できます。"
              />
              <StepCard
                number={3}
                title="分身AIと対話"
                description="作成した分身AIとチャットして、学習内容を確認・調整します。"
              />
              <StepCard
                number={4}
                title="マッチング開始"
                description="他のユーザーの分身AIと自動対話を開始。ビジネスマッチングの可能性を探ります。"
              />
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-card/50">
        <div className="container">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-bold mb-4">今すぐ始めましょう</h2>
            <p className="text-muted-foreground mb-8">
              あなたの分身AIを作成し、新たなビジネスチャンスを発見しましょう。
            </p>
            {isAuthenticated ? (
              <Link href="/dashboard">
                <Button size="lg" className="glow-primary">
                  ダッシュボードへ
                </Button>
              </Link>
            ) : (
              <Link href="/register">
                <Button size="lg" className="glow-primary">
                  無料で始める
                </Button>
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border/50">
        <div className="container">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="h-6 w-6 text-primary" />
              <span className="font-semibold">分身AI</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © 2025-2026 分身AI. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-6 rounded-xl bg-card border border-border/50 hover:border-primary/50 transition-colors">
      <div className="text-primary mb-4">{icon}</div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}

function StepCard({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-6 items-start">
      <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary/20 border border-primary/50 flex items-center justify-center">
        <span className="text-xl font-bold text-primary">{number}</span>
      </div>
      <div>
        <h3 className="text-lg font-semibold mb-1">{title}</h3>
        <p className="text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
