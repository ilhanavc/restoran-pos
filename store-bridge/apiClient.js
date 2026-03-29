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

  async function get(path) {
    const res = await fetch(`${cfg.apiBase}${path}`, { headers });
    return parseJson(res);
  }

  async function post(path, body) {
    const res = await fetch(`${cfg.apiBase}${path}`, {
      method: 'POST',
      headers,
      body: body != null ? JSON.stringify(body) : '{}',
    });
    return parseJson(res);
  }

  async function patch(path, body) {
    const res = await fetch(`${cfg.apiBase}${path}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
    return parseJson(res);
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
    updateJob: (jobId, body) => patch(`/bridge/print-jobs/${encodeURIComponent(jobId)}`, body),
    getPrinter: (printerId) => get(`/bridge/printers/${encodeURIComponent(printerId)}`),
  };
}
