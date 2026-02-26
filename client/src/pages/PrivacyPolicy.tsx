import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/usePageMeta";
import { Shield, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

export default function PrivacyPolicy() {
  usePageMeta({ title: "プライバシーポリシー", description: "分身AI SaaSサービスのプライバシーポリシー", path: "/privacy" });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/30 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container flex h-14 items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              トップへ戻る
            </Button>
          </Link>
          <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground">
            利用規約
          </Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Shield className="h-6 w-6 text-primary" />
              プライバシーポリシー
            </CardTitle>
            <p className="text-sm text-muted-foreground">最終更新日: 2026年2月26日 | バージョン 1.0</p>
          </CardHeader>
          <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
            <h3>1. はじめに</h3>
            <p>本プライバシーポリシー（以下「本ポリシー」）は、分身AI（以下「本サービス」）における個人情報の取り扱いについて定めるものです。本サービスはEU一般データ保護規則（GDPR）および日本の個人情報保護法に準拠しています。</p>

            <h3>2. 収集する個人情報</h3>
            <h4>2.1 ユーザーが直接提供する情報</h4>
            <ul>
              <li><strong>アカウント情報</strong>: メールアドレス、パスワード（ハッシュ化して保存）、表示名</li>
              <li><strong>プロフィール情報</strong>: 自己紹介、スキル、経歴、会社名、業界、役職</li>
              <li><strong>デジタルツインデータ</strong>: 性格情報、知識ベース、AI設定</li>
              <li><strong>決済情報</strong>: Stripeを通じて処理（当社はカード番号を保持しません）</li>
            </ul>
            <h4>2.2 自動的に収集される情報</h4>
            <ul>
              <li><strong>利用データ</strong>: APIリクエスト数、マッチング回数、チャット利用状況</li>
              <li><strong>技術情報</strong>: IPアドレス、ブラウザ種別、アクセス日時</li>
              <li><strong>Cookie</strong>: セッション管理用Cookie（HttpOnly、Secure属性）</li>
            </ul>

            <h3>3. 個人情報の利用目的</h3>
            <ul>
              <li>サービスの提供・維持・改善</li>
              <li>ユーザー認証・セッション管理</li>
              <li>デジタルツインAIの生成・学習</li>
              <li>マッチング分析の実行</li>
              <li>利用料金の請求・決済処理</li>
              <li>サービスに関するお知らせの送信</li>
              <li>不正利用の防止・セキュリティ確保</li>
              <li>匿名化された統計情報の分析</li>
            </ul>

            <h3>4. 個人情報の共有・第三者提供</h3>
            <p>当社は、以下の場合を除き、個人情報を第三者に提供しません：</p>
            <ul>
              <li><strong>決済処理</strong>: Stripe, Inc.（PCI DSS準拠の決済処理業者）</li>
              <li><strong>AI処理</strong>: Azure AI Foundry、OpenAI、Google（匿名化されたプロンプトのみ）</li>
              <li><strong>インフラ</strong>: Cloudflare, Inc.（ホスティング・CDN）</li>
              <li><strong>法的要請</strong>: 法令に基づく開示請求があった場合</li>
              <li><strong>ユーザーの同意</strong>: 明示的な同意を得た場合</li>
            </ul>

            <h3>5. データの保管・セキュリティ</h3>
            <ul>
              <li>データはCloudflare D1（SQLite）およびR2に保存されます</li>
              <li>パスワードはPBKDF2（100,000回反復）でハッシュ化して保存</li>
              <li>通信はHTTPS/TLSで暗号化されています</li>
              <li>JWTセッションCookieはHttpOnly・Secure属性で保護</li>
              <li>APIレート制限によりブルートフォース攻撃を防止</li>
            </ul>

            <h3>6. データの保持期間</h3>
            <ul>
              <li>アカウントデータ: アカウント存続中＋削除後30日（バックアップからの完全削除まで）</li>
              <li>チャット履歴: アカウント存続中</li>
              <li>マッチング結果: アカウント存続中</li>
              <li>アクセスログ: 90日間</li>
              <li>決済記録: 法定保存期間（7年）</li>
            </ul>

            <h3>7. ユーザーの権利（GDPR）</h3>
            <p>EUおよび日本の個人情報保護法に基づき、以下の権利を行使できます：</p>
            <ul>
              <li><strong>アクセス権</strong>（第15条）: 保有する個人情報の開示を請求できます → プロフィール設定「データエクスポート」</li>
              <li><strong>訂正権</strong>（第16条）: 不正確な情報の訂正を求めることができます → プロフィール編集</li>
              <li><strong>削除権（忘れられる権利）</strong>（第17条）: 個人情報の削除を求めることができます → アカウント削除</li>
              <li><strong>データポータビリティ権</strong>（第20条）: 機械可読形式でデータをダウンロードできます → データエクスポート（JSON）</li>
              <li><strong>処理の制限権</strong>（第18条）: 特定の状況下でデータ処理の制限を求めることができます</li>
              <li><strong>異議申立権</strong>（第21条）: マーケティング目的の処理に異議を申し立てることができます</li>
            </ul>

            <h3>8. Cookie ポリシー</h3>
            <p>本サービスは以下のCookieを使用します：</p>
            <table className="w-full text-sm">
              <thead>
                <tr><th>Cookie名</th><th>目的</th><th>有効期限</th><th>種類</th></tr>
              </thead>
              <tbody>
                <tr><td>app_session_id</td><td>認証セッション管理</td><td>1年</td><td>必須</td></tr>
              </tbody>
            </table>
            <p>本サービスはトラッキングCookieや広告Cookieを使用しません。</p>

            <h3>9. 国際データ転送</h3>
            <p>本サービスはCloudflareのグローバルネットワークを利用しており、データが複数の国・地域のサーバーで処理される場合があります。Cloudflareは適切なデータ保護措置を講じています。</p>

            <h3>10. 未成年者のプライバシー</h3>
            <p>本サービスは18歳未満の方を対象としていません。18歳未満の方のデータを意図的に収集することはありません。</p>

            <h3>11. ポリシーの変更</h3>
            <p>本ポリシーは必要に応じて変更されることがあります。重要な変更の際は、登録メールアドレスおよびサービス内通知でお知らせします。</p>

            <h3>12. お問い合わせ</h3>
            <p>プライバシーに関するお問い合わせやGDPR関連の権利行使は、サービス内のフィードバック機能またはGitHub Issuesよりお願いします。</p>

            <div className="mt-8 p-4 bg-muted/50 rounded-lg">
              <h4 className="font-semibold mb-2">データに関する操作</h4>
              <ul className="space-y-1">
                <li><Link href="/profile" className="text-primary hover:underline">プロフィール設定</Link> — データエクスポート・アカウント削除</li>
                <li><Link href="/terms" className="text-primary hover:underline">利用規約</Link> — サービス利用条件</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
