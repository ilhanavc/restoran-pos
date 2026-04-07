import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

// DB ve config'i mock'la — better-sqlite3 Electron için derlendi, node testlerinde çalışmaz
vi.mock('../config/database.js', () => ({
  default: {
    prepare: vi.fn(),
  },
}));

vi.mock('../config/index.js', () => ({
  default: {
    jwt: { secret: 'test-secret-key' },
  },
}));

// Mock'lar tanımlandıktan sonra import et
const { authenticate, authorize, businessScope } = await import('../middleware/auth.js');
const db = (await import('../config/database.js')).default;

// Express req/res/next yardımcıları
function mockReq(headers = {}) {
  return { headers, user: undefined };
}

function mockRes() {
  const res = { _status: null, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

// ── authenticate ──────────────────────────────────────────────────────────────

describe('authenticate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('Authorization header yoksa 401 döner', () => {
    const req = mockReq({});
    const res = mockRes();
    const next = vi.fn();

    authenticate(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('Bearer prefix yoksa 401 döner', () => {
    const req = mockReq({ authorization: 'Token abc123' });
    const res = mockRes();
    const next = vi.fn();

    authenticate(req, res, next);

    expect(res._status).toBe(401);
  });

  it('Geçersiz token 401 döner', () => {
    const req = mockReq({ authorization: 'Bearer invalidtoken' });
    const res = mockRes();
    const next = vi.fn();

    authenticate(req, res, next);

    expect(res._status).toBe(401);
  });

  it('Geçerli token ama kullanıcı DB\'de yoksa 401 döner', () => {
    const token = jwt.sign({ userId: 99 }, 'test-secret-key');
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(null) });

    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = vi.fn();

    authenticate(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('Kullanıcı pasifse (is_active=0) 401 döner', () => {
    const token = jwt.sign({ userId: 1 }, 'test-secret-key');
    db.prepare.mockReturnValue({
      get: vi.fn().mockReturnValue({ id: 1, is_active: 0, permissions: '{}' }),
    });

    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = vi.fn();

    authenticate(req, res, next);

    expect(res._status).toBe(401);
  });

  it('Geçerli token ve aktif kullanıcı → req.user set edilir, next çağrılır', () => {
    const token = jwt.sign({ userId: 1 }, 'test-secret-key');
    const fakeUser = { id: 1, business_id: 'biz1', branch_id: 'br1', is_active: 1, role_slug: 'admin', permissions: '{"all":true}' };
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(fakeUser) });

    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = vi.fn();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user.id).toBe(1);
    expect(req.user.permissions).toEqual({ all: true });
  });
});

// ── authorize ────────────────────────────────────────────────────────────────

describe('authorize', () => {
  it('req.user yoksa 401 döner', () => {
    const req = { user: undefined };
    const res = mockRes();
    const next = vi.fn();

    authorize('admin')(req, res, next);

    expect(res._status).toBe(401);
  });

  it('permissions.all=true her role için geçer', () => {
    const req = { user: { role_slug: 'waiter', permissions: { all: true } } };
    const res = mockRes();
    const next = vi.fn();

    authorize('admin')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('İzin verilen rol eşleşirse geçer', () => {
    const req = { user: { role_slug: 'cashier', permissions: {} } };
    const res = mockRes();
    const next = vi.fn();

    authorize('admin', 'cashier')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('Rol eşleşmezse 403 döner', () => {
    const req = { user: { role_slug: 'waiter', permissions: {} } };
    const res = mockRes();
    const next = vi.fn();

    authorize('admin')(req, res, next);

    expect(res._status).toBe(403);
  });
});

// ── businessScope ─────────────────────────────────────────────────────────────

describe('businessScope', () => {
  it('req.businessId ve req.branchId kullanıcıdan alınır', () => {
    const req = { user: { business_id: 'biz42', branch_id: 'br7' } };
    const res = mockRes();
    const next = vi.fn();

    businessScope(req, res, next);

    expect(req.businessId).toBe('biz42');
    expect(req.branchId).toBe('br7');
    expect(next).toHaveBeenCalledOnce();
  });
});
