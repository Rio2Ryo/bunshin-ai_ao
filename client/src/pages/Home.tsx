import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/contexts/LanguageContext";
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
  const { t } = useTranslation();
  usePageMeta({
    title: "デジタルツインでビジネスマッチング",
    description:
      "あなたのデジタルツインを作成し、AIがビジネスパートナーを見つけます。知識・経験・スキルを学習した分身AIで新たな可能性を開拓。",
    ogImage: "https://bunshin-ai.pages.dev/og/home.svg",
    path: "/",
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md">{t("home.skipToMain")}</a>
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
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground hidden md:block">{t("home.navFeatures")}</a>
            <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground hidden md:block">{t("home.navPricing")}</a>
            {loading ? (
              <div className="h-9 w-20 bg-muted animate-pulse rounded-md" />
            ) : isAuthenticated ? (
              <Link href="/dashboard">
                <Button className="gap-2">
                  {t("home.ctaDashboard")}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </Link>
            ) : (
              <div className="flex items-center gap-3">
                <Link href="/login">
                  <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                    {t("home.navLogin")}
                  </Button>
                </Link>
                <Link href="/register">
                  <Button className="glow-primary gap-2">
                    {t("home.ctaStart")}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            )}
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <main id="main-content">
      <section className="pt-28 pb-16 relative overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 bg-grid opacity-10" aria-hidden="true" />
        <div className="absolute top-20 left-1/4 w-96 h-96 rounded-full bg-primary/8 blur-[100px] animate-pulse" style={{ animationDuration: "6s" }} aria-hidden="true" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 rounded-full bg-accent/8 blur-[100px] animate-pulse" style={{ animationDuration: "8s" }} aria-hidden="true" />

        <div className="container relative">
          <div className="max-w-4xl mx-auto text-center">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-sm text-primary mb-8">
              <Sparkles className="h-4 w-4" />
              {t("home.badge")}
            </div>

            <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight tracking-tight">
              <span className="text-gradient">{t("home.heroTitle1")}</span>
              <br />
              {t("home.heroTitle2")}
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
              {t("home.heroDesc")}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {isAuthenticated ? (
                <Link href="/dashboard">
                  <Button size="lg" className="glow-primary text-base px-8 h-12 gap-2">
                    {t("home.ctaDashboard")}
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                </Link>
              ) : (
                <Link href="/register">
                  <Button size="lg" className="glow-primary text-base px-8 h-12 gap-2">
                    {t("home.ctaStart")}
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                </Link>
              )}
              <a
                href="https://line.me/R/ti/p/@696szqnp"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button size="lg" className="text-base px-8 h-12 gap-2 text-white border-0" style={{ backgroundColor: "#06C755" }}>
                  <MessageSquare className="h-5 w-5" />
                  {t("home.ctaLine")}
                </Button>
              </a>
              <a href="#features">
                <Button size="lg" variant="outline" className="text-base px-8 h-12">
                  {t("home.ctaLearnMore")}
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
              <StatPill icon={<Shield className="h-4 w-4" />} value={t("home.statSafe")} label={t("home.statSafeDesc")} />
              <StatPill icon={<Globe className="h-4 w-4" />} value={t("home.statProviders")} label={t("home.statProvidersDesc")} />
              <StatPill icon={<Zap className="h-4 w-4" />} value={t("home.statInstant")} label={t("home.statInstantDesc")} />
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
              {t("home.featuresLabel")}
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">{t("home.featuresTitle")}</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              {t("home.featuresDesc")}
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            <FeatureCard
              icon={<Bot className="h-6 w-6" />}
              title={t("home.featureTwinTitle")}
              description={t("home.featureTwinDesc")}
              gradient="from-cyan-500/20 to-blue-500/20"
              iconBg="bg-cyan-500/10 text-cyan-400"
            />
            <FeatureCard
              icon={<MessageSquare className="h-6 w-6" />}
              title={t("home.featureChatTitle")}
              description={t("home.featureChatDesc")}
              gradient="from-violet-500/20 to-purple-500/20"
              iconBg="bg-violet-500/10 text-violet-400"
            />
            <FeatureCard
              icon={<Users className="h-6 w-6" />}
              title={t("home.featureDialogueTitle")}
              description={t("home.featureDialogueDesc")}
              gradient="from-emerald-500/20 to-green-500/20"
              iconBg="bg-emerald-500/10 text-emerald-400"
            />
            <FeatureCard
              icon={<BarChart3 className="h-6 w-6" />}
              title={t("home.featureAnalysisTitle")}
              description={t("home.featureAnalysisDesc")}
              gradient="from-amber-500/20 to-orange-500/20"
              iconBg="bg-amber-500/10 text-amber-400"
            />
            <FeatureCard
              icon={<Zap className="h-6 w-6" />}
              title={t("home.featureAITitle")}
              description={t("home.featureAIDesc")}
              gradient="from-rose-500/20 to-pink-500/20"
              iconBg="bg-rose-500/10 text-rose-400"
            />
            <FeatureCard
              icon={<Settings2 className="h-6 w-6" />}
              title={t("home.featureOrchTitle")}
              description={t("home.featureOrchDesc")}
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
              description="会社名・役職・スキル・経歴を入力。例：「SaaS営業10年、AI導入コンサル経験あり」など、あなたの強みを登録します。"
              color="text-cyan-400 border-cyan-500/30 bg-cyan-500/10"
            />
            <StepCard
              number={2}
              title="分身AIを作成"
              description="プロフィールを基にAIが自動学習。提案書やポートフォリオをアップロードすれば、さらに精度の高い分身が完成します。"
              color="text-violet-400 border-violet-500/30 bg-violet-500/10"
            />
            <StepCard
              number={3}
              title="分身AIと対話"
              description="「新規事業について相談したい」と話しかけてテスト。回答の精度を確認し、ナレッジを追加して調整できます。"
              color="text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
            />
            <StepCard
              number={4}
              title="マッチング開始"
              description="あなたの分身AIが相手の分身AIと自動で対話。「AI×教育で協業可能」など、具体的な相性分析レポートが届きます。"
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
              price="¥1,480"
              period="/月"
              yearlyPrice="¥14,800/年（2ヶ月分お得）"
              description="本格的にビジネスマッチングしたい方に"
              features={["分身AI フル機能", "マッチング 月30回", "友達 50人まで", "AIチャット 月500回", "詳細分析レポート", "CSV/PDFエクスポート", "外部AI連携（GPT/Gemini/Claude）", "優先サポート"]}
              cta={isAuthenticated ? "プロプランにアップグレード" : "プロプランを始める"}
              ctaLink={isAuthenticated ? "/plan" : "/register"}
              popular={true}
            />
            <PricingCard
              name="エンタープライズ"
              price="¥4,980"
              period="/月"
              yearlyPrice="¥49,800/年（2ヶ月分お得）"
              description="組織・チームでの利用に"
              features={["すべてのプロ機能", "マッチング 無制限", "友達 無制限", "AIチャット 無制限", "APIアクセス 600req/分", "管理者ダッシュボード", "カスタムAIペルソナ", "SLA保証"]}
              cta={isAuthenticated ? "エンタープライズにアップグレード" : "エンタープライズを始める"}
              ctaLink={isAuthenticated ? "/plan" : "/register"}
              popular={false}
            />
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      {/* Social Proof / Testimonials Section */}
      <section className="py-24 relative">
        <div className="absolute inset-0 bg-card/40" />
        <div className="container relative">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-muted/50 text-xs text-muted-foreground mb-4 uppercase tracking-wider">
              利用者の声
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">導入企業の評価</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              実際に分身AIを活用しているユーザーの声をご紹介します。
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              { name: "田中 太郎", role: "スタートアップCEO", text: "分身AIのおかげで、展示会に行かなくても自動でパートナー候補とマッチングできるようになりました。月に3件の提携が実現しています。", rating: 5 },
              { name: "鈴木 花子", role: "フリーランスデザイナー", text: "性格診断とAI対話の精度が高く、相性の良いクライアントを見つけられます。プロフィール設定だけで自動マッチングしてくれるのが便利。", rating: 5 },
              { name: "佐藤 健一", role: "コンサルティング会社", text: "エンタープライズプランで社員全員の分身AIを作成。部門間連携の可能性を可視化でき、組織改革に活用しています。", rating: 4 },
            ].map((testimonial, i) => (
              <Card key={i} className="bg-card/80 backdrop-blur-sm border-border/50">
                <CardContent className="pt-6">
                  <div className="flex gap-1 mb-3" role="img" aria-label={`${testimonial.rating}つ星中5つ星`}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <svg key={j} className={`h-4 w-4 ${j < testimonial.rating ? 'text-amber-400' : 'text-muted/30'}`} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                    "{testimonial.text}"
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-sm font-bold text-primary">{testimonial.name[0]}</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{testimonial.name}</p>
                      <p className="text-xs text-muted-foreground">{testimonial.role}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {/* Trust badges */}
          <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-muted-foreground">
            <div className="flex items-center gap-2 text-sm">
              <Shield className="h-5 w-5" />
              <span>GDPR準拠</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Check className="h-5 w-5" />
              <span>SSL暗号化通信</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Globe className="h-5 w-5" />
              <span>Cloudflareグローバルネットワーク</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CreditCard className="h-5 w-5" />
              <span>Stripe安全決済</span>
            </div>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      {/* Demo Section — 3 Use Case Cards */}
      <section className="py-24 relative overflow-hidden">
        <div className="container">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-muted/50 text-xs text-muted-foreground mb-4 uppercase tracking-wider">
              活用例
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">こんなシーンで使われています</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              業種・職種を問わず、ビジネスマッチングを自動化できます。
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            <DemoCard
              icon={<Target className="h-8 w-8 text-cyan-400" />}
              title="スタートアップ × 投資家"
              description="創業者の分身AIが事業計画を説明し、投資家の分身AIが質問。相性スコア92%で面談実現。"
              stat="月3件の提携"
              gradient="from-cyan-500/10 to-blue-500/10"
            />
            <DemoCard
              icon={<Users className="h-8 w-8 text-violet-400" />}
              title="フリーランス × 企業"
              description="デザイナーの分身AIがポートフォリオを紹介。企業の分身AIが要件をヒアリングし、最適な案件をマッチング。"
              stat="受注率2倍"
              gradient="from-violet-500/10 to-purple-500/10"
            />
            <DemoCard
              icon={<TrendingUp className="h-8 w-8 text-emerald-400" />}
              title="部門間コラボ"
              description="営業部と開発部の分身AI同士が対話。「顧客の声×技術力」で新サービスのアイデアを自動生成。"
              stat="アイデア創出3倍"
              gradient="from-emerald-500/10 to-green-500/10"
            />
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

      </main>

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

function DemoCard({
  icon,
  title,
  description,
  stat,
  gradient,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  stat: string;
  gradient: string;
}) {
  return (
    <div className="relative p-6 rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm overflow-hidden group hover:border-primary/30 transition-all">
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-100 transition-opacity`} />
      <div className="relative">
        <div className="mb-4">{icon}</div>
        <h3 className="text-lg font-bold mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">{description}</p>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
          <TrendingUp className="h-3 w-3" />
          {stat}
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
