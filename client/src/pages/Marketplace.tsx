import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { Store, Search, Star, Download, ShoppingCart, Plus, Package, ArrowUpDown, Check, Loader2, User, Tag } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { useTranslation } from "@/contexts/LanguageContext";

type SortOption = "popular" | "newest" | "rating" | "price";

const CATEGORIES = [
  { value: "all", label: { ja: "すべて", en: "All" } },
  { value: "general", label: { ja: "一般", en: "General" } },
  { value: "business", label: { ja: "ビジネス", en: "Business" } },
  { value: "creative", label: { ja: "クリエイティブ", en: "Creative" } },
  { value: "tech", label: { ja: "テック", en: "Tech" } },
];

const SORT_OPTIONS: { value: SortOption; label: { ja: string; en: string } }[] = [
  { value: "popular", label: { ja: "人気順", en: "Popular" } },
  { value: "newest", label: { ja: "新着順", en: "Newest" } },
  { value: "rating", label: { ja: "評価順", en: "Top Rated" } },
  { value: "price", label: { ja: "価格順", en: "Price" } },
];

function StarRating({ rating, count }: { rating: number; count: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`h-3.5 w-3.5 ${
            star <= Math.round(rating)
              ? "fill-yellow-400 text-yellow-400"
              : "text-muted-foreground/30"
          }`}
        />
      ))}
      <span className="text-xs text-muted-foreground ml-1">
        ({count})
      </span>
    </div>
  );
}

export default function Marketplace() {
  const { language } = useTranslation();
  const isJa = language === "ja";
  usePageMeta({
    title: isJa ? "マーケット" : "Marketplace",
    description: isJa ? "AIペルソナテンプレートを探索・購入・公開" : "Explore, purchase, and publish AI persona templates",
    path: "/marketplace",
  });

  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sort, setSort] = useState<SortOption>("popular");
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"browse" | "my-templates" | "my-purchases">("browse");

  // Publish form state
  const [publishName, setPublishName] = useState("");
  const [publishDesc, setPublishDesc] = useState("");
  const [publishCategory, setPublishCategory] = useState("general");
  const [publishPrice, setPublishPrice] = useState(0);
  const [publishPreviewBio, setPublishPreviewBio] = useState("");
  const [publishTags, setPublishTags] = useState("");

  // Review form state
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewTemplateId, setReviewTemplateId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  const { data: templates, isLoading } = trpc.marketplace.list.useQuery(
    {
      category: category === "all" ? undefined : category,
      search: search || undefined,
      sort,
    },
    { staleTime: 30_000 }
  );

  const { data: templateDetail, isLoading: detailLoading } = trpc.marketplace.get.useQuery(
    { id: selectedTemplate! },
    { enabled: !!selectedTemplate, staleTime: 30_000 }
  );

  const { data: myTemplates } = trpc.marketplace.myTemplates.useQuery(undefined, {
    enabled: activeTab === "my-templates",
    staleTime: 30_000,
  });

  const { data: myPurchases } = trpc.marketplace.myPurchases.useQuery(undefined, {
    enabled: activeTab === "my-purchases",
    staleTime: 30_000,
  });

  const purchaseMutation = trpc.marketplace.purchase.useMutation({
    onSuccess: () => {
      toast.success(isJa ? "テンプレートを購入しました" : "Template purchased!");
      utils.marketplace.list.invalidate();
      utils.marketplace.myPurchases.invalidate();
      if (selectedTemplate) utils.marketplace.get.invalidate({ id: selectedTemplate });
    },
    onError: (error) => toast.error(error.message),
  });

  const applyMutation = trpc.marketplace.apply.useMutation({
    onSuccess: () => {
      toast.success(isJa ? "テンプレートを分身AIに適用しました" : "Template applied to your twin!");
      utils.marketplace.myPurchases.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const publishMutation = trpc.marketplace.publish.useMutation({
    onSuccess: () => {
      toast.success(isJa ? "テンプレートを公開申請しました（管理者の承認をお待ちください）" : "Template submitted for approval!");
      setPublishOpen(false);
      resetPublishForm();
      utils.marketplace.myTemplates.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const reviewMutation = trpc.marketplace.review.useMutation({
    onSuccess: () => {
      toast.success(isJa ? "レビューを投稿しました" : "Review submitted!");
      setReviewOpen(false);
      setReviewComment("");
      setReviewRating(5);
      if (reviewTemplateId) utils.marketplace.get.invalidate({ id: reviewTemplateId });
      utils.marketplace.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  function resetPublishForm() {
    setPublishName("");
    setPublishDesc("");
    setPublishCategory("general");
    setPublishPrice(0);
    setPublishPreviewBio("");
    setPublishTags("");
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
  }

  function handlePublish() {
    if (!publishName.trim()) {
      toast.error(isJa ? "テンプレート名を入力してください" : "Please enter a template name");
      return;
    }
    publishMutation.mutate({
      name: publishName.trim(),
      description: publishDesc.trim() || undefined,
      category: publishCategory,
      price: publishPrice,
      previewBio: publishPreviewBio.trim() || undefined,
      tags: publishTags ? publishTags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    });
  }

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Store className="h-6 w-6 text-primary" />
              {isJa ? "AIペルソナマーケット" : "AI Persona Marketplace"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isJa
                ? "他のユーザーが作成したAIペルソナテンプレートを探索・購入できます"
                : "Explore and purchase AI persona templates created by other users"}
            </p>
          </div>
          <Button onClick={() => setPublishOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            {isJa ? "テンプレートを公開" : "Publish Template"}
          </Button>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList>
            <TabsTrigger value="browse" className="gap-1.5">
              <Store className="h-4 w-4" />
              {isJa ? "マーケット" : "Browse"}
            </TabsTrigger>
            <TabsTrigger value="my-templates" className="gap-1.5">
              <Package className="h-4 w-4" />
              {isJa ? "公開中" : "My Templates"}
            </TabsTrigger>
            <TabsTrigger value="my-purchases" className="gap-1.5">
              <ShoppingCart className="h-4 w-4" />
              {isJa ? "購入済み" : "Purchased"}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Browse Tab */}
        {activeTab === "browse" && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
              <form onSubmit={handleSearch} className="flex-1 flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={isJa ? "テンプレートを検索..." : "Search templates..."}
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Button type="submit" variant="secondary" size="sm">
                  <Search className="h-4 w-4" />
                </Button>
              </form>
              <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
                <SelectTrigger className="w-[140px]">
                  <ArrowUpDown className="h-3.5 w-3.5 mr-1.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {isJa ? opt.label.ja : opt.label.en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Category Tabs */}
            <div className="flex gap-2 flex-wrap">
              {CATEGORIES.map((cat) => (
                <Button
                  key={cat.value}
                  variant={category === cat.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCategory(cat.value)}
                  className="text-xs"
                >
                  {isJa ? cat.label.ja : cat.label.en}
                </Button>
              ))}
            </div>

            {/* Template Grid */}
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : templates && templates.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {templates.map((tmpl) => (
                  <Card
                    key={tmpl.id}
                    className="cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => setSelectedTemplate(tmpl.id)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <CardTitle className="text-base line-clamp-1">{tmpl.name}</CardTitle>
                        <Badge variant={tmpl.price === 0 ? "secondary" : "default"} className="ml-2 shrink-0">
                          {tmpl.price === 0
                            ? isJa ? "無料" : "Free"
                            : `${tmpl.price} pt`}
                        </Badge>
                      </div>
                      <CardDescription className="line-clamp-2 text-xs">
                        {tmpl.description || (isJa ? "説明なし" : "No description")}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pb-3 space-y-2">
                      <StarRating rating={tmpl.rating} count={tmpl.ratingCount} />
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {tmpl.creatorName || (isJa ? "不明" : "Unknown")}
                        </span>
                        <span className="flex items-center gap-1">
                          <Download className="h-3 w-3" />
                          {tmpl.purchaseCount}
                        </span>
                      </div>
                      {tmpl.tags.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {tmpl.tags.slice(0, 3).map((tag: string, i: number) => (
                            <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                    <CardFooter className="pt-0">
                      <Badge variant="outline" className="text-[10px]">
                        {CATEGORIES.find((c) => c.value === tmpl.category)
                          ? isJa
                            ? CATEGORIES.find((c) => c.value === tmpl.category)!.label.ja
                            : CATEGORIES.find((c) => c.value === tmpl.category)!.label.en
                          : tmpl.category}
                      </Badge>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Store className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">
                  {isJa ? "テンプレートが見つかりません" : "No templates found"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {isJa
                    ? "最初のテンプレートを公開してみましょう"
                    : "Be the first to publish a template!"}
                </p>
              </div>
            )}
          </div>
        )}

        {/* My Templates Tab */}
        {activeTab === "my-templates" && (
          <div className="space-y-4">
            {myTemplates && myTemplates.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {myTemplates.map((tmpl: any) => (
                  <Card key={tmpl.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <CardTitle className="text-base line-clamp-1">{tmpl.name}</CardTitle>
                        <div className="flex gap-1 shrink-0">
                          {tmpl.isApproved ? (
                            <Badge variant="default" className="text-[10px]">
                              <Check className="h-3 w-3 mr-0.5" />
                              {isJa ? "承認済み" : "Approved"}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">
                              {isJa ? "審査中" : "Pending"}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <CardDescription className="line-clamp-2 text-xs">
                        {tmpl.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pb-3">
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>
                          {tmpl.price === 0
                            ? isJa ? "無料" : "Free"
                            : `${tmpl.price} pt`}
                        </span>
                        <span className="flex items-center gap-1">
                          <Download className="h-3 w-3" />
                          {tmpl.purchaseCount} {isJa ? "回購入" : "purchases"}
                        </span>
                        <StarRating rating={tmpl.rating} count={tmpl.ratingCount} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Package className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">
                  {isJa ? "公開中のテンプレートはありません" : "No published templates"}
                </p>
                <Button variant="outline" className="mt-3" onClick={() => setPublishOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  {isJa ? "テンプレートを公開する" : "Publish a Template"}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* My Purchases Tab */}
        {activeTab === "my-purchases" && (
          <div className="space-y-4">
            {myPurchases && myPurchases.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {myPurchases.map((purchase: any) => (
                  <Card key={purchase.id}>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base line-clamp-1">{purchase.name}</CardTitle>
                      <CardDescription className="line-clamp-2 text-xs">
                        {purchase.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pb-3">
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>
                          {purchase.pointsSpent === 0
                            ? isJa ? "無料" : "Free"
                            : `${purchase.pointsSpent} pt`}
                        </span>
                        {purchase.appliedAt && (
                          <Badge variant="secondary" className="text-[10px]">
                            <Check className="h-3 w-3 mr-0.5" />
                            {isJa ? "適用済み" : "Applied"}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                    <CardFooter className="pt-0 gap-2">
                      {!purchase.appliedAt && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => applyMutation.mutate({ templateId: purchase.templateId })}
                          disabled={applyMutation.isPending}
                        >
                          {applyMutation.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                          ) : (
                            <Download className="h-3.5 w-3.5 mr-1" />
                          )}
                          {isJa ? "適用" : "Apply"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setReviewTemplateId(purchase.templateId);
                          setReviewOpen(true);
                        }}
                      >
                        <Star className="h-3.5 w-3.5 mr-1" />
                        {isJa ? "レビュー" : "Review"}
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <ShoppingCart className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">
                  {isJa ? "購入済みテンプレートはありません" : "No purchased templates"}
                </p>
                <Button variant="outline" className="mt-3" onClick={() => setActiveTab("browse")}>
                  <Store className="h-4 w-4 mr-2" />
                  {isJa ? "マーケットを見る" : "Browse Marketplace"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Template Detail Dialog */}
      <Dialog open={!!selectedTemplate} onOpenChange={(open) => { if (!open) setSelectedTemplate(null); }}>
        <DialogContent className="max-w-lg">
          {detailLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : templateDetail ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {templateDetail.name}
                  <Badge variant={templateDetail.price === 0 ? "secondary" : "default"}>
                    {templateDetail.price === 0
                      ? isJa ? "無料" : "Free"
                      : `${templateDetail.price} pt`}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  {templateDetail.description || (isJa ? "説明なし" : "No description")}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Stats */}
                <div className="flex items-center gap-4 text-sm">
                  <StarRating rating={templateDetail.rating} count={templateDetail.ratingCount} />
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Download className="h-3.5 w-3.5" />
                    {templateDetail.purchaseCount} {isJa ? "回購入" : "purchases"}
                  </span>
                </div>

                {/* Creator */}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-4 w-4" />
                  {isJa ? "作成者" : "Creator"}: {templateDetail.creatorName}
                </div>

                {/* Preview Bio */}
                {templateDetail.previewBio && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">{isJa ? "プレビュー" : "Preview"}</p>
                    <p className="text-sm bg-muted/50 rounded-lg p-3">{templateDetail.previewBio}</p>
                  </div>
                )}

                {/* Tags */}
                {templateDetail.tags && templateDetail.tags.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                    {templateDetail.tags.map((tag: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                <Separator />

                {/* Reviews */}
                {templateDetail.reviews && templateDetail.reviews.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      {isJa ? "レビュー" : "Reviews"}
                    </p>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {templateDetail.reviews.map((review: any) => (
                        <div key={review.id} className="bg-muted/30 rounded-lg p-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">{review.userName}</span>
                            <div className="flex items-center gap-0.5">
                              {[1, 2, 3, 4, 5].map((s) => (
                                <Star
                                  key={s}
                                  className={`h-3 w-3 ${s <= review.rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`}
                                />
                              ))}
                            </div>
                          </div>
                          {review.comment && (
                            <p className="text-xs text-muted-foreground mt-1">{review.comment}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter>
                {templateDetail.isPurchased ? (
                  <div className="flex gap-2 w-full">
                    <Button
                      className="flex-1"
                      onClick={() => applyMutation.mutate({ templateId: templateDetail.id })}
                      disabled={applyMutation.isPending}
                    >
                      {applyMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Download className="h-4 w-4 mr-2" />
                      )}
                      {isJa ? "分身AIに適用" : "Apply to Twin"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setReviewTemplateId(templateDetail.id);
                        setReviewOpen(true);
                      }}
                    >
                      <Star className="h-4 w-4 mr-1" />
                      {isJa ? "レビュー" : "Review"}
                    </Button>
                  </div>
                ) : (
                  <Button
                    className="w-full"
                    onClick={() => purchaseMutation.mutate({ templateId: templateDetail.id })}
                    disabled={purchaseMutation.isPending}
                  >
                    {purchaseMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <ShoppingCart className="h-4 w-4 mr-2" />
                    )}
                    {templateDetail.price === 0
                      ? isJa ? "無料で入手" : "Get for Free"
                      : isJa ? `${templateDetail.price} ptで購入` : `Purchase for ${templateDetail.price} pt`}
                  </Button>
                )}
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Publish Dialog */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isJa ? "テンプレートを公開" : "Publish Template"}
            </DialogTitle>
            <DialogDescription>
              {isJa
                ? "あなたの分身AIの性格とプロンプトをテンプレートとして公開します。管理者の承認後にマーケットに掲載されます。"
                : "Publish your twin's personality and prompt as a template. It will appear on the marketplace after admin approval."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{isJa ? "テンプレート名" : "Template Name"} *</Label>
              <Input
                value={publishName}
                onChange={(e) => setPublishName(e.target.value)}
                placeholder={isJa ? "例: ビジネスコンサルタント" : "e.g. Business Consultant"}
                className="mt-1"
              />
            </div>
            <div>
              <Label>{isJa ? "説明" : "Description"}</Label>
              <Textarea
                value={publishDesc}
                onChange={(e) => setPublishDesc(e.target.value)}
                placeholder={isJa ? "テンプレートの説明..." : "Describe the template..."}
                className="mt-1"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{isJa ? "カテゴリ" : "Category"}</Label>
                <Select value={publishCategory} onValueChange={setPublishCategory}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.filter((c) => c.value !== "all").map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {isJa ? cat.label.ja : cat.label.en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{isJa ? "価格 (ポイント)" : "Price (points)"}</Label>
                <Input
                  type="number"
                  min={0}
                  value={publishPrice}
                  onChange={(e) => setPublishPrice(Math.max(0, parseInt(e.target.value) || 0))}
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label>{isJa ? "プレビュー文" : "Preview Bio"}</Label>
              <Textarea
                value={publishPreviewBio}
                onChange={(e) => setPublishPreviewBio(e.target.value)}
                placeholder={isJa ? "マーケットで表示される紹介文..." : "Short preview shown in the marketplace..."}
                className="mt-1"
                rows={2}
              />
            </div>
            <div>
              <Label>{isJa ? "タグ (カンマ区切り)" : "Tags (comma-separated)"}</Label>
              <Input
                value={publishTags}
                onChange={(e) => setPublishTags(e.target.value)}
                placeholder={isJa ? "例: ビジネス, コンサル, 営業" : "e.g. business, consulting, sales"}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              {isJa ? "キャンセル" : "Cancel"}
            </Button>
            <Button onClick={handlePublish} disabled={publishMutation.isPending}>
              {publishMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {isJa ? "公開申請" : "Submit for Review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{isJa ? "レビューを書く" : "Write a Review"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{isJa ? "評価" : "Rating"}</Label>
              <div className="flex items-center gap-1 mt-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setReviewRating(star)}
                    className="focus:outline-none"
                  >
                    <Star
                      className={`h-6 w-6 transition-colors ${
                        star <= reviewRating
                          ? "fill-yellow-400 text-yellow-400"
                          : "text-muted-foreground/30 hover:text-yellow-200"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>{isJa ? "コメント" : "Comment"}</Label>
              <Textarea
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder={isJa ? "感想を書いてください..." : "Share your thoughts..."}
                className="mt-1"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>
              {isJa ? "キャンセル" : "Cancel"}
            </Button>
            <Button
              onClick={() => {
                if (!reviewTemplateId) return;
                reviewMutation.mutate({
                  templateId: reviewTemplateId,
                  rating: reviewRating,
                  comment: reviewComment || undefined,
                });
              }}
              disabled={reviewMutation.isPending}
            >
              {reviewMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {isJa ? "投稿" : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
