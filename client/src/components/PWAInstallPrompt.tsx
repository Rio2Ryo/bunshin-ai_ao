import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X, Download, Smartphone } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // iOS判定
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(isIOSDevice);

    // スタンドアロンモード判定（既にインストール済み）
    const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    setIsStandalone(isInStandaloneMode);

    // 既に閉じた場合は表示しない（24時間）
    const dismissedAt = localStorage.getItem('pwa-prompt-dismissed');
    if (dismissedAt) {
      const dismissedTime = parseInt(dismissedAt, 10);
      const hoursSinceDismissed = (Date.now() - dismissedTime) / (1000 * 60 * 60);
      if (hoursSinceDismissed < 24) {
        return;
      }
    }

    // Android/Chrome用のインストールプロンプト
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // iOSの場合は手動でプロンプトを表示
    if (isIOSDevice && !isInStandaloneMode) {
      // 少し遅延させて表示
      setTimeout(() => setShowPrompt(true), 3000);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      console.log('[PWA] User accepted the install prompt');
    }
    
    setDeferredPrompt(null);
    setShowPrompt(false);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('pwa-prompt-dismissed', Date.now().toString());
  };

  // スタンドアロンモードまたは表示不要の場合は何も表示しない
  if (isStandalone || !showPrompt) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 animate-in slide-in-from-bottom-4 duration-300">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 shadow-xl max-w-md mx-auto">
        <button
          onClick={handleDismiss}
          className="absolute top-2 right-2 p-1 text-slate-400 hover:text-slate-200 transition-colors"
          aria-label="閉じる"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-12 h-12 bg-indigo-500/20 rounded-xl flex items-center justify-center">
            <Smartphone className="w-6 h-6 text-indigo-400" />
          </div>
          
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-white text-sm">
              分身AIをホーム画面に追加
            </h3>
            <p className="text-slate-400 text-xs mt-1">
              アプリのようにすぐにアクセスできます
            </p>
          </div>
        </div>

        {isIOS ? (
          <div className="mt-3 p-3 bg-slate-700/50 rounded-lg">
            <p className="text-slate-300 text-xs leading-relaxed">
              <span className="inline-flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
                </svg>
                Safariの
              </span>
              <span className="inline-flex items-center mx-1 px-1.5 py-0.5 bg-slate-600 rounded">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </span>
              をタップして「ホーム画面に追加」を選択
            </p>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <Button
              onClick={handleInstall}
              className="flex-1 bg-indigo-500 hover:bg-indigo-600 text-white"
              size="sm"
            >
              <Download className="w-4 h-4 mr-1" />
              インストール
            </Button>
            <Button
              onClick={handleDismiss}
              variant="outline"
              className="border-slate-600 text-slate-300 hover:bg-slate-700"
              size="sm"
            >
              後で
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
