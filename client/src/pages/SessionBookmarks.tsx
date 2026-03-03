import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Bookmark, Loader2, ArrowLeft, Trash2, Star, Folder } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function SessionBookmarks() {
  usePageMeta({ title: "ブックマーク", description: "お気に入りマッチングセッション", path: "/bookmarks" });

  const [selectedCategory, setSelectedCategory] = useState<string | undefined>();

  const { data: bookmarks, isLoading, refetch } = trpc.matching.listBookmarks.useQuery(
    selectedCategory ? { category: selectedCategory } : undefined
  );
  const { data: categories } = trpc.matching.getBookmarkCategories.useQuery();
  const unbookmarkMut = trpc.matching.unbookmarkSession.useMutation();

  const handleUnbookmark = async (sessionId: number) => {
    try {
      await unbookmarkMut.mutateAsync({ sessionId });
      toast.success("ブックマークを解除しました");
      refetch();
    } catch (e: any) {
      toast.error(e.message || "解除に失敗しました");
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/matching">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bookmark className="h-6 w-6 text-primary" />
              ブックマーク
            </h1>
            <p className="text-muted-foreground">お気に入りマッチングセッション</p>
          </div>
        </div>

        {/* Category Filters */}
        {categories && categories.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant={!selectedCategory ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(undefined)}
            >
              すべて
            </Button>
            {categories.map((cat: any) => (
              <Button
                key={cat.category}
                variant={selectedCategory === cat.category ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory(cat.category)}
              >
                <Folder className="h-3 w-3 mr-1" />
                {cat.category} ({cat.count})
              </Button>
            ))}
          </div>
        )}

        {/* Bookmarks List */}
        <Card>
          <CardHeader>
            <CardTitle>保存済みセッション</CardTitle>
            <CardDescription>{bookmarks?.length ?? 0}件のブックマーク</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : !bookmarks?.length ? (
              <div className="text-center py-12 text-muted-foreground">
                <Bookmark className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>ブックマークがまだありません</p>
                <p className="text-sm mt-1">マッチングセッションから ☆ ボタンでブックマークできます</p>
              </div>
            ) : (
              <div className="space-y-3">
                {bookmarks.map((bm: any) => (
                  <div key={bm.id} className="flex items-center gap-4 rounded-lg border p-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Link href={`/matching/${bm.sessionId}`}>
                          <span className="font-medium text-sm text-primary hover:underline cursor-pointer">
                            #{bm.sessionId} {bm.theme}
                          </span>
                        </Link>
                        <Badge variant="outline" className="text-xs">{bm.category}</Badge>
                        {bm.status === "completed" && (
                          <Badge className="text-xs bg-green-500/10 text-green-600 border-green-500/30">完了</Badge>
                        )}
                      </div>
                      {bm.compatibilityScore && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Star className="h-3 w-3 text-yellow-500" />
                          <span>相性: {parseFloat(bm.compatibilityScore)}%</span>
                        </div>
                      )}
                      {bm.note && (
                        <p className="text-xs text-muted-foreground mt-1">{bm.note}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        保存: {new Date(bm.createdAt).toLocaleDateString("ja-JP")}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleUnbookmark(bm.sessionId)}
                      disabled={unbookmarkMut.isPending}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
