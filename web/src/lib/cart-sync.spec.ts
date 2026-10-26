import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CartSyncManager, CartSyncAction } from './cart-sync';

describe('CartSyncManager (Cross-Tab Synchronization — TASK-11)', () => {
  let tabA: CartSyncManager;
  let tabB: CartSyncManager;

  beforeEach(() => {
    tabA = new CartSyncManager({ channelName: 'test_cart_channel', tabId: 'tab-A' });
    tabB = new CartSyncManager({ channelName: 'test_cart_channel', tabId: 'tab-B' });
  });

  afterEach(() => {
    tabA.destroy();
    tabB.destroy();
    vi.restoreAllMocks();
  });

  it('assigns unique tab identifiers to each instance', () => {
    expect(tabA.getTabId()).toBe('tab-A');
    expect(tabB.getTabId()).toBe('tab-B');
    expect(tabA.getTabId()).not.toBe(tabB.getTabId());
  });

  it('broadcasts CART_UPDATED action from Tab A to Tab B via handleIncomingAction / BroadcastChannel', async () => {
    const receivedActionsB: CartSyncAction[] = [];
    const receivedActionsA: CartSyncAction[] = [];

    tabA.subscribe((action) => receivedActionsA.push(action));
    tabB.subscribe((action) => receivedActionsB.push(action));

    // Simulate Tab A broadcasting an update
    const actionPayload = {
      type: 'CART_UPDATED' as const,
      timestamp: Date.now(),
      sourceTabId: tabA.getTabId(),
    };

    // Tab B receives message from Tab A
    tabB.handleIncomingAction(actionPayload);

    expect(receivedActionsB).toHaveLength(1);
    expect(receivedActionsB[0]).toMatchObject({
      type: 'CART_UPDATED',
      sourceTabId: 'tab-A',
    });

    // Tab A should not receive its own message
    tabA.handleIncomingAction(actionPayload);
    expect(receivedActionsA).toHaveLength(0);
  });

  it('ignores messages originating from the same tab (sourceTabId matching)', () => {
    const receivedActions: CartSyncAction[] = [];
    tabA.subscribe((action) => receivedActions.push(action));

    tabA.handleIncomingAction({
      type: 'CART_UPDATED',
      timestamp: Date.now(),
      sourceTabId: 'tab-A',
    });

    expect(receivedActions).toHaveLength(0);
  });

  it('deduplicates actions received with the same or older timestamp', () => {
    const receivedActions: CartSyncAction[] = [];
    tabB.subscribe((action) => receivedActions.push(action));

    const timestamp = Date.now();
    const action: CartSyncAction = {
      type: 'CART_UPDATED',
      timestamp,
      sourceTabId: 'tab-A',
    };

    // First arrival (e.g. from BroadcastChannel)
    tabB.handleIncomingAction(action);
    // Second arrival of same event (e.g. from storage event fallback)
    tabB.handleIncomingAction(action);

    expect(receivedActions).toHaveLength(1);
  });

  it('broadcasts CART_CLEARED action across tabs after checkout or clearCart', () => {
    const receivedActions: CartSyncAction[] = [];
    tabB.subscribe((action) => receivedActions.push(action));

    tabB.handleIncomingAction({
      type: 'CART_CLEARED',
      timestamp: Date.now(),
      sourceTabId: 'tab-A',
    });

    expect(receivedActions).toHaveLength(1);
    expect(receivedActions[0].type).toBe('CART_CLEARED');
  });

  it('broadcasts AUTH_CHANGED on user logout to enforce cross-tab account isolation', () => {
    const receivedActions: CartSyncAction[] = [];
    tabB.subscribe((action) => receivedActions.push(action));

    tabB.handleIncomingAction({
      type: 'AUTH_CHANGED',
      status: 'logged_out',
      timestamp: Date.now(),
      sourceTabId: 'tab-A',
    });

    expect(receivedActions).toHaveLength(1);
    expect(receivedActions[0]).toMatchObject({
      type: 'AUTH_CHANGED',
      status: 'logged_out',
    });
  });

  it('broadcasts AUTH_CHANGED on login to trigger cart reconciliation in existing tabs', () => {
    const receivedActions: CartSyncAction[] = [];
    tabB.subscribe((action) => receivedActions.push(action));

    tabB.handleIncomingAction({
      type: 'AUTH_CHANGED',
      status: 'logged_in',
      userId: 'user-new-123',
      timestamp: Date.now(),
      sourceTabId: 'tab-A',
    });

    expect(receivedActions).toHaveLength(1);
    expect(receivedActions[0]).toMatchObject({
      type: 'AUTH_CHANGED',
      status: 'logged_in',
      userId: 'user-new-123',
    });
  });

  it('unsubscribes listeners cleanly and halts message processing', () => {
    const receivedActions: CartSyncAction[] = [];
    const unsubscribe = tabB.subscribe((action) => receivedActions.push(action));

    tabB.handleIncomingAction({
      type: 'CART_UPDATED',
      timestamp: 1000,
      sourceTabId: 'tab-A',
    });
    expect(receivedActions).toHaveLength(1);

    // Unsubscribe Tab B
    unsubscribe();

    tabB.handleIncomingAction({
      type: 'CART_UPDATED',
      timestamp: 2000,
      sourceTabId: 'tab-A',
    });
    expect(receivedActions).toHaveLength(1); // Still 1, no new message received
  });

  it('safely handles malformed actions without throwing or crashing', () => {
    const receivedActions: CartSyncAction[] = [];
    tabB.subscribe((action) => receivedActions.push(action));

    // Null or invalid object
    tabB.handleIncomingAction(null as unknown as CartSyncAction);
    tabB.handleIncomingAction(undefined as unknown as CartSyncAction);
    tabB.handleIncomingAction('invalid-string' as unknown as CartSyncAction);

    expect(receivedActions).toHaveLength(0);
  });

  it('broadcasts via native BroadcastChannel without error', () => {
    // Should not throw in environments with BroadcastChannel
    expect(() => {
      tabA.broadcast({ type: 'CART_UPDATED' });
    }).not.toThrow();
  });
});
