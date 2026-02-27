import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePageMeta } from "@/hooks/usePageMeta";
import { Bot, ArrowLeft, ArrowRight, Calendar, Clock, User, Tag, Sparkles, Brain, Target, Users, Shield, Zap } from "lucide-react";
import { Link } from "wouter";

const ARTICLES = [
  {
    id: "what-is-bunshin-ai",
    title: "分身AIとは？デジタルツインAIでビジネスマッチングを革新",
    description: "あなたの知識・経験・スキルを学習したAI分身を作成し、ビジネスパートナーとの出会いを自動化する方法を解説します。",
    date: "2026年2月26日",
    readTime: "5分",
    author: "分身AI チーム",
    tags: ["AI", "ビジネスマッチング", "デジタルツイン"],
    featured: true,
  },
  {
    id: "how-matching-works",
    title: "AIマッチングの仕組み — 分身AI同士の対話から相性スコアまで",
    description: "分身AI同士がどのように対話し、相性スコアや協業提案を生成するのか、技術的な仕組みをわかりやすく解説。",
    date: "2026年2月26日",
    readTime: "7分",
    author: "分身AI チーム",
    tags: ["マッチング", "AI対話", "相性分析"],
    featured: false,
  },
  {
    id: "personality-diagnosis",
    title: "Big Five診断・MBTIでAIを育てる — 性格学習の科学",
    description: "Big Five性格特性モデルとMBTI診断を用いて、より精度の高いデジタルツインを育成する方法。",
    date: "2026年2月26日",
    readTime: "6分",
    author: "分身AI チーム",
    tags: ["性格診断", "Big Five", "MBTI"],
    featured: false,
  },
  {
    id: "enterprise-use-cases",
    title: "企業導入事例 — 分身AIをチームのビジネス開発に活用",
    description: "エンタープライズプランを活用したチームでのマッチング、API連携、管理者ダッシュボードの実践例を紹介。",
    date: "2026年2月26日",
    readTime: "4分",
    author: "分身AI チーム",
    tags: ["エンタープライズ", "導入事例", "チーム"],
    featured: false,
  },
];

export default function Blog() {
  usePageMeta({
    title: "ブログ — 分身AI デジタルツインAIプラットフォーム",
    description: "分身AIの最新情報、活用方法、ビジネスマッチングのヒントをお届けします。AIデジタルツインの可能性を探る記事を公開中。",
    path: "/blog",
  });

  const featured = ARTICLES.find(a => a.featured);
  const rest = ARTICLES.filter(a => !a.featured);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/30 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container flex h-14 items-center justify-between">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              トップへ戻る
            </Button>
          </Link>
          <div className="flex items-center gap-2.5">
            <Bot className="h-5 w-5 text-primary" />
            <span className="font-semibold text-gradient">分身AI ブログ</span>
          </div>
          <Link href="/register">
            <Button size="sm">無料で始める</Button>
          </Link>
        </div>
      </header>

      <div className="container py-12 max-w-5xl">
        {/* Blog Hero */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 text-xs text-primary mb-4">
            <Sparkles className="h-3.5 w-3.5" />
            分身AI 公式ブログ
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">ブログ</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            デジタルツインAIの最新情報、活用ガイド、ビジネスマッチングのヒントをお届けします。
          </p>
        </div>

        {/* Featured Article */}
        {featured && (
          <Card className="mb-10 border-primary/30 bg-gradient-to-br from-primary/5 to-transparent overflow-hidden group cursor-pointer hover:border-primary/50 transition-colors">
            <CardContent className="p-8">
              <div className="flex items-center gap-2 mb-4">
                <Badge className="bg-primary text-primary-foreground">注目記事</Badge>
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {featured.date}
                </span>
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {featured.readTime}で読めます
                </span>
              </div>
              <h2 className="text-2xl md:text-3xl font-bold mb-3 group-hover:text-primary transition-colors">{featured.title}</h2>
              <p className="text-muted-foreground mb-6 leading-relaxed">{featured.description}</p>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-4 w-4" />
                  {featured.author}
                </div>
                <div className="flex gap-2">
                  {featured.tags.map(t => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Article Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {rest.map(article => (
            <Card key={article.id} className="group cursor-pointer hover:border-primary/40 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  <Calendar className="h-3 w-3" />
                  {article.date}
                  <span className="mx-1">·</span>
                  <Clock className="h-3 w-3" />
                  {article.readTime}
                </div>
                <CardTitle className="text-lg group-hover:text-primary transition-colors leading-snug">
                  {article.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{article.description}</p>
                <div className="flex gap-1.5 flex-wrap">
                  {article.tags.map(t => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Featured Article Full Content */}
        <div className="max-w-3xl mx-auto">
          <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent mb-12" />

          <article className="prose prose-sm dark:prose-invert max-w-none">
            <h2 className="text-3xl font-bold mb-6">分身AIとは？デジタルツインAIでビジネスマッチングを革新</h2>

            <div className="flex items-center gap-4 text-sm text-muted-foreground mb-8 not-prose">
              <span className="flex items-center gap-1"><Calendar className="h-4 w-4" /> 2026年2月26日</span>
              <span className="flex items-center gap-1"><Clock className="h-4 w-4" /> 5分で読めます</span>
              <span className="flex items-center gap-1"><User className="h-4 w-4" /> 分身AI チーム</span>
            </div>

            <div className="not-prose grid grid-cols-3 gap-4 my-8">
              <div className="p-4 rounded-xl border border-cyan-500/30 bg-cyan-500/5 text-center">
                <Brain className="h-8 w-8 text-cyan-400 mx-auto mb-2" />
                <p className="font-semibold text-sm">AI学習</p>
                <p className="text-xs text-muted-foreground">あなたの知識を学習</p>
              </div>
              <div className="p-4 rounded-xl border border-violet-500/30 bg-violet-500/5 text-center">
                <Target className="h-8 w-8 text-violet-400 mx-auto mb-2" />
                <p className="font-semibold text-sm">マッチング</p>
                <p className="text-xs text-muted-foreground">AI同士の自動対話</p>
              </div>
              <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-center">
                <Users className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                <p className="font-semibold text-sm">ビジネス連携</p>
                <p className="text-xs text-muted-foreground">新たなパートナー発見</p>
              </div>
            </div>

            <h3>デジタルツインAIとは</h3>
            <p>デジタルツインAIは、あなたの知識、経験、スキル、性格を学習したAI分身です。分身AIプラットフォームでは、このデジタルツインがあなたの代わりにビジネスパートナー候補と対話し、相性を分析します。</p>
            <p>従来のビジネスマッチングでは、人間同士が直接会って相性を確かめる必要がありました。分身AIでは、このプロセスをAIが自動化。あなたが寝ている間にも、分身AIが新たなビジネスチャンスを探し続けます。</p>

            <h3>分身AIの4つの強み</h3>

            <div className="not-prose space-y-4 my-6">
              <div className="flex gap-4 p-4 rounded-xl border border-border/50 bg-card/60">
                <Shield className="h-6 w-6 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">プライバシー保護</p>
                  <p className="text-sm text-muted-foreground">GDPR準拠のデータ管理。いつでもデータエクスポート・アカウント削除が可能。</p>
                </div>
              </div>
              <div className="flex gap-4 p-4 rounded-xl border border-border/50 bg-card/60">
                <Zap className="h-6 w-6 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">マルチAI対応</p>
                  <p className="text-sm text-muted-foreground">OpenAI、Gemini、Claude、Azure AIなど5つ以上のAIプロバイダーに対応。</p>
                </div>
              </div>
              <div className="flex gap-4 p-4 rounded-xl border border-border/50 bg-card/60">
                <Brain className="h-6 w-6 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">科学的な性格分析</p>
                  <p className="text-sm text-muted-foreground">Big Five性格特性モデル、MBTI診断、価値観シナリオを用いた精密な人格モデリング。</p>
                </div>
              </div>
              <div className="flex gap-4 p-4 rounded-xl border border-border/50 bg-card/60">
                <Target className="h-6 w-6 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">定量的マッチング</p>
                  <p className="text-sm text-muted-foreground">5つの評価軸で100点満点のスコアリング。強み・課題・具体的提案を自動生成。</p>
                </div>
              </div>
            </div>

            <h3>始め方</h3>
            <ol>
              <li><strong>アカウント作成</strong> — メールアドレスとパスワードで無料登録</li>
              <li><strong>AIオンボーディング</strong> — チャット形式であなたの情報をAIが収集</li>
              <li><strong>分身AI完成</strong> — プロフィールに基づいてデジタルツインが自動生成</li>
              <li><strong>マッチング開始</strong> — 友達を追加して、分身AI同士の対話を実行</li>
            </ol>

            <h3>料金プラン</h3>
            <p>分身AIは無料から始められます。フリープランでは月3回のマッチングと5人までの友達登録が可能。本格的に活用したい方にはプロプラン（月額¥1,480）、チームでの利用にはエンタープライズプラン（月額¥4,980）をご用意しています。</p>

            <div className="not-prose mt-8 p-6 rounded-2xl border border-primary/30 bg-primary/5 text-center">
              <h4 className="text-xl font-bold mb-2">今すぐ分身AIを始めましょう</h4>
              <p className="text-muted-foreground mb-4">無料アカウントを作成して、AIビジネスマッチングの世界へ。</p>
              <Link href="/register">
                <Button size="lg" className="glow-primary gap-2">
                  無料で始める
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </article>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-8 border-t border-border/30">
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Bot className="h-5 w-5 text-primary" />
            <span className="font-semibold text-gradient text-sm">分身AI</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/terms" className="hover:text-foreground transition-colors">利用規約</Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">プライバシー</Link>
            <Link href="/" className="hover:text-foreground transition-colors">トップ</Link>
          </div>
          <p className="text-xs text-muted-foreground">&copy; 2025-2026 分身AI</p>
        </div>
      </footer>
    </div>
  );
}
