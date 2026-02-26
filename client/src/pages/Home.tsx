import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/usePageMeta";
import { Link } from "wouter";
import {
  Bot,
  Users,
  Zap,
  MessageSquare,
  BarChart3,
  Settings2,
  ArrowRight,
  Shield,
  Sparkles,
  Globe,
  ChevronRight,
  Brain,
  Target,
  TrendingUp,
  Check,
  Crown,
  CreditCard,
} from "lucide-react";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  usePageMeta({
    title: "デジタルツインでビジネスマッチング",
    description:
      "あなたのデジタルツインを作成し、AIがビジネスパートナーを見つけます。知識・経験・スキルを学習した分身AIで新たな可能性を開拓。",
    ogImage: "https://bunshin-ai.pages.dev/og/home.svg",
    path: "/",
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header
        className="border-b border-border/30 backdrop-blur-xl fixed top-0 w-full z-50 bg-background/60"
        role="banner"
      >
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="absolute inset-0 rounded-lg bg-primary/20 blur-md" />
              <Bot className="relative h-8 w-8 text-primary" aria-hidden="true" />
            </div>
            <span className="text-xl font-bold text-gradient">分身AI</span>
          </div>
          <nav className="flex items-center gap-4" aria-label="メインナビゲーション">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground hidden md:block">機能</a>
            <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground hidden md:block">料金</a>
            {loading ? (
              <div className="h-9 w-20 bg-muted animate-pulse rounded-md" />
            ) : isAuthenticated ? (
              <Link href="/dashboard">
                <Button className="gap-2">
                  ダッシュボード
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </Link>
            ) : (
              <div className="flex items-center gap-3">
                <Link href="/login">
                  <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                    ログイン
                  </Button>
                </Link>
                <Link href="/register">
                  <Button className="glow-primary gap-2">
                    無料で始める
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            )}
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-28 pb-16 relative overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 bg-grid opacity-10" />
        <div className="absolute top-20 left-1/4 w-96 h-96 rounded-full bg-primary/8 blur-[100px] animate-pulse" style={{ animationDuration: "6s" }} />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 rounded-full bg-accent/8 blur-[100px] animate-pulse" style={{ animationDuration: "8s" }} />

        <div className="container relative">
          <div className="max-w-4xl mx-auto text-center">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-sm text-primary mb-8">
              <Sparkles className="h-4 w-4" />
              AI時代の新しいビジネスマッチング
            </div>

            <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight tracking-tight">
              <span className="text-gradient">あなたの分身AI</span>を
              <br />
              創造する
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
              あなたの知識、経験、スキルを学習したAIが、
              <br className="hidden sm:block" />
              ビジネスパートナーを見つけ、新たな可能性を開拓します。
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {isAuthenticated ? (
                <Link href="/dashboard">
                  <Button size="lg" className="glow-primary text-base px-8 h-12 gap-2">
                    ダッシュボードへ
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                </Link>
              ) : (
                <Link href="/register">
                  <Button size="lg" className="glow-primary text-base px-8 h-12 gap-2">
                    無料で始める
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                </Link>
              )}
              <a href="#features">
                <Button size="lg" variant="outline" className="text-base px-8 h-12">
                  詳しく見る
                </Button>
              </a>
            </div>
          </div>

          {/* Hero Visual — Dashboard Preview Card */}
          <div className="mt-16 max-w-4xl mx-auto">
            <div className="relative rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm p-1 shadow-2xl shadow-primary/5">
              {/* Gradient border glow */}
              <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-primary/20 via-transparent to-accent/20 -z-10 blur-sm" />
              <div className="rounded-xl bg-card/90 p-6 md:p-8">
                {/* Mock header bar */}
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-3 h-3 rounded-full bg-red-500/60" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                  <div className="w-3 h-3 rounded-full bg-green-500/60" />
                  <div className="ml-4 h-5 w-48 rounded bg-muted/50" />
                </div>
                {/* Mock dashboard content */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <MockStatCard icon={<Brain className="h-5 w-5 text-cyan-400" />} label="分身AI" value="学習完了" color="border-cyan-500/30" />
                  <MockStatCard icon={<Target className="h-5 w-5 text-violet-400" />} label="マッチング" value="相性 92%" color="border-violet-500/30" />
                  <MockStatCard icon={<TrendingUp className="h-5 w-5 text-emerald-400" />} label="信頼スコア" value="ゴールド" color="border-emerald-500/30" />
                </div>
                {/* Mock chat preview */}
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex-shrink-0 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 rounded-xl bg-muted/30 border border-border/30 p-3">
                    <div className="h-3 w-3/4 rounded bg-muted/60 mb-2" />
                    <div className="h-3 w-1/2 rounded bg-muted/40" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-12 max-w-3xl mx-auto">
            <div className="grid grid-cols-3 gap-4">
              <StatPill icon={<Shield className="h-4 w-4" />} value="安全" label="エンドツーエンド暗号化" />
              <StatPill icon={<Globe className="h-4 w-4" />} value="5+" label="AI プロバイダー対応" />
              <StatPill icon={<Zap className="h-4 w-4" />} value="即時" label="マッチング分析" />
            </div>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      {/* Features Section */}
      <section id="features" className="py-24 relative">
        <div className="absolute inset-0 bg-card/40" />
        <div className="container relative">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-muted/50 text-xs text-muted-foreground mb-4 uppercase tracking-wider">
              機能一覧
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">主な機能</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              分身AIプラットフォームの全機能で、あなたのビジネスを加速させます。
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            <FeatureCard
              icon={<Bot className="h-6 w-6" />}
              title="分身AI作成"
              description="あなたのプロフィール、スキル、経験を学習した分身AIを作成。ドキュメントやデータをアップロードして知識を拡張できます。"
              gradient="from-cyan-500/20 to-blue-500/20"
              iconBg="bg-cyan-500/10 text-cyan-400"
            />
            <FeatureCard
              icon={<MessageSquare className="h-6 w-6" />}
              title="1対1チャット"
              description="作成した分身AIと対話して、学習内容を確認。あなたの代わりに質問に答えられるか検証できます。"
              gradient="from-violet-500/20 to-purple-500/20"
              iconBg="bg-violet-500/10 text-violet-400"
            />
            <FeatureCard
              icon={<Users className="h-6 w-6" />}
              title="分身AI同士の対話"
              description="異なるユーザーの分身AI同士が自動で対話。ビジネステーマに沿って協業の可能性を探ります。"
              gradient="from-emerald-500/20 to-green-500/20"
              iconBg="bg-emerald-500/10 text-emerald-400"
            />
            <FeatureCard
              icon={<BarChart3 className="h-6 w-6" />}
              title="マッチング分析"
              description="AI同士の対話を分析し、相性スコア、協業可能性、具体的な提案を自動生成します。"
              gradient="from-amber-500/20 to-orange-500/20"
              iconBg="bg-amber-500/10 text-amber-400"
            />
            <FeatureCard
              icon={<Zap className="h-6 w-6" />}
              title="外部AI連携"
              description="ChatGPT、Gemini、Claudeなど複数のAIモデルを連携。タスクに応じて最適なAIを自動選択します。"
              gradient="from-rose-500/20 to-pink-500/20"
              iconBg="bg-rose-500/10 text-rose-400"
            />
            <FeatureCard
              icon={<Settings2 className="h-6 w-6" />}
              title="AIオーケストレーション"
              description="複数のAIに役割を割り当て、全体をプロジェクトマネジメント。効率的なAI活用を実現します。"
              gradient="from-indigo-500/20 to-blue-500/20"
              iconBg="bg-indigo-500/10 text-indigo-400"
            />
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      {/* How it Works Section */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute top-1/2 right-0 w-72 h-72 rounded-full bg-accent/5 blur-[80px] -translate-y-1/2" />
        <div className="container relative">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-muted/50 text-xs text-muted-foreground mb-4 uppercase tracking-wider">
              はじめかた
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">使い方</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              4つの簡単なステップで、分身AIを作成してビジネスマッチングを開始できます。
            </p>
          </div>
          {/* Desktop: 2x2 grid with numbered cards / Mobile: vertical list */}
          <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-5">
            <StepCard
              number={1}
              title="プロフィールを設定"
              description="あなたのスキル、経歴、ビジネス情報を入力します。"
              color="text-cyan-400 border-cyan-500/30 bg-cyan-500/10"
            />
            <StepCard
              number={2}
              title="分身AIを作成"
              description="プロフィールを基に分身AIを作成。ドキュメントをアップロードして知識を追加できます。"
              color="text-violet-400 border-violet-500/30 bg-violet-500/10"
            />
            <StepCard
              number={3}
              title="分身AIと対話"
              description="作成した分身AIとチャットして、学習内容を確認・調整します。"
              color="text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
            />
            <StepCard
              number={4}
              title="マッチング開始"
              description="他のユーザーの分身AIと自動対話を開始。ビジネスマッチングの可能性を探ります。"
              color="text-amber-400 border-amber-500/30 bg-amber-500/10"
            />
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      {/* Pricing Section */}
      <section id="pricing" className="py-24 relative">
        <div className="absolute inset-0 bg-card/40" />
        <div className="container relative">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-muted/50 text-xs text-muted-foreground mb-4 uppercase tracking-wider">
              料金プラン
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">シンプルな料金体系</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              あなたのニーズに合わせたプランをお選びください。すべてのプランで分身AI作成が可能です。
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            <PricingCard
              name="フリー"
              price="¥0"
              period="永久無料"
              description="分身AIを試してみたい方に"
              features={["分身AI 1体作成", "マッチング 月3回", "友達 5人まで", "AIチャット 月50回", "基本分析レポート"]}
              cta="無料で始める"
              ctaLink="/register"
              popular={false}
            />
            <PricingCard
              name="プロ"
              price="¥980"
              period="/月"
              yearlyPrice="¥9,800/年（2ヶ月分お得）"
              description="本格的にビジネスマッチングしたい方に"
              features={["分身AI フル機能", "マッチング 月30回", "友達 50人まで", "AIチャット 月500回", "詳細分析レポート", "CSV/PDFエクスポート", "外部AI連携（GPT/Gemini/Claude）", "優先サポート"]}
              cta="プロプランを始める"
              ctaLink="/register"
              popular={true}
            />
            <PricingCard
              name="エンタープライズ"
              price="¥4,980"
              period="/月"
              yearlyPrice="¥49,800/年（2ヶ月分お得）"
              description="組織・チームでの利用に"
              features={["すべてのプロ機能", "マッチング 無制限", "友達 無制限", "AIチャット 無制限", "APIアクセス 600req/分", "管理者ダッシュボード", "カスタムAIペルソナ", "SLA保証"]}
              cta="エンタープライズを始める"
              ctaLink="/register"
              popular={false}
            />
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      {/* Demo Section */}
      <section className="py-24 relative overflow-hidden">
        <div className="container">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-muted/50 text-xs text-muted-foreground mb-4 uppercase tracking-wider">
              デモ動画
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">分身AIの使い方を見る</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              3分でわかる分身AIプラットフォームのデモンストレーション
            </p>
          </div>
          <div className="max-w-4xl mx-auto">
            <div className="relative aspect-video rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm overflow-hidden group cursor-pointer">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-accent/10" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-20 h-20 rounded-full bg-primary/90 flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg shadow-primary/20">
                  <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
              <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-sm text-muted-foreground">
                <span>分身AI プラットフォーム紹介</span>
                <span>3:24</span>
              </div>
            </div>
            <p className="text-center text-sm text-muted-foreground mt-4">
              デモ動画は準備中です。サービスの使い方はオンボーディングガイドをご覧ください。
            </p>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      {/* CTA Section */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
        <div className="absolute top-0 right-1/3 w-64 h-64 rounded-full bg-primary/8 blur-[80px]" />
        <div className="absolute bottom-0 left-1/4 w-48 h-48 rounded-full bg-accent/8 blur-[60px]" />
        <div className="container relative">
          <div className="max-w-2xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-xs text-primary mb-6">
              <Sparkles className="h-3.5 w-3.5" />
              無料で利用開始
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">今すぐ始めましょう</h2>
            <p className="text-muted-foreground mb-10 text-lg">
              あなたの分身AIを作成し、新たなビジネスチャンスを発見しましょう。
            </p>
            {isAuthenticated ? (
              <Link href="/dashboard">
                <Button size="lg" className="glow-primary text-base px-10 h-12 gap-2">
                  ダッシュボードへ
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
            ) : (
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/register">
                  <Button size="lg" className="glow-primary text-base px-10 h-12 gap-2">
                    無料で始める
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                </Link>
                <Link href="/login">
                  <Button size="lg" variant="outline" className="text-base px-10 h-12">
                    ログイン
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-border/30">
        <div className="container">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2.5 mb-4">
                <Bot className="h-6 w-6 text-primary" />
                <span className="font-semibold text-gradient">分身AI</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                AIを活用したデジタルツインで、ビジネスマッチングを自動化するSaaSプラットフォーム。
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">サービス</h4>
              <div className="space-y-2 text-sm text-muted-foreground">
                <a href="#features" className="block hover:text-foreground transition-colors">機能一覧</a>
                <a href="#pricing" className="block hover:text-foreground transition-colors">料金プラン</a>
                <Link href="/api-docs" className="block hover:text-foreground transition-colors">API仕様書</Link>
                <Link href="/blog" className="block hover:text-foreground transition-colors">ブログ</Link>
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">法的情報</h4>
              <div className="space-y-2 text-sm text-muted-foreground">
                <Link href="/terms" className="block hover:text-foreground transition-colors">利用規約</Link>
                <Link href="/privacy" className="block hover:text-foreground transition-colors">プライバシーポリシー</Link>
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">アカウント</h4>
              <div className="space-y-2 text-sm text-muted-foreground">
                <Link href="/login" className="block hover:text-foreground transition-colors">ログイン</Link>
                <Link href="/register" className="block hover:text-foreground transition-colors">新規登録</Link>
              </div>
            </div>
          </div>
          <div className="h-px bg-border/30 mb-6" />
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">&copy; 2025-2026 分身AI. All rights reserved.</p>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/terms" className="hover:text-foreground transition-colors">利用規約</Link>
              <Link href="/privacy" className="hover:text-foreground transition-colors">プライバシー</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function MockStatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className={`rounded-xl border ${color} bg-card/80 p-4`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function StatPill({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm">
      <div className="text-primary">{icon}</div>
      <div className="min-w-0">
        <div className="font-semibold text-sm">{value}</div>
        <div className="text-xs text-muted-foreground truncate">{label}</div>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  gradient,
  iconBg,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  gradient: string;
  iconBg: string;
}) {
  return (
    <div
      className="group relative p-6 rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm hover:border-primary/40 transition-all duration-300 hover:-translate-y-0.5"
    >
      <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
      <div className="relative">
        <div className={`w-11 h-11 rounded-xl ${iconBg} flex items-center justify-center mb-4`}>
          {icon}
        </div>
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function StepCard({
  number,
  title,
  description,
  color,
}: {
  number: number;
  title: string;
  description: string;
  color: string;
}) {
  const [textColor, borderColor, bgColor] = color.split(" ");
  return (
    <div className={`relative p-6 rounded-2xl border ${borderColor} bg-card/60 backdrop-blur-sm hover:bg-card/80 transition-colors`}>
      <div className="flex items-start gap-4">
        <div className={`flex-shrink-0 w-10 h-10 rounded-full ${bgColor} flex items-center justify-center`}>
          <span className={`text-lg font-bold ${textColor}`}>{number}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold mb-1">{title}</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
        </div>
      </div>
    </div>
  );
}

function PricingCard({
  name,
  price,
  period,
  yearlyPrice,
  description,
  features,
  cta,
  ctaLink,
  popular,
}: {
  name: string;
  price: string;
  period: string;
  yearlyPrice?: string;
  description: string;
  features: string[];
  cta: string;
  ctaLink: string;
  popular: boolean;
}) {
  return (
    <div className={`relative p-6 rounded-2xl border-2 bg-card/80 backdrop-blur-sm ${popular ? 'border-primary shadow-lg shadow-primary/10' : 'border-border/50'}`}>
      {popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
          人気No.1
        </div>
      )}
      <div className="mb-6">
        <h3 className="text-lg font-bold mb-1">{name}</h3>
        <p className="text-sm text-muted-foreground mb-4">{description}</p>
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-bold">{price}</span>
          <span className="text-muted-foreground">{period}</span>
        </div>
        {yearlyPrice && <p className="text-xs text-muted-foreground mt-1">{yearlyPrice}</p>}
      </div>
      <ul className="space-y-3 mb-8">
        {features.map((f, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <Check className="h-4 w-4 text-primary flex-shrink-0" />
            {f}
          </li>
        ))}
      </ul>
      <Link href={ctaLink}>
        <Button className={`w-full ${popular ? 'glow-primary' : ''}`} variant={popular ? 'default' : 'outline'}>
          {cta}
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </Link>
    </div>
  );
}
