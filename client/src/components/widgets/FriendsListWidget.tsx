import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { UserPlus, Users } from "lucide-react";
import { Link } from "wouter";

export function FriendsListWidget() {
  const { data: friends } = trpc.friends.list.useQuery(undefined, { staleTime: 30_000 });
  const friendsList = (friends ?? []).slice(0, 8);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            友達 ({friends?.length || 0})
          </CardTitle>
          <Link href="/friends">
            <Button variant="ghost" size="sm" className="text-xs">管理</Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {friendsList.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-2">まだ友達がいません</p>
            <Link href="/friends">
              <Button size="sm" variant="outline" className="gap-1">
                <UserPlus className="h-3 w-3" />
                友達を追加
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-1.5">
            {friendsList.map((friend: any) => (
              <div key={friend.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors">
                <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium text-primary">
                  {(friend.friendName || friend.name || "?").charAt(0)}
                </div>
                <span className="text-sm truncate">{friend.friendName || friend.name}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
