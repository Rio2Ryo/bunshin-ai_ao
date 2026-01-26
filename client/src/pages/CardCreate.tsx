import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { 
  ArrowLeft,
  CreditCard, 
  Building2,
  User,
  Star,
  Calendar,
  Plus,
  Trash2,
  Save,
  Eye
} from "lucide-react";

// カードタイプの定義
const CARD_TYPES = [
  { value: "business_card", label: "名刺", icon: CreditCard },
  { value: "shop_card", label: "ショップカード", icon: Building2 },
  { value: "idol_sign", label: "サイン", icon: Star },
  { value: "membership", label: "メンバーシップ", icon: User },
  { value: "event", label: "イベント", icon: Calendar },
  { value: "other", label: "その他", icon: CreditCard },
] as const;

type CardType = typeof CARD_TYPES[number]["value"];

interface CustomField {
  label: string;
  value: string;
  type: "text" | "url" | "email" | "phone";
}

export default function CardCreate() {
  const [, navigate] = useLocation();
  
  // フォーム状態
  const [cardType, setCardType] = useState<CardType>("business_card");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  
  // 連絡先情報
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [twitter, setTwitter] = useState("");
  const [instagram, setInstagram] = useState("");
  const [facebook, setFacebook] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [line, setLine] = useState("");
  
  // ビジネス情報
  const [company, setCompany] = useState("");
  const [position, setPosition] = useState("");
  const [department, setDepartment] = useState("");
  const [industry, setIndustry] = useState("");
  
  // カスタムフィールド
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  // カード作成
  const createCardMutation = trpc.cards.createMyCard.useMutation({
    onSuccess: (card) => {
      toast.success("カードを作成しました！", { 
        description: `カードコード: ${card.code}` 
      });
      navigate("/cards/my");
    },
    onError: (error) => {
      toast.error("エラー", { description: error.message });
    },
  });

  // カスタムフィールドを追加
  const addCustomField = () => {
    setCustomFields([...customFields, { label: "", value: "", type: "text" }]);
  };

  // カスタムフィールドを削除
  const removeCustomField = (index: number) => {
    setCustomFields(customFields.filter((_, i) => i !== index));
  };

  // カスタムフィールドを更新
  const updateCustomField = (index: number, field: Partial<CustomField>) => {
    setCustomFields(customFields.map((cf, i) => i === index ? { ...cf, ...field } : cf));
  };

  // フォーム送信
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim()) {
      toast.error("タイトルを入力してください");
      return;
    }

    createCardMutation.mutate({
      cardType,
      title: title.trim(),
      subtitle: subtitle.trim() || undefined,
      description: description.trim() || undefined,
      imageUrl: imageUrl.trim() || undefined,
      isPublic,
      contactInfo: {
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        website: website.trim() || undefined,
        address: address.trim() || undefined,
        twitter: twitter.trim() || undefined,
        instagram: instagram.trim() || undefined,
        facebook: facebook.trim() || undefined,
        linkedin: linkedin.trim() || undefined,
        line: line.trim() || undefined,
      },
      businessInfo: {
        company: company.trim() || undefined,
        position: position.trim() || undefined,
        department: department.trim() || undefined,
        industry: industry.trim() || undefined,
      },
      customFields: customFields.filter(cf => cf.label && cf.value).map(cf => ({
        label: cf.label,
        value: cf.value,
        type: cf.type,
      })),
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl mx-auto">
        {/* ヘッダー */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate("/cards")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            戻る
          </Button>
          <div>
            <h1 className="text-2xl font-bold">新しいカードを作成</h1>
            <p className="text-muted-foreground">
              NFC名刺やショップカードを作成して共有しましょう
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <Tabs defaultValue="basic" className="space-y-6">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="basic">基本情報</TabsTrigger>
              <TabsTrigger value="contact">連絡先</TabsTrigger>
              <TabsTrigger value="business">ビジネス</TabsTrigger>
              <TabsTrigger value="custom">カスタム</TabsTrigger>
            </TabsList>

            {/* 基本情報 */}
            <TabsContent value="basic">
              <Card>
                <CardHeader>
                  <CardTitle>基本情報</CardTitle>
                  <CardDescription>カードの基本的な情報を入力してください</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="cardType">カードタイプ</Label>
                    <Select value={cardType} onValueChange={(v) => setCardType(v as CardType)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CARD_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            <div className="flex items-center gap-2">
                              <type.icon className="h-4 w-4" />
                              {type.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="title">タイトル *</Label>
                    <Input
                      id="title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="山田 太郎"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="subtitle">サブタイトル</Label>
                    <Input
                      id="subtitle"
                      value={subtitle}
                      onChange={(e) => setSubtitle(e.target.value)}
                      placeholder="CEO / 創業者"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">説明</Label>
                    <Textarea
                      id="description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="自己紹介やカードの説明を入力..."
                      rows={4}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="imageUrl">画像URL</Label>
                    <Input
                      id="imageUrl"
                      value={imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                      placeholder="https://example.com/image.jpg"
                    />
                    {imageUrl && (
                      <div className="mt-2 aspect-video rounded-lg overflow-hidden bg-muted max-w-xs">
                        <img 
                          src={imageUrl} 
                          alt="プレビュー"
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>公開設定</Label>
                      <p className="text-sm text-muted-foreground">
                        公開すると誰でもこのカードを取得できます
                      </p>
                    </div>
                    <Switch
                      checked={isPublic}
                      onCheckedChange={setIsPublic}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* 連絡先 */}
            <TabsContent value="contact">
              <Card>
                <CardHeader>
                  <CardTitle>連絡先情報</CardTitle>
                  <CardDescription>連絡先やSNSアカウントを入力してください</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="email">メールアドレス</Label>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="example@email.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">電話番号</Label>
                      <Input
                        id="phone"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="090-1234-5678"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="website">Webサイト</Label>
                    <Input
                      id="website"
                      type="url"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="https://example.com"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="address">住所</Label>
                    <Input
                      id="address"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="東京都渋谷区..."
                    />
                  </div>

                  <div className="border-t pt-4 mt-4">
                    <h4 className="font-medium mb-4">SNSアカウント</h4>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="twitter">Twitter / X</Label>
                        <Input
                          id="twitter"
                          value={twitter}
                          onChange={(e) => setTwitter(e.target.value)}
                          placeholder="@username"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="instagram">Instagram</Label>
                        <Input
                          id="instagram"
                          value={instagram}
                          onChange={(e) => setInstagram(e.target.value)}
                          placeholder="@username"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="facebook">Facebook</Label>
                        <Input
                          id="facebook"
                          value={facebook}
                          onChange={(e) => setFacebook(e.target.value)}
                          placeholder="username"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="linkedin">LinkedIn</Label>
                        <Input
                          id="linkedin"
                          value={linkedin}
                          onChange={(e) => setLinkedin(e.target.value)}
                          placeholder="username"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="line">LINE ID</Label>
                        <Input
                          id="line"
                          value={line}
                          onChange={(e) => setLine(e.target.value)}
                          placeholder="@lineid"
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ビジネス情報 */}
            <TabsContent value="business">
              <Card>
                <CardHeader>
                  <CardTitle>ビジネス情報</CardTitle>
                  <CardDescription>会社や役職の情報を入力してください</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="company">会社名</Label>
                    <Input
                      id="company"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder="株式会社〇〇"
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="department">部署</Label>
                      <Input
                        id="department"
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        placeholder="営業部"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="position">役職</Label>
                      <Input
                        id="position"
                        value={position}
                        onChange={(e) => setPosition(e.target.value)}
                        placeholder="部長"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="industry">業種</Label>
                    <Input
                      id="industry"
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                      placeholder="IT・通信"
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* カスタムフィールド */}
            <TabsContent value="custom">
              <Card>
                <CardHeader>
                  <CardTitle>カスタムフィールド</CardTitle>
                  <CardDescription>追加の情報を自由に設定できます</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {customFields.map((field, index) => (
                    <div key={index} className="flex gap-2 items-start">
                      <div className="flex-1 grid gap-2 md:grid-cols-3">
                        <Input
                          value={field.label}
                          onChange={(e) => updateCustomField(index, { label: e.target.value })}
                          placeholder="ラベル"
                        />
                        <Input
                          value={field.value}
                          onChange={(e) => updateCustomField(index, { value: e.target.value })}
                          placeholder="値"
                        />
                        <Select 
                          value={field.type} 
                          onValueChange={(v) => updateCustomField(index, { type: v as CustomField["type"] })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">テキスト</SelectItem>
                            <SelectItem value="url">URL</SelectItem>
                            <SelectItem value="email">メール</SelectItem>
                            <SelectItem value="phone">電話</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeCustomField(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    onClick={addCustomField}
                    className="w-full"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    フィールドを追加
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* 送信ボタン */}
          <div className="flex justify-end gap-3 mt-6">
            <Button type="button" variant="outline" onClick={() => navigate("/cards")}>
              キャンセル
            </Button>
            <Button type="submit" disabled={createCardMutation.isPending}>
              <Save className="mr-2 h-4 w-4" />
              {createCardMutation.isPending ? "作成中..." : "カードを作成"}
            </Button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
