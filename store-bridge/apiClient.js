/**
 * REST istemcisi — X-Bridge-Token ile /api/bridge/* çağrıları.
 */

async function parseJson(res) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export function createApiClient(cfg) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Bridge-Token': cfg.token,
  };

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeoutMs = Math.max(1000, Number(cfg.apiTimeoutMs) || 8000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${cfg.apiBase}${path}`, {
        ...options,
        headers: {
          ...headers,
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });
      return await parseJson(res);
    } catch (err) {
      if (err?.name === 'AbortError') {
        const timeoutErr = new Error(`API timeout (${timeoutMs}ms): ${path}`);
        timeoutErr.code = 'api_timeout';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function get(path) {
    return request(path);
  }

  async function post(path, body) {
    return request(path, {
      method: 'POST',
      body: body != null ? JSON.stringify(body) : '{}',
    });
  }

  async function patch(path, body) {
    return request(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  return {
    health: () => get('/bridge/health'),
    /**
     * Caller ID — bridgeAuth ile POST /api/bridge/caller-id/incoming
     * @param {{ phone: string, raw_payload?: unknown, source_type?: string }} body
     */
    postCallerIdIncoming: (body) => post('/bridge/caller-id/incoming', body),
    listPendingJobs: (limit = 20) =>
      get(`/bridge/print-jobs?status=pending&limit=${limit}&unclaimed_only=1`),
    claimJob: (jobId) => post(`/bridge/print-jobs/${encodeURIComponent(jobId)}/claim`, { claim_id: cfg.claimId }),
    updateJob: (jobId, body) =>
      patch(`/bridge/print-jobs/${encodeURIComponent(jobId)}`, { ...(body || {}), claim_id: cfg.claimId }),
    getPrinter: (printerId) => get(`/bridge/printers/${encodeURIComponent(printerId)}`),
    postDiscoveredPrinters: (payload) => post('/bridge/printers/discovered', payload),
    requestDiscoveryRefresh: () => post('/bridge/printers/discovered/refresh', {}),
    getDiscoveryRefreshRequest: () => get('/bridge/printers/discovered/refresh-request'),
  };
}
