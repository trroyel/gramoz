/**
 * Multi-Tab Cart Synchronization Manager for Gramoz.
 *
 * Implements cross-tab synchronization using native BroadcastChannel with
 * window.localStorage storage-event fallback for environments lacking BroadcastChannel.
 *
 * Ensures tabs coordinate cart updates, clears, and authentication transitions
 * without trusting copied cart state from another tab: tabs always fetch authoritative
 * state directly from PostgreSQL.
 */

export type CartSyncPayload =
  | { type: 'CART_UPDATED' }
  | { type: 'CART_CLEARED' }
  | {
      type: 'AUTH_CHANGED';
      status: 'logged_in' | 'logged_out';
      userId?: string | null;
    };

export type CartSyncAction = CartSyncPayload & {
  timestamp: number;
  sourceTabId: string;
};

export type CartSyncCallback = (action: CartSyncAction) => void;

export class CartSyncManager {
  private readonly channelName: string;
  private readonly storageKey: string;
  private tabId: string;
  private channel: BroadcastChannel | null = null;
  private listeners: Set<CartSyncCallback> = new Set();
  private lastProcessedTimestamp = 0;

  constructor(options?: { channelName?: string; storageKey?: string; tabId?: string }) {
    this.channelName = options?.channelName ?? 'gramoz_cart_sync_channel';
    this.storageKey = options?.storageKey ?? 'gramoz_cart_sync_event';
    this.tabId = options?.tabId ?? this.generateTabId();
  }

  public getTabId(): string {
    return this.tabId;
  }

  public setTabId(newTabId: string): void {
    this.tabId = newTabId;
  }

  private generateTabId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'tab_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
  }

  private initChannel(): void {
    if (this.channel) return;

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(this.channelName);
        this.channel.onmessage = (event: MessageEvent<CartSyncAction>) => {
          this.handleIncomingAction(event.data);
        };
      } catch (e) {
        console.warn('BroadcastChannel initialization failed, using storage fallback', e);
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', this.handleStorageEvent);
    }
  }

  private handleStorageEvent = (event: StorageEvent): void => {
    if (event.key !== this.storageKey || !event.newValue) return;
    try {
      const action = JSON.parse(event.newValue) as CartSyncAction;
      this.handleIncomingAction(action);
    } catch {
      // Ignore malformed JSON
    }
  };

  public handleIncomingAction(action: CartSyncAction): void {
    if (!action || typeof action !== 'object') return;

    // Discard messages originating from this exact tab
    if (action.sourceTabId === this.tabId) return;

    // Discard duplicates if received via both BroadcastChannel and storage event
    if (action.timestamp && action.timestamp <= this.lastProcessedTimestamp) {
      return;
    }
    this.lastProcessedTimestamp = action.timestamp;

    for (const listener of this.listeners) {
      try {
        listener(action);
      } catch (err) {
        console.error('Error in cart sync listener', err);
      }
    }
  }

  public subscribe(callback: CartSyncCallback): () => void {
    this.initChannel();
    this.listeners.add(callback);

    return () => {
      this.listeners.delete(callback);
      if (this.listeners.size === 0) {
        this.destroy();
      }
    };
  }

  public broadcast(action: CartSyncPayload): void {
    const fullAction: CartSyncAction = {
      ...action,
      timestamp: Date.now(),
      sourceTabId: this.tabId,
    };

    // 1. Post via BroadcastChannel if available
    if (typeof BroadcastChannel !== 'undefined') {
      if (!this.channel) {
        try {
          this.channel = new BroadcastChannel(this.channelName);
        } catch {
          // Fall back to storage
        }
      }
      try {
        this.channel?.postMessage(fullAction);
      } catch (err) {
        console.warn('Failed to postMessage on BroadcastChannel', err);
      }
    }

    // 2. Fallback / supplementary notification via localStorage
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      try {
        window.localStorage.setItem(this.storageKey, JSON.stringify(fullAction));
      } catch {
        // Quota exceeded or storage disabled
      }
    }
  }

  public destroy(): void {
    if (this.channel) {
      try {
        this.channel.close();
      } catch {}
      this.channel = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', this.handleStorageEvent);
    }
    this.listeners.clear();
  }
}

export const cartSync = new CartSyncManager();
