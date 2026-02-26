import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/usePageMeta";
import { ScrollText, Shield, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

export default function Terms() {
  usePageMeta({ title: "利用規約", description: "分身AI SaaSサービスの利用規約", path: "/terms" });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/30 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container flex h-14 items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              トップへ戻る
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground">
              プライバシーポリシー
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <ScrollText className="h-6 w-6 text-primary" />
              利用規約
            </CardTitle>
            <p className="text-sm text-muted-foreground">最終更新日: 2026年2月26日 | バージョン 2.0</p>
          </CardHeader>
          <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
            <h3>第1条（サービスの概要）</h3>
            <p>分身AI（以下「本サービス」）は、ユーザーがAIを活用したデジタルツイン（分身AI）を作成し、ビジネスマッチングやAIチャットを提供するSaaS（Software as a Service）プラットフォームです。本サービスはCloudflare上でホスティングされています。</p>

            <h3>第2条（定義）</h3>
            <ul>
              <li>「ユーザー」とは、本サービスにアカウントを登録した個人または法人をいいます</li>
              <li>「デジタルツイン」とは、ユーザーの情報に基づいて作成されたAI分身をいいます</li>
              <li>「マッチング」とは、デジタルツイン同士のAI対話による相性分析をいいます</li>
              <li>「ポイント」とは、サービス内で使用できる仮想通貨をいいます</li>
            </ul>

            <h3>第3条（利用資格）</h3>
            <p>本サービスを利用するには、以下の条件を満たす必要があります：</p>
            <ul>
              <li>18歳以上であること（未成年者は法定代理人の同意が必要）</li>
              <li>正確かつ最新の情報を提供すること</li>
              <li>本利用規約およびプライバシーポリシーに同意すること</li>
              <li>日本国内から利用可能なメールアドレスを保有すること</li>
            </ul>

            <h3>第4条（アカウント管理）</h3>
            <p>ユーザーは、自身のアカウント情報（メールアドレス・パスワード）の管理に全責任を負います。</p>
            <ul>
              <li>パスワードは8文字以上で設定してください</li>
              <li>アカウントの共有・譲渡・売買は禁止です</li>
              <li>不正アクセスが疑われる場合は直ちにパスワードを変更してください</li>
              <li>アカウントの不正利用による損害について、当社は責任を負いません</li>
            </ul>

            <h3>第5条（サブスクリプション・料金）</h3>
            <p>本サービスは以下のプランを提供します：</p>
            <table className="w-full text-sm">
              <thead>
                <tr><th>プラン</th><th>月額料金</th><th>年額料金</th></tr>
              </thead>
              <tbody>
                <tr><td>フリー</td><td>無料</td><td>無料</td></tr>
                <tr><td>プロ</td><td>¥980/月</td><td>¥9,800/年</td></tr>
                <tr><td>エンタープライズ</td><td>¥4,980/月</td><td>¥49,800/年</td></tr>
              </tbody>
            </table>
            <ul>
              <li>有料プランはStripeを通じたクレジットカード決済で処理されます</li>
              <li>サブスクリプションは自動更新されます</li>
              <li>解約は更新日の前日までに行ってください</li>
              <li>日割り返金は原則行いません</li>
              <li>年額プランの途中解約の場合、残期間の返金は行いません</li>
            </ul>

            <h3>第6条（デジタルツインAI）</h3>
            <p>ユーザーが作成したデジタルツインは、入力された情報をもとにAIが生成します。</p>
            <ul>
              <li>生成されたAIの発言は参考情報であり、正確性を保証しません</li>
              <li>不適切・違法なコンテンツの生成は禁止です</li>
              <li>デジタルツインのデータはユーザーに帰属します</li>
              <li>マーケットプレイスに公開したペルソナは他ユーザーが利用できます</li>
            </ul>

            <h3>第7条（マッチング機能）</h3>
            <p>マッチング結果はAIによる推定です。実際のビジネス成果や互換性を保証するものではありません。マッチング結果に基づく行動はユーザー自身の判断と責任において行ってください。</p>

            <h3>第8条（禁止事項）</h3>
            <p>以下の行為を禁止します。違反した場合、アカウントの停止・削除を行うことがあります：</p>
            <ul>
              <li>他人を偽った情報の登録・なりすまし</li>
              <li>不正アクセスやサービスの妨害（DDoS攻撃等）</li>
              <li>違法なコンテンツの作成・共有・配布</li>
              <li>APIの不正利用・レート制限の回避</li>
              <li>他ユーザーへの嫌がらせ・ストーキング</li>
              <li>リバースエンジニアリング・スクレイピング</li>
              <li>本サービスを利用した競合サービスの開発</li>
              <li>未成年者に対する不適切なコンテンツの生成</li>
            </ul>

            <h3>第9条（知的財産権）</h3>
            <ul>
              <li>本サービスのソフトウェア・デザイン・商標は当社に帰属します</li>
              <li>ユーザーが入力した情報・作成したデータはユーザーに帰属します</li>
              <li>AIが生成したコンテンツの権利はユーザーに帰属します</li>
              <li>当社はサービス改善のため、匿名化されたデータを分析に使用することがあります</li>
            </ul>

            <h3>第10条（サービスの中断・変更・終了）</h3>
            <ul>
              <li>メンテナンス、障害、不可抗力によりサービスを一時中断することがあります</li>
              <li>機能の追加・変更・廃止を行うことがあります</li>
              <li>サービス終了の場合は30日前までに通知し、データエクスポート期間を設けます</li>
            </ul>

            <h3>第11条（免責事項）</h3>
            <p>本サービスは「現状のまま（AS IS）」で提供されます。</p>
            <ul>
              <li>AI生成コンテンツの正確性・適法性・完全性を保証しません</li>
              <li>サービスの中断による損害について、当社の故意・重過失の場合を除き責任を負いません</li>
              <li>有料プランの場合、損害賠償額は過去12ヶ月間の利用料金を上限とします</li>
            </ul>

            <h3>第12条（退会・データ削除）</h3>
            <p>ユーザーはいつでもアカウントを削除できます（プロフィール設定 → 危険な操作）。</p>
            <ul>
              <li>アカウント削除時、すべてのデータが完全に削除されます（GDPR第17条準拠）</li>
              <li>削除されたデータの復元はできません</li>
              <li>有料サブスクリプションは自動的にキャンセルされます</li>
            </ul>

            <h3>第13条（規約の変更）</h3>
            <p>本規約は必要に応じて変更されることがあります。重要な変更の際は、登録メールアドレスおよびサービス内通知でお知らせします。変更後のサービス利用継続をもって、変更後の規約に同意したものとみなします。</p>

            <h3>第14条（準拠法・管轄裁判所）</h3>
            <p>本規約は日本法に準拠し、東京地方裁判所を第一審の専属的合意管轄裁判所とします。</p>

            <h3>第15条（お問い合わせ）</h3>
            <p>利用規約に関するお問い合わせは、サービス内のフィードバック機能またはGitHub Issuesよりお願いします。</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
