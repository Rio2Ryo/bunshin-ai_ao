import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePageMeta } from "@/hooks/usePageMeta";
import { ScrollText } from "lucide-react";

export default function Terms() {
  usePageMeta({ title: "利用規約", description: "分身AIサービスの利用規約", path: "/terms" });

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-3xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-primary" />
              分身AI 利用規約
            </CardTitle>
            <p className="text-sm text-muted-foreground">最終更新日: 2026年2月26日 | バージョン 1.0</p>
          </CardHeader>
          <CardContent className="prose prose-sm dark:prose-invert max-w-none">
            <h3>第1条（サービスの概要）</h3>
            <p>分身AI（以下「本サービス」）は、ユーザーがデジタルツインAIを作成し、ビジネスマッチングを行うためのプラットフォームです。</p>

            <h3>第2条（利用資格）</h3>
            <p>本サービスを利用するには、以下の条件を満たす必要があります：</p>
            <ul>
              <li>18歳以上であること</li>
              <li>正確な情報を提供すること</li>
              <li>本利用規約に同意すること</li>
            </ul>

            <h3>第3条（アカウント）</h3>
            <p>ユーザーは自身のアカウント情報の管理に責任を負います。アカウントの共有・譲渡は禁止されています。</p>

            <h3>第4条（デジタルツインAI）</h3>
            <p>ユーザーが作成したデジタルツインAIは、ユーザーの入力情報に基づいて生成されます。不適切なコンテンツの生成は禁止されています。</p>

            <h3>第5条（マッチング機能）</h3>
            <p>マッチング結果はAIによる推定であり、実際のビジネス成果を保証するものではありません。</p>

            <h3>第6条（マーケットプレイス）</h3>
            <p>ペルソナテンプレートの売買はポイント制で行われます。購入したテンプレートの返金は原則行いません。</p>

            <h3>第7条（禁止事項）</h3>
            <ul>
              <li>他人を偽った情報の登録</li>
              <li>不正アクセスやサービスの妨害</li>
              <li>違法なコンテンツの作成・共有</li>
              <li>商業目的での無断利用</li>
              <li>他ユーザーへの嫌がらせ行為</li>
            </ul>

            <h3>第8条（プライバシー）</h3>
            <p>個人情報の取り扱いについては、別途プライバシーポリシーに定めます。</p>

            <h3>第9条（免責事項）</h3>
            <p>本サービスは「現状のまま」提供されます。サービスの中断・変更について事前通知なく行う場合があります。</p>

            <h3>第10条（規約の変更）</h3>
            <p>本規約は必要に応じて変更されることがあります。重要な変更の際はサービス内で通知します。</p>

            <h3>第11条（準拠法）</h3>
            <p>本規約は日本法に準拠し、東京地方裁判所を第一審の専属的合意管轄裁判所とします。</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
