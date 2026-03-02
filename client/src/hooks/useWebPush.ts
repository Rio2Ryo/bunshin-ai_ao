import { useEffect, useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (char) => char.charCodeAt(0));
}

export function useWebPush() {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const { data: vapidData } = trpc.notification.getVapidPublicKey.useQuery(undefined, {
    retry: false,
  });
  const subscribeMut = trpc.notification.subscribePush.useMutation();
  const unsubscribeMut = trpc.notification.unsubscribePush.useMutation();

  useEffect(() => {
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setIsSupported(supported);
    if (supported) {
      navigator.serviceWorker.ready.then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        setIsSubscribed(!!sub);
      });
    }
  }, []);

  const subscribe = useCallback(async () => {
    if (!vapidData?.vapidPublicKey || !isSupported) return;
    setIsLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setIsLoading(false);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidData.vapidPublicKey).buffer as ArrayBuffer,
      });
      const json = sub.toJSON();
      await subscribeMut.mutateAsync({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh || "",
        auth: json.keys?.auth || "",
      });
      setIsSubscribed(true);
    } catch {
      // subscription failed
    } finally {
      setIsLoading(false);
    }
  }, [vapidData, isSupported, subscribeMut]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;
    setIsLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribeMut.mutateAsync({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setIsSubscribed(false);
    } catch {
      // unsubscribe failed
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, unsubscribeMut]);

  return { isSupported, isSubscribed, isLoading, subscribe, unsubscribe };
}
