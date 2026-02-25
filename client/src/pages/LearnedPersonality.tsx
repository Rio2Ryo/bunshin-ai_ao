import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { 
  Brain, 
  Heart, 
  ThumbsDown, 
  Star, 
  Sparkles, 
  MessageCircle,
  BarChart3,
  Save,
  Plus,
  X,
  RefreshCw,
  Edit3,
  Check,
  Undo2,
  AlertCircle
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";

// 学習した人格特性の型定義
interface LearnedTraits {
  likes: string[];
  dislikes: string[];
  values: string[];
  priorities: string[];
  communicationStyle: {
    formality: number;
    verbosity: number;
    emotionality: number;
    directness: number;
  };
  catchphrases: string[];
  frequentExpressions: string[];
  interests: string[];
  expertise: string[];
  decisionMakingStyle: string;
  conflictResolutionStyle: string;
  emotionalTriggers: {
    positive: string[];
    negative: string[];
  };
  lastAnalyzedAt: string;
  totalConversationsAnalyzed: number;
}

// 編集可能なタグリスト
function EditableTagList({
  title,
  icon,
  items,
  colorClass,
  onUpdate,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
  colorClass: string;
  onUpdate: (items: string[]) => void;
}) {
  const [newItem, setNewItem] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = () => {
    if (newItem.trim() && !items.includes(newItem.trim())) {
      onUpdate([...items, newItem.trim()]);
      setNewItem("");
      setIsAdding(false);
    }
  };

  const handleRemove = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    onUpdate(newItems);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-medium flex items-center gap-2">
          {icon}
          {title}
        </h4>
        {!isAdding && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsAdding(true)}
          >
            <Plus className="w-4 h-4" />
          </Button>
        )}
      </div>
      
      <div className="flex flex-wrap gap-2">
        {items.map((item, i) => (
          <Badge 
            key={i} 
            variant="secondary" 
            className={`${colorClass} group cursor-pointer hover:opacity-80`}
          >
            {item}
            <button
              onClick={() => handleRemove(i)}
              className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
        
        {isAdding && (
          <div className="flex items-center gap-1">
            <Input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="追加..."
              className="h-7 w-32 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
                if (e.key === "Escape") setIsAdding(false);
              }}
              autoFocus
            />
            <Button size="sm" variant="ghost" onClick={handleAdd}>
              <Check className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIsAdding(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}
        
        {items.length === 0 && !isAdding && (
          <span className="text-sm text-muted-foreground">
            まだ学習されていません
          </span>
        )}
      </div>
    </div>
  );
}

export default function LearnedPersonalityPage() {
  const { data: learnedTraits, refetch } = trpc.clawdbot.getLearnedTraits.useQuery();
  const { data: learningStatus } = trpc.clawdbot.getLearningStatus.useQuery();
  
  // 編集用のローカルステート
  const [editedTraits, setEditedTraits] = useState<LearnedTraits | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // 初期データをセット
  useEffect(() => {
    if (learnedTraits && !editedTraits) {
      setEditedTraits(learnedTraits as LearnedTraits);
    }
  }, [learnedTraits]);
  
  // 変更を検出
  useEffect(() => {
    if (learnedTraits && editedTraits) {
      setHasChanges(JSON.stringify(learnedTraits) !== JSON.stringify(editedTraits));
    }
  }, [learnedTraits, editedTraits]);
  
  // 配列フィールドの更新
  const updateArrayField = (field: keyof LearnedTraits, items: string[]) => {
    if (!editedTraits) return;
    setEditedTraits({
      ...editedTraits,
      [field]: items,
    });
  };
  
  // コミュニケーションスタイルの更新
  const updateCommunicationStyle = (
    field: keyof LearnedTraits["communicationStyle"],
    value: number
  ) => {
    if (!editedTraits) return;
    setEditedTraits({
      ...editedTraits,
      communicationStyle: {
        ...editedTraits.communicationStyle,
        [field]: value,
      },
    });
  };
  
  // 感情トリガーの更新
  const updateEmotionalTrigger = (
    type: "positive" | "negative",
    items: string[]
  ) => {
    if (!editedTraits) return;
    setEditedTraits({
      ...editedTraits,
      emotionalTriggers: {
        ...editedTraits.emotionalTriggers,
        positive: editedTraits.emotionalTriggers?.positive ?? [],
        negative: editedTraits.emotionalTriggers?.negative ?? [],
        [type]: items,
      },
    });
  };
  
  const updateLearnedTraitsMutation = trpc.clawdbot.updateLearnedTraits.useMutation({
    onSuccess: () => {
      toast.success("変更を保存しました");
      setHasChanges(false);
    },
    onError: () => {
      toast.error("保存に失敗しました");
    },
    onSettled: () => {
      setIsSaving(false);
    },
  });

  // 変更を保存
  const handleSave = async () => {
    if (!editedTraits) return;
    setIsSaving(true);
    updateLearnedTraitsMutation.mutate({ learnedTraits: editedTraits });
  };
  
  // 変更を破棄
  const handleReset = () => {
    if (learnedTraits) {
      setEditedTraits(learnedTraits as LearnedTraits);
      setHasChanges(false);
    }
  };
  
  if (!editedTraits) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-[60vh]">
          <Card className="max-w-md">
            <CardContent className="py-12 text-center">
              <Brain className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">学習データがありません</h3>
              <p className="text-muted-foreground mb-4">
                Clawdbotで会話をすると、自動的にあなたの人格を学習します。
                まずはClawdbot連携を設定してください。
              </p>
              <Button onClick={() => window.location.href = "/clawdbot"}>
                Clawdbot連携を設定
              </Button>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }
  
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Brain className="w-8 h-8" />
              学習した人格
            </h1>
            <p className="text-muted-foreground mt-2">
              会話から学習したあなたの特徴を確認・編集できます
            </p>
          </div>
          
          {hasChanges && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleReset}>
                <Undo2 className="w-4 h-4 mr-2" />
                変更を破棄
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                <Save className="w-4 h-4 mr-2" />
                {isSaving ? "保存中..." : "変更を保存"}
              </Button>
            </div>
          )}
        </div>
        
        {hasChanges && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>未保存の変更があります</AlertTitle>
            <AlertDescription>
              編集した内容を保存すると、分身AIの応答に反映されます。
            </AlertDescription>
          </Alert>
        )}
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 好み・価値観 */}
          <Card>
            <CardHeader>
              <CardTitle>好み・価値観</CardTitle>
              <CardDescription>
                あなたが好きなこと、苦手なこと、大切にしていること
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <EditableTagList
                title="好きなこと"
                icon={<Heart className="w-4 h-4 text-pink-500" />}
                items={editedTraits.likes}
                colorClass="bg-pink-100 dark:bg-pink-900/30"
                onUpdate={(items) => updateArrayField("likes", items)}
              />
              
              <Separator />
              
              <EditableTagList
                title="苦手なこと"
                icon={<ThumbsDown className="w-4 h-4 text-gray-500" />}
                items={editedTraits.dislikes}
                colorClass="bg-gray-100 dark:bg-gray-800"
                onUpdate={(items) => updateArrayField("dislikes", items)}
              />
              
              <Separator />
              
              <EditableTagList
                title="大切にしている価値観"
                icon={<Star className="w-4 h-4 text-yellow-500" />}
                items={editedTraits.values}
                colorClass="bg-yellow-100 dark:bg-yellow-900/30"
                onUpdate={(items) => updateArrayField("values", items)}
              />
            </CardContent>
          </Card>
          
          {/* 興味・専門 */}
          <Card>
            <CardHeader>
              <CardTitle>興味・専門分野</CardTitle>
              <CardDescription>
                あなたの関心事と得意分野
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <EditableTagList
                title="興味・関心"
                icon={<Sparkles className="w-4 h-4 text-blue-500" />}
                items={editedTraits.interests}
                colorClass="bg-blue-100 dark:bg-blue-900/30"
                onUpdate={(items) => updateArrayField("interests", items)}
              />
              
              <Separator />
              
              <EditableTagList
                title="専門分野"
                icon={<Brain className="w-4 h-4 text-purple-500" />}
                items={editedTraits.expertise}
                colorClass="bg-purple-100 dark:bg-purple-900/30"
                onUpdate={(items) => updateArrayField("expertise", items)}
              />
              
              <Separator />
              
              <EditableTagList
                title="優先事項"
                icon={<Star className="w-4 h-4 text-orange-500" />}
                items={editedTraits.priorities}
                colorClass="bg-orange-100 dark:bg-orange-900/30"
                onUpdate={(items) => updateArrayField("priorities", items)}
              />
            </CardContent>
          </Card>
          
          {/* 話し方・表現 */}
          <Card>
            <CardHeader>
              <CardTitle>話し方・表現</CardTitle>
              <CardDescription>
                口癖やよく使う表現
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <EditableTagList
                title="口癖"
                icon={<MessageCircle className="w-4 h-4 text-green-500" />}
                items={editedTraits.catchphrases}
                colorClass="border-green-500 bg-transparent"
                onUpdate={(items) => updateArrayField("catchphrases", items)}
              />
              
              <Separator />
              
              <EditableTagList
                title="よく使う表現"
                icon={<MessageCircle className="w-4 h-4 text-teal-500" />}
                items={editedTraits.frequentExpressions}
                colorClass="border-teal-500 bg-transparent"
                onUpdate={(items) => updateArrayField("frequentExpressions", items)}
              />
            </CardContent>
          </Card>
          
          {/* コミュニケーションスタイル */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                コミュニケーションスタイル
              </CardTitle>
              <CardDescription>
                スライダーを動かして調整できます
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>カジュアル</span>
                  <span className="text-muted-foreground">
                    {editedTraits.communicationStyle.formality}%
                  </span>
                  <span>フォーマル</span>
                </div>
                <Slider
                  value={[editedTraits.communicationStyle.formality]}
                  onValueChange={([value]) => updateCommunicationStyle("formality", value)}
                  max={100}
                  step={1}
                />
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>簡潔</span>
                  <span className="text-muted-foreground">
                    {editedTraits.communicationStyle.verbosity}%
                  </span>
                  <span>詳細</span>
                </div>
                <Slider
                  value={[editedTraits.communicationStyle.verbosity]}
                  onValueChange={([value]) => updateCommunicationStyle("verbosity", value)}
                  max={100}
                  step={1}
                />
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>論理的</span>
                  <span className="text-muted-foreground">
                    {editedTraits.communicationStyle.emotionality}%
                  </span>
                  <span>感情的</span>
                </div>
                <Slider
                  value={[editedTraits.communicationStyle.emotionality]}
                  onValueChange={([value]) => updateCommunicationStyle("emotionality", value)}
                  max={100}
                  step={1}
                />
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>婉曲</span>
                  <span className="text-muted-foreground">
                    {editedTraits.communicationStyle.directness}%
                  </span>
                  <span>直接的</span>
                </div>
                <Slider
                  value={[editedTraits.communicationStyle.directness]}
                  onValueChange={([value]) => updateCommunicationStyle("directness", value)}
                  max={100}
                  step={1}
                />
              </div>
            </CardContent>
          </Card>
          
          {/* 感情トリガー */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>感情トリガー</CardTitle>
              <CardDescription>
                あなたが喜ぶこと、怒ること
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <EditableTagList
                  title="喜ぶこと"
                  icon={<Heart className="w-4 h-4 text-green-500" />}
                  items={editedTraits.emotionalTriggers?.positive ?? []}
                  colorClass="bg-green-100 dark:bg-green-900/30"
                  onUpdate={(items) => updateEmotionalTrigger("positive", items)}
                />

                <EditableTagList
                  title="怒ること・悲しむこと"
                  icon={<ThumbsDown className="w-4 h-4 text-red-500" />}
                  items={editedTraits.emotionalTriggers?.negative ?? []}
                  colorClass="bg-red-100 dark:bg-red-900/30"
                  onUpdate={(items) => updateEmotionalTrigger("negative", items)}
                />
              </div>
            </CardContent>
          </Card>
          
          {/* 意思決定スタイル */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>行動スタイル</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label className="text-sm text-muted-foreground">意思決定スタイル</Label>
                  <Input
                    value={editedTraits.decisionMakingStyle}
                    onChange={(e) => setEditedTraits({
                      ...editedTraits,
                      decisionMakingStyle: e.target.value,
                    })}
                    placeholder="例: 慎重型、即断型、相談型"
                    className="mt-1"
                  />
                </div>
                
                <div>
                  <Label className="text-sm text-muted-foreground">対立解決スタイル</Label>
                  <Input
                    value={editedTraits.conflictResolutionStyle}
                    onChange={(e) => setEditedTraits({
                      ...editedTraits,
                      conflictResolutionStyle: e.target.value,
                    })}
                    placeholder="例: 回避型、対決型、妥協型"
                    className="mt-1"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* 学習情報 */}
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                最終分析: {editedTraits.lastAnalyzedAt 
                  ? new Date(editedTraits.lastAnalyzedAt).toLocaleString("ja-JP")
                  : "未分析"}
              </span>
              <span>
                累計分析回数: {editedTraits.totalConversationsAnalyzed}回
              </span>
              <span>
                総会話数: {learningStatus?.totalSnippets || 0}件
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
