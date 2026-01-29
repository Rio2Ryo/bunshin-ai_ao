import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useState, useRef } from "react";
import { 
  Plus, 
  Search, 
  CreditCard, 
  Star, 
  Archive, 
  MoreVertical, 
  Eye, 
  Edit, 
  Trash2, 
  Upload,
  Loader2,
  ScanLine,
  Building2,
  User,
  Phone,
  Mail,
  MapPin,
  Globe,
  FileText,
  Tag,
  Calendar,
  ChevronLeft,
  X
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// カードタイプの定義
const CARD_TYPES = [
  { value: "business_card", label: "名刺", icon: User },
  { value: "point_card", label: "ポイントカード", icon: CreditCard },
  { value: "membership_card", label: "会員証", icon: FileText },
  { value: "medical_card", label: "診察券", icon: Building2 },
  { value: "insurance_card", label: "保険証", icon: FileText },
  { value: "student_id", label: "学生証", icon: User },
  { value: "employee_id", label: "社員証", icon: Building2 },
  { value: "library_card", label: "図書館カード", icon: FileText },
  { value: "credit_card", label: "クレジットカード", icon: CreditCard },
  { value: "other", label: "その他", icon: FileText },
];

// カードタイプのラベルを取得
function getCardTypeLabel(type: string): string {
  const found = CARD_TYPES.find(t => t.value === type);
  return found?.label || type;
}

// カードタイプのアイコンを取得
function getCardTypeIcon(type: string) {
  const found = CARD_TYPES.find(t => t.value === type);
  return found?.icon || FileText;
}

export default function Cards() {
  const { user } = useAuth();
  
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCardType, setSelectedCardType] = useState<string>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // カード一覧を取得
  const { data: cards, isLoading, refetch } = trpc.cards.list.useQuery({
    cardType: selectedCardType === "all" ? undefined : selectedCardType,
    isArchived: showArchived,
    isFavorite: showFavorites ? true : undefined,
  });

  // カード統計を取得
  const { data: stats } = trpc.cards.getStats.useQuery();

  // 検索
  const { data: searchResults, isLoading: isSearching } = trpc.cards.search.useQuery(
    { query: searchQuery, cardType: selectedCardType === "all" ? undefined : selectedCardType },
    { enabled: searchQuery.length > 0 }
  );

  // お気に入り切り替え
  const toggleFavoriteMutation = trpc.cards.toggleFavorite.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("お気に入りを更新しました");
    },
  });

  // アーカイブ切り替え
  const toggleArchiveMutation = trpc.cards.toggleArchive.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("アーカイブを更新しました");
    },
  });

  // 削除
  const deleteMutation = trpc.cards.delete.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("カードを削除しました");
    },
  });

  const displayCards = searchQuery.length > 0 ? searchResults : cards;

  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        {/* ヘッダー */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">カード管理</h1>
            <p className="text-muted-foreground">名刺やポイントカードなどを管理</p>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                カードを追加
              </Button>
            </DialogTrigger>
            <AddCardDialog 
              onClose={() => setIsAddDialogOpen(false)} 
              onSuccess={() => {
                setIsAddDialogOpen(false);
                refetch();
              }}
            />
          </Dialog>
        </div>

        {/* 統計カード */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{cards?.length || 0}</div>
              <p className="text-xs text-muted-foreground">総カード数</p>
            </CardContent>
          </Card>
          {stats?.slice(0, 3).map((stat) => (
            <Card key={stat.cardType}>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{stat.count}</div>
                <p className="text-xs text-muted-foreground">{getCardTypeLabel(stat.cardType)}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 検索・フィルター */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="カードを検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={selectedCardType} onValueChange={setSelectedCardType}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="カードタイプ" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">すべて</SelectItem>
              {CARD_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button
              variant={showFavorites ? "default" : "outline"}
              size="icon"
              onClick={() => setShowFavorites(!showFavorites)}
            >
              <Star className={`h-4 w-4 ${showFavorites ? "fill-current" : ""}`} />
            </Button>
            <Button
              variant={showArchived ? "default" : "outline"}
              size="icon"
              onClick={() => setShowArchived(!showArchived)}
            >
              <Archive className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* カード一覧 */}
        {isLoading || isSearching ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : displayCards?.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <CreditCard className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">カードがありません</h3>
              <p className="text-muted-foreground mt-2">
                「カードを追加」ボタンから最初のカードを登録しましょう
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayCards?.map((card) => (
              <CardItem
                key={card.id}
                card={card}
                onView={() => {
                  setSelectedCard(card.id);
                  setIsDetailOpen(true);
                }}
                onToggleFavorite={() => toggleFavoriteMutation.mutate({ id: card.id })}
                onToggleArchive={() => toggleArchiveMutation.mutate({ id: card.id })}
                onDelete={() => {
                  if (confirm("このカードを削除しますか？")) {
                    deleteMutation.mutate({ id: card.id });
                  }
                }}
              />
            ))}
          </div>
        )}

        {/* カード詳細ダイアログ */}
        {selectedCard && (
          <CardDetailDialog
            cardId={selectedCard}
            open={isDetailOpen}
            onOpenChange={(open) => {
              setIsDetailOpen(open);
              if (!open) setSelectedCard(null);
            }}
            onUpdate={() => refetch()}
          />
        )}
      </div>
    </DashboardLayout>
  );
}

// カードアイテムコンポーネント
function CardItem({
  card,
  onView,
  onToggleFavorite,
  onToggleArchive,
  onDelete,
}: {
  card: any;
  onView: () => void;
  onToggleFavorite: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}) {
  const Icon = getCardTypeIcon(card.cardType);

  return (
    <Card className="group hover:shadow-md transition-shadow cursor-pointer" onClick={onView}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <Badge variant="secondary" className="text-xs">
              {getCardTypeLabel(card.cardType)}
            </Badge>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onView(); }}>
                <Eye className="mr-2 h-4 w-4" />
                詳細を見る
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}>
                <Star className={`mr-2 h-4 w-4 ${card.isFavorite ? "fill-current text-yellow-500" : ""}`} />
                {card.isFavorite ? "お気に入り解除" : "お気に入り"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onToggleArchive(); }}>
                <Archive className="mr-2 h-4 w-4" />
                {card.isArchived ? "アーカイブ解除" : "アーカイブ"}
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                削除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        {card.frontImageUrl && (
          <div className="mb-3 rounded-lg overflow-hidden bg-muted aspect-[1.6/1]">
            <img 
              src={card.frontImageUrl} 
              alt={card.title}
              className="w-full h-full object-cover"
            />
          </div>
        )}
        <h3 className="font-semibold truncate">{card.title}</h3>
        {card.extractedData && (
          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
            {card.extractedData.company && (
              <div className="flex items-center gap-1 truncate">
                <Building2 className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{card.extractedData.company}</span>
              </div>
            )}
            {card.extractedData.email && (
              <div className="flex items-center gap-1 truncate">
                <Mail className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{card.extractedData.email}</span>
              </div>
            )}
            {card.extractedData.phone && (
              <div className="flex items-center gap-1 truncate">
                <Phone className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{card.extractedData.phone}</span>
              </div>
            )}
          </div>
        )}
        {card.tags && card.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {card.tags.slice(0, 3).map((tag: string, i: number) => (
              <Badge key={i} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>{new Date(card.createdAt).toLocaleDateString()}</span>
          <div className="flex items-center gap-2">
            {card.isFavorite && <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />}
            <span>{card.viewCount || 0} 回閲覧</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// カード追加ダイアログ
function AddCardDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  
  const [step, setStep] = useState<"upload" | "analyze" | "confirm">("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cardType, setCardType] = useState<string>("business_card");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = trpc.cards.uploadImage.useMutation();
  const analyzeMutation = trpc.cards.analyzeImage.useMutation();
  const createMutation = trpc.cards.create.useMutation();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedFile) return;

    setIsAnalyzing(true);
    try {
      // 画像をBase64に変換
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        
        // S3にアップロード
        const uploadResult = await uploadMutation.mutateAsync({
          imageData: base64,
          fileName: selectedFile.name,
          contentType: selectedFile.type,
        });

        // OCR解析
        const analysis = await analyzeMutation.mutateAsync({
          imageUrl: uploadResult.url,
          cardType: cardType,
        });

        setAnalysisResult({
          ...analysis,
          imageUrl: uploadResult.url,
          imageKey: uploadResult.key,
        });

        // タイトルを自動生成
        if (analysis.extractedData) {
          const data = analysis.extractedData;
          if (data.name && data.company) {
            setTitle(`${data.name} - ${data.company}`);
          } else if (data.name) {
            setTitle(data.name);
          } else if (data.storeName) {
            setTitle(data.storeName);
          } else if (data.organizationName) {
            setTitle(data.organizationName);
          } else if (data.hospitalName) {
            setTitle(data.hospitalName);
          }
        }

        setStep("confirm");
      };
      reader.readAsDataURL(selectedFile);
    } catch (error) {
      toast.error("解析に失敗しました", {
        description: error instanceof Error ? error.message : "不明なエラー",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCreate = async () => {
    try {
      await createMutation.mutateAsync({
        cardType: analysisResult?.cardType || cardType,
        title: title || "無題のカード",
        frontImageUrl: analysisResult?.imageUrl,
        frontImageKey: analysisResult?.imageKey,
        extractedData: analysisResult?.extractedData,
        tags: tags.length > 0 ? tags : undefined,
        notes: notes || undefined,
      });

      toast.success("カードを登録しました");
      onSuccess();
    } catch (error) {
      toast.error("登録に失敗しました", {
        description: error instanceof Error ? error.message : "不明なエラー",
      });
    }
  };

  const addTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput("");
    }
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  return (
    <DialogContent className="sm:max-w-[600px]">
      <DialogHeader>
        <DialogTitle>
          {step === "upload" && "カードを追加"}
          {step === "analyze" && "解析中..."}
          {step === "confirm" && "カード情報を確認"}
        </DialogTitle>
        <DialogDescription>
          {step === "upload" && "カードの画像をアップロードしてください"}
          {step === "analyze" && "画像を解析しています"}
          {step === "confirm" && "抽出された情報を確認・編集してください"}
        </DialogDescription>
      </DialogHeader>

      {step === "upload" && (
        <div className="space-y-4">
          <div>
            <Label>カードタイプ</Label>
            <Select value={cardType} onValueChange={setCardType}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CARD_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>画像</Label>
            <div 
              className="mt-1.5 border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              {previewUrl ? (
                <div className="space-y-4">
                  <img 
                    src={previewUrl} 
                    alt="Preview" 
                    className="max-h-48 mx-auto rounded-lg"
                  />
                  <p className="text-sm text-muted-foreground">{selectedFile?.name}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    クリックして画像を選択
                  </p>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              キャンセル
            </Button>
            <Button 
              onClick={handleAnalyze} 
              disabled={!selectedFile || isAnalyzing}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  解析中...
                </>
              ) : (
                <>
                  <ScanLine className="mr-2 h-4 w-4" />
                  解析する
                </>
              )}
            </Button>
          </DialogFooter>
        </div>
      )}

      {step === "confirm" && analysisResult && (
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {/* 画像プレビュー */}
          {analysisResult.imageUrl && (
            <div className="rounded-lg overflow-hidden bg-muted">
              <img 
                src={analysisResult.imageUrl} 
                alt="Card" 
                className="w-full max-h-48 object-contain"
              />
            </div>
          )}

          {/* 基本情報 */}
          <div className="space-y-3">
            <div>
              <Label>タイトル</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="カードのタイトル"
                className="mt-1.5"
              />
            </div>

            <div>
              <Label>カードタイプ</Label>
              <Select value={analysisResult.cardType || cardType} onValueChange={(v) => setAnalysisResult({...analysisResult, cardType: v})}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CARD_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 抽出データ */}
          {analysisResult.extractedData && Object.keys(analysisResult.extractedData).length > 0 && (
            <div>
              <Label>抽出された情報</Label>
              <div className="mt-1.5 p-3 bg-muted rounded-lg space-y-2 text-sm">
                {Object.entries(analysisResult.extractedData as Record<string, unknown>).filter(([, value]) => value != null).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <span className="text-muted-foreground">{key}</span>
                    <span className="font-medium">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* タグ */}
          <div>
            <Label>タグ</Label>
            <div className="mt-1.5 flex gap-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="タグを追加"
                onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
              />
              <Button type="button" variant="outline" onClick={addTag}>
                追加
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    {tag}
                    <X 
                      className="h-3 w-3 cursor-pointer" 
                      onClick={() => removeTag(tag)}
                    />
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* メモ */}
          <div>
            <Label>メモ</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="カードに関するメモ"
              className="mt-1.5"
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setStep("upload")}>
              <ChevronLeft className="mr-2 h-4 w-4" />
              戻る
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  登録中...
                </>
              ) : (
                "登録する"
              )}
            </Button>
          </DialogFooter>
        </div>
      )}
    </DialogContent>
  );
}

// カード詳細ダイアログ
function CardDetailDialog({
  cardId,
  open,
  onOpenChange,
  onUpdate,
}: {
  cardId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
}) {
  
  const { data: card, isLoading } = trpc.cards.get.useQuery({ id: cardId }, { enabled: open });
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const updateMutation = trpc.cards.update.useMutation({
    onSuccess: () => {
      toast.success("カードを更新しました");
      setIsEditing(false);
      onUpdate();
    },
  });

  const handleEdit = () => {
    if (card) {
      setEditTitle(card.title);
      setEditNotes(card.notes || "");
      setIsEditing(true);
    }
  };

  const handleSave = () => {
    updateMutation.mutate({
      id: cardId,
      title: editTitle,
      notes: editNotes,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : card ? (
          <>
            <DialogHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{getCardTypeLabel(card.cardType)}</Badge>
                  {card.isFavorite && <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />}
                </div>
                <Button variant="ghost" size="sm" onClick={handleEdit}>
                  <Edit className="h-4 w-4" />
                </Button>
              </div>
              {isEditing ? (
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="mt-2"
                />
              ) : (
                <DialogTitle className="text-xl">{card.title}</DialogTitle>
              )}
            </DialogHeader>

            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {/* 画像 */}
              {card.frontImageUrl && (
                <div className="rounded-lg overflow-hidden bg-muted">
                  <img 
                    src={card.frontImageUrl} 
                    alt={card.title}
                    className="w-full max-h-64 object-contain"
                  />
                </div>
              )}

              {/* 抽出データ */}
              {card.extractedData && Object.keys(card.extractedData).length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">抽出された情報</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {Object.entries(card.extractedData).map(([key, value]) => (
                      value && (
                        <div key={key} className="flex flex-col p-2 bg-muted rounded">
                          <span className="text-xs text-muted-foreground">{key}</span>
                          <span className="font-medium">{String(value)}</span>
                        </div>
                      )
                    ))}
                  </div>
                </div>
              )}

              {/* タグ */}
              {card.tags && card.tags.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">タグ</h4>
                  <div className="flex flex-wrap gap-1">
                    {card.tags.map((tag: string, i: number) => (
                      <Badge key={i} variant="outline">{tag}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* メモ */}
              <div>
                <h4 className="font-medium mb-2">メモ</h4>
                {isEditing ? (
                  <Textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={3}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {card.notes || "メモはありません"}
                  </p>
                )}
              </div>

              {/* メタ情報 */}
              <div className="text-xs text-muted-foreground space-y-1">
                <div className="flex justify-between">
                  <span>登録日</span>
                  <span>{new Date(card.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>閲覧回数</span>
                  <span>{card.viewCount || 0} 回</span>
                </div>
                {card.lastViewedAt && (
                  <div className="flex justify-between">
                    <span>最終閲覧</span>
                    <span>{new Date(card.lastViewedAt).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>

            {isEditing && (
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsEditing(false)}>
                  キャンセル
                </Button>
                <Button onClick={handleSave} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "保存"
                  )}
                </Button>
              </DialogFooter>
            )}
          </>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            カードが見つかりません
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
