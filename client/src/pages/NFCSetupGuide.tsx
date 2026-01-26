import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useLocation } from "wouter";
import { 
  ArrowLeft,
  Smartphone,
  CreditCard,
  Download,
  Wifi,
  Check,
  ExternalLink,
  ShoppingCart,
  HelpCircle,
  AlertCircle,
  Lightbulb
} from "lucide-react";

export default function NFCSetupGuide() {
  const [, navigate] = useLocation();

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* ヘッダー */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate("/cards/my")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            戻る
          </Button>
          <div>
            <h1 className="text-2xl font-bold">NFC名刺セットアップガイド</h1>
            <p className="text-muted-foreground">
              NFC名刺の作成から共有までの完全ガイド
            </p>
          </div>
        </div>

        {/* 概要 */}
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <Wifi className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">NFC名刺とは？</h3>
                <p className="text-muted-foreground mt-1">
                  NFC（Near Field Communication）技術を使った名刺です。相手がスマートフォンをかざすだけで、
                  あなたの連絡先情報やプロフィールを瞬時に共有できます。紙の名刺を渡す必要がなく、
                  環境にも優しい次世代の名刺交換方法です。
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ステップバイステップガイド */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">セットアップ手順</h2>
          
          {/* ステップ1 */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
                  1
                </div>
                <div>
                  <CardTitle className="text-lg">名刺を作成する</CardTitle>
                  <CardDescription>分身AIで名刺情報を登録</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                まず、分身AIで名刺を作成します。名前、会社名、連絡先、SNSアカウントなど、
                共有したい情報を登録してください。
              </p>
              <div className="flex gap-2">
                <Button onClick={() => navigate("/cards/create")}>
                  <CreditCard className="mr-2 h-4 w-4" />
                  名刺を作成する
                </Button>
                <Button variant="outline" onClick={() => navigate("/cards/my")}>
                  作成済みの名刺を見る
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ステップ2 */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
                  2
                </div>
                <div>
                  <CardTitle className="text-lg">NFCタグを入手する</CardTitle>
                  <CardDescription>書き込み可能なNFCタグを購入</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                NFCタグは様々な形状で販売されています。用途に合わせて選んでください。
              </p>
              
              <div className="grid gap-3 md:grid-cols-3">
                <div className="p-4 border rounded-lg">
                  <h4 className="font-semibold">カード型</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    クレジットカードサイズ。財布に入れて持ち運びやすい。
                  </p>
                  <Badge variant="secondary" className="mt-2">おすすめ</Badge>
                </div>
                <div className="p-4 border rounded-lg">
                  <h4 className="font-semibold">シール型</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    既存の名刺やスマホケースに貼り付け可能。
                  </p>
                </div>
                <div className="p-4 border rounded-lg">
                  <h4 className="font-semibold">キーホルダー型</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    鍵と一緒に持ち歩ける。紛失しにくい。
                  </p>
                </div>
              </div>

              <div className="p-4 bg-muted rounded-lg">
                <h4 className="font-semibold flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4" />
                  購入先
                </h4>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <li>• Amazon、楽天などのECサイト（「NFC タグ カード」で検索）</li>
                  <li>• 家電量販店のスマートフォンアクセサリーコーナー</li>
                  <li>• 100円ショップ（一部店舗）</li>
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  ※ NTAG213、NTAG215、NTAG216などのNTAGシリーズがおすすめです（144〜888バイト）
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ステップ3 */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
                  3
                </div>
                <div>
                  <CardTitle className="text-lg">NFCライターアプリをインストール</CardTitle>
                  <CardDescription>スマートフォンにアプリをダウンロード</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                NFCタグにURLを書き込むためのアプリをインストールします。
                以下のアプリがおすすめです。
              </p>
              
              <div className="grid gap-3 md:grid-cols-2">
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold">NFC Tools</h4>
                    <Badge>無料</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    シンプルで使いやすい。初心者におすすめ。
                  </p>
                  <div className="flex gap-2 mt-3">
                    <Button variant="outline" size="sm" asChild>
                      <a href="https://apps.apple.com/app/nfc-tools/id1252962749" target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-1 h-3 w-3" />
                        iOS
                      </a>
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <a href="https://play.google.com/store/apps/details?id=com.wakdev.wdnfc" target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-1 h-3 w-3" />
                        Android
                      </a>
                    </Button>
                  </div>
                </div>
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold">NXP TagWriter</h4>
                    <Badge>無料</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    NXP公式アプリ。高度な設定も可能。
                  </p>
                  <div className="flex gap-2 mt-3">
                    <Button variant="outline" size="sm" asChild>
                      <a href="https://apps.apple.com/app/nxp-tagwriter/id1246143596" target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-1 h-3 w-3" />
                        iOS
                      </a>
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <a href="https://play.google.com/store/apps/details?id=com.nxp.nfc.tagwriter" target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-1 h-3 w-3" />
                        Android
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ステップ4 */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
                  4
                </div>
                <div>
                  <CardTitle className="text-lg">NFCタグにURLを書き込む</CardTitle>
                  <CardDescription>名刺の共有URLをNFCタグに設定</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                作成した名刺の共有URLをNFCタグに書き込みます。
              </p>
              
              <div className="space-y-3">
                <div className="flex gap-3 p-3 bg-muted rounded-lg">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold">
                    1
                  </div>
                  <div>
                    <p className="text-sm font-medium">共有URLを取得</p>
                    <p className="text-xs text-muted-foreground">
                      マイカード → 共有したい名刺 → 「共有する」から共有URLをコピー
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-3 p-3 bg-muted rounded-lg">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold">
                    2
                  </div>
                  <div>
                    <p className="text-sm font-medium">NFC Toolsアプリを開く</p>
                    <p className="text-xs text-muted-foreground">
                      「Write」タブを選択
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-3 p-3 bg-muted rounded-lg">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold">
                    3
                  </div>
                  <div>
                    <p className="text-sm font-medium">レコードを追加</p>
                    <p className="text-xs text-muted-foreground">
                      「Add a record」→「URL/URI」を選択し、コピーしたURLを貼り付け
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-3 p-3 bg-muted rounded-lg">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold">
                    4
                  </div>
                  <div>
                    <p className="text-sm font-medium">書き込み実行</p>
                    <p className="text-xs text-muted-foreground">
                      「Write」ボタンをタップし、NFCタグにスマホをかざして書き込み完了
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 border border-yellow-500/50 bg-yellow-500/10 rounded-lg">
                <div className="flex gap-2">
                  <Lightbulb className="h-5 w-5 text-yellow-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">ヒント</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      書き込み後、別のスマホでタグをスキャンして正しく動作するか確認しましょう。
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ステップ5 */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center">
                  <Check className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-lg">完了！</CardTitle>
                  <CardDescription>NFC名刺の準備ができました</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                これでNFC名刺の設定は完了です。相手がスマートフォンをNFCタグにかざすと、
                あなたの名刺ページが自動的に開きます。相手がログインすると、
                あなたの名刺情報が相手のアカウントに保存されます。
              </p>
            </CardContent>
          </Card>
        </div>

        {/* FAQ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5" />
              よくある質問
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="item-1">
                <AccordionTrigger>iPhoneでNFCタグに書き込めますか？</AccordionTrigger>
                <AccordionContent>
                  はい、iPhone 7以降のモデルでNFCタグへの書き込みが可能です。
                  ただし、iOS 13以降が必要です。NFC Toolsアプリを使用してください。
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2">
                <AccordionTrigger>NFCタグは何回でも書き換えられますか？</AccordionTrigger>
                <AccordionContent>
                  はい、一般的なNFCタグ（NTAG213など）は何度でも書き換え可能です。
                  ただし、ロック機能を使用すると書き換えできなくなるので注意してください。
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-3">
                <AccordionTrigger>相手がNFCに対応していない場合は？</AccordionTrigger>
                <AccordionContent>
                  QRコードを使用して共有できます。名刺の「共有する」ページからQRコードを
                  表示またはダウンロードして、相手にスキャンしてもらってください。
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-4">
                <AccordionTrigger>名刺の情報を更新したらNFCタグも更新が必要？</AccordionTrigger>
                <AccordionContent>
                  いいえ、NFCタグに書き込まれているのはURLだけなので、名刺の内容を
                  更新してもNFCタグの書き換えは不要です。URLにアクセスすると
                  常に最新の名刺情報が表示されます。
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-5">
                <AccordionTrigger>NFCタグの読み取り距離は？</AccordionTrigger>
                <AccordionContent>
                  一般的なNFCタグの読み取り距離は1〜4cm程度です。スマートフォンを
                  タグに近づける必要があります。読み取り位置はスマートフォンの
                  機種によって異なります（多くは背面上部）。
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        {/* CTA */}
        <Card className="bg-gradient-to-r from-primary/10 to-primary/5 border-primary/30">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <h3 className="text-xl font-semibold">さあ、始めましょう！</h3>
              <p className="text-muted-foreground">
                まずは名刺を作成して、NFC名刺の世界を体験してください。
              </p>
              <div className="flex justify-center gap-3">
                <Button size="lg" onClick={() => navigate("/cards/create")}>
                  <CreditCard className="mr-2 h-4 w-4" />
                  名刺を作成する
                </Button>
                <Button size="lg" variant="outline" onClick={() => navigate("/cards/my")}>
                  マイカードを見る
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
