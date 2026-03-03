import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Bookmark, ArrowRight } from "lucide-react";
import { Link } from "wouter";

export function BookmarksWidget() {
  const { data } = trpc.matching.getDashboardBookmarks.useQuery(undefined, { staleTime: 60_000 });

  const items = data || [];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-orange-500" />
            <span className="text-sm font-medium">ブックマーク</span>
          </div>
          <Link href="/bookmarks">
            <span className="text-xs text-primary hover:underline">すべて</span>
          </Link>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">ブックマークがありません</p>
        ) : (
          <div className="space-y-2">
            {items.map((item: any) => (
              <Link key={item.sessionId} href={`/matching/${item.sessionId}`}>
                <div className="flex items-center justify-between hover:bg-muted/50 rounded p-1 -mx-1 cursor-pointer">
                  <span className="text-xs truncate max-w-[55%]">{item.theme}</span>
                  <div className="flex items-center gap-2">
                    {item.category && item.category !== 'default' && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0">{item.category}</Badge>
                    )}
                    {item.compatibilityScore != null && (
                      <span className="text-xs font-medium">{item.compatibilityScore}点</span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
