import { useEffect, useRef, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";

type Status = "online" | "offline" | "reconnected";

export function OfflineIndicator() {
  const [status, setStatus] = useState<Status>(navigator.onLine ? "online" : "offline");
  const wasOffline = useRef(false);

  useEffect(() => {
    const goOffline = () => {
      wasOffline.current = true;
      setStatus("offline");
    };
    const goOnline = () => {
      if (wasOffline.current) {
        setStatus("reconnected");
        // 3秒後に非表示
        setTimeout(() => setStatus("online"), 3000);
        wasOffline.current = false;
      }
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (status === "online") return null;

  const isOffline = status === "offline";

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[100] text-white text-center py-2 text-sm flex items-center justify-center gap-2 shadow-lg transition-all duration-300 ${
        isOffline ? "bg-amber-600" : "bg-emerald-600"
      }`}
      role="alert"
      aria-live="polite"
    >
      {isOffline ? (
        <>
          <WifiOff className="h-4 w-4" />
          <span>オフラインです — キャッシュデータを表示中</span>
        </>
      ) : (
        <>
          <Wifi className="h-4 w-4" />
          <span>オンラインに復帰しました</span>
        </>
      )}
    </div>
  );
}
