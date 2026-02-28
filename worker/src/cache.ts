/**
 * Stale-while-revalidate cache using Cloudflare Workers Cache API.
 *
 * Data is stored in the CF edge cache with an extended TTL (3× freshness window).
 *   - age ≤ ttl           → fresh, returned immediately
 *   - ttl < age ≤ ttl × 3 → stale, returned immediately; entry is evicted so the
 *                            next request triggers a fresh fetch (background revalidation
 *                            without waitUntil)
 *   - age > ttl × 3       → CF Cache evicts automatically → cache miss → fresh fetch
 */

const CACHE_ORIGIN = "https://cache.bunshin-ai.internal/";

// CF Workers exposes getDefaultCache() which is not in the DOM CacheStorage type
function getDefaultCache(): Cache {
  return (caches as unknown as { default: Cache }).default;
}

interface CacheWrapper<T> {
  data: T;
  ts: number; // Date.now() at storage time
}

/**
 * Execute `queryFn` with edge caching.
 *
 * @param key         Unique cache key (e.g. "discover:search:42")
 * @param ttlSeconds  Freshness window in seconds
 * @param queryFn     Async function that produces the data on cache miss
 * @returns           Cached or freshly-fetched data of type T
 */
export async function cachedQuery<T>(
  key: string,
  ttlSeconds: number,
  queryFn: () => Promise<T>,
): Promise<T> {
  // Graceful fallback when Cache API is unavailable (e.g. vitest)
  if (typeof caches === "undefined") {
    return queryFn();
  }

  const cache = getDefaultCache();
  const cacheKey = new Request(`${CACHE_ORIGIN}${encodeURIComponent(key)}`);

  try {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const wrapper = (await cached.json()) as CacheWrapper<T>;
      const ageSeconds = (Date.now() - wrapper.ts) / 1000;

      if (ageSeconds <= ttlSeconds) {
        // Fresh → return immediately
        return wrapper.data;
      }

      // Stale → return data, evict entry so next request refreshes
      cache.delete(cacheKey).catch(() => {});
      return wrapper.data;
    }
  } catch {
    // Cache read failed → fall through to fresh fetch
  }

  // Cache miss → execute query and store
  const result = await queryFn();

  try {
    const body = JSON.stringify({ data: result, ts: Date.now() } satisfies CacheWrapper<T>);
    const response = new Response(body, {
      headers: {
        "Content-Type": "application/json",
        // Store for 3× ttl so stale reads are possible within the window
        "Cache-Control": `s-maxage=${ttlSeconds * 3}`,
      },
    });
    // Fire-and-forget; don't block the response
    cache.put(cacheKey, response).catch(() => {});
  } catch {
    // Cache write failed → non-critical
  }

  return result;
}

/**
 * Invalidate a cached entry by key.
 * Call this after mutations that affect cached data.
 */
export async function invalidateCache(key: string): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = getDefaultCache();
    const cacheKey = new Request(`${CACHE_ORIGIN}${encodeURIComponent(key)}`);
    await cache.delete(cacheKey);
  } catch {
    // Non-critical
  }
}
