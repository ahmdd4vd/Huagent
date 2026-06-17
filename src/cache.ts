// Conversation cache - in-memory LRU with TTL
// Inspired by OpenClaude's ConversationCache

interface CacheEntry<T> {
  value: T;
  expires: number;
}

export class ConversationCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private maxSize: number;
  private ttlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(options: { maxSize?: number; ttlMs?: number } = {}) {
    this.maxSize = options.maxSize || 50;
    this.ttlMs = options.ttlMs || 60 * 60 * 1000; // 1 hour
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    // LRU: re-insert to move to end
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const expires = Date.now() + (ttlMs || this.ttlMs);
    // LRU: if the key already exists, delete it first so the new
    // `set` re-inserts at the end (most-recently-used position).
    // Without this, Map preserves the original insertion order on
    // overwrite, so updating a key doesn't refresh its LRU position
    // and it gets evicted too early.
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, { value, expires });

    // LRU eviction
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
  }

  /**
   * Check if a key exists WITHOUT updating LRU order or hit/miss stats.
   * The previous implementation called `get()` which moved the key to
   * the most-recently-used position and incremented counters, skewing
   * both the eviction order and the cache stats.
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }
}
