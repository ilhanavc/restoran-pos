import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('storebridge client-side mappings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    const storage = new Map();
    const localStorageMock = {
      getItem: vi.fn((key) => (storage.has(key) ? storage.get(key) : null)),
      setItem: vi.fn((key, value) => storage.set(key, String(value))),
      removeItem: vi.fn((key) => storage.delete(key)),
    };
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      location: { reload: vi.fn() },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps discovery states to Turkish UI metadata', async () => {
    const { getDiscoveryUiMeta } = await import('../../../client/src/components/settings/printerDiscoveryStatus.js');

    expect(getDiscoveryUiMeta({ scanState: 'success', printers: [{ name: 'USB-1' }] })).toEqual(
      expect.objectContaining({
        state: 'success',
        tone: 'success',
        text: 'Yazıcı taraması tamamlandı.',
      }),
    );

    expect(getDiscoveryUiMeta({
      scanState: 'bridge_unreachable',
      lastErrorCode: 'bridge_unreachable',
      hasSelectedPhysical: true,
    })).toEqual(
      expect.objectContaining({
        state: 'bridge_unreachable',
        tone: 'danger',
      }),
    );

    expect(getDiscoveryUiMeta({
      scanState: 'bridge_unreachable',
      lastErrorCode: 'bridge_not_configured',
    })).toEqual(
      expect.objectContaining({
        state: 'bridge_unconfigured',
        tone: 'warning',
      }),
    );
  });

  it('maps admin storebridge health responses to sidebar bridge status', async () => {
    const { default: api } = await import('../../../client/src/services/api.js');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'degraded' }),
      })),
    );
    expect(await api.getBridgeStatus()).toBe('degraded');

    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 'unconfigured' }),
    });
    expect(await api.getBridgeStatus()).toBe('unconfigured');

    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 'ok' }),
    });
    expect(await api.getBridgeStatus()).toBe('ok');
  });
});
