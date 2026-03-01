// Service Worker for 分身AI PWA
const CACHE_NAME = 'bunshin-ai-v5';
const API_CACHE_NAME = 'bunshin-ai-api-v2';
const API_CACHE_MAX_ENTRIES = 100;
const API_CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

// キャッシュする静的アセット（SPAシェル含む）
const STATIC_ASSETS = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/apple-touch-icon.png'
];

// インストール時にキャッシュを作成
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Some static assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// アクティベート時に古いキャッシュを削除 + Navigation Preload有効化
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // 古いキャッシュ削除
      caches.keys().then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME && name !== API_CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      ),
      // Navigation Preload 有効化（対応ブラウザのみ）
      self.registration.navigationPreload?.enable().catch(() => {}),
    ])
  );
  self.clients.claim();
});

// フェッチ時のキャッシュ戦略
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Chrome拡張等の非HTTP(S)リクエストは無視
  if (!url.protocol.startsWith('http')) return;

  // tRPC APIクエリ（GET）: stale-while-revalidate + APIキャッシュ
  if (url.pathname.startsWith('/api/trpc') && request.method === 'GET') {
    event.respondWith(apiStaleWhileRevalidate(request));
    return;
  }

  // その他のAPI呼び出し: ネットワーク優先（5秒タイムアウトでキャッシュフォールバック）
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithTimeout(request, 5000));
    return;
  }

  // 静的アセット（JS/CSS/画像/フォント）: stale-while-revalidate
  if (request.destination === 'image' ||
      request.destination === 'style' ||
      request.destination === 'script' ||
      request.destination === 'font') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // ナビゲーション: ネットワーク優先、オフライン時はSPAシェル→オフラインページ
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(event));
    return;
  }

  // その他: ネットワーク優先
  event.respondWith(networkFirst(request));
});

// クライアントからのメッセージハンドラ
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ONLINE_STATUS_CHANGED' && event.data.isOnline) {
    // オンライン復帰をすべてのクライアントに通知
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      clients.forEach((client) => {
        client.postMessage({ type: 'FLUSH_MESSAGE_QUEUE' });
      });
    });
  }
});

// ナビゲーション処理（Navigation Preload対応）
// オフライン時: まずキャッシュされたSPAシェル（/）を返す → SPAルーターが正しいページを描画
async function handleNavigate(event) {
  try {
    const preloadResponse = await event.preloadResponse;
    if (preloadResponse) return preloadResponse;
    return await fetch(event.request);
  } catch {
    // オフライン: まず元URLのキャッシュを試す
    const cached = await caches.match(event.request);
    if (cached) return cached;

    // SPAシェル（/）を返す — React Router がクライアント側でルーティング
    const shell = await caches.match('/');
    if (shell) return shell;

    // 最終フォールバック: offline.html
    const offlinePage = await caches.match('/offline.html');
    return offlinePage || new Response('Offline', { status: 503 });
  }
}

// tRPC API専用: stale-while-revalidate + 専用APIキャッシュ
// キャッシュがあれば即返却、バックグラウンドでネットワークから更新
async function apiStaleWhileRevalidate(request) {
  const cache = await caches.open(API_CACHE_NAME);
  const cachedResponse = await cache.match(request);

  const fetchPromise = fetch(request).then(async (networkResponse) => {
    if (networkResponse.ok) {
      // タイムスタンプヘッダーを追加してキャッシュ
      const headers = new Headers(networkResponse.headers);
      headers.set('sw-cached-at', String(Date.now()));
      const body = await networkResponse.clone().arrayBuffer();
      const timestampedResponse = new Response(body, {
        status: networkResponse.status,
        statusText: networkResponse.statusText,
        headers,
      });
      cache.put(request, timestampedResponse);
      trimCache(API_CACHE_NAME, API_CACHE_MAX_ENTRIES);
    }
    return networkResponse;
  }).catch(() => null);

  // キャッシュがあれば即返却、なければネットワーク待ち
  if (cachedResponse) {
    // バックグラウンドで更新（結果は使わない）
    fetchPromise;
    return cachedResponse;
  }

  // キャッシュなし：ネットワークからの結果を待つ
  const networkResponse = await fetchPromise;
  if (networkResponse) return networkResponse;

  return new Response(JSON.stringify({ error: 'Offline' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Stale-while-revalidate: キャッシュから即返却＋バックグラウンドで更新
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  const fetchPromise = fetch(request).then((networkResponse) => {
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => null);

  return cachedResponse || await fetchPromise || new Response('', { status: 503 });
}

// ネットワーク優先（タイムアウト付き）
async function networkFirstWithTimeout(request, timeoutMs) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ネットワーク優先
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('', { status: 503 });
  }
}

// キャッシュエントリ数を制限（LRU的に古いものから削除）
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    // 古い順に削除
    const toDelete = keys.slice(0, keys.length - maxEntries);
    await Promise.all(toDelete.map((key) => cache.delete(key)));
  }
}

// プッシュ通知の受信
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body || '新しい通知があります',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      vibrate: [100, 50, 100],
      data: { url: data.url || '/' },
      actions: data.actions || [],
    };

    event.waitUntil(
      self.registration.showNotification(data.title || '分身AI', options)
    );
  } catch {
    // malformed push data
  }
});

// 通知クリック時の処理
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
