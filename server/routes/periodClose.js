import { Router } from 'express';
import { z } from 'zod';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  buildPeriodReport,
  closePeriod,
  getPeriodStatus,
} from '../services/periodCloseService.js';

const router = Router();
router.use(authenticate, businessScope);

const dateQuerySchema = {
  query: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Geçerli tarih gerekli').optional(),
  }),
};

const zCloseSchema = {
  body: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Geçerli tarih gerekli'),
    note: z.string().max(500).optional().nullable(),
  }),
};

router.get('/status', authorize('admin', 'cashier'), validate(dateQuerySchema), (req, res) => {
  try {
    const status = getPeriodStatus(req.businessId, req.query.date);
    const report = buildPeriodReport(req.businessId, status.date);
    res.json({
      ...status,
      open_orders: report.open_orders,
      summary: report.summary,
    });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('Period close status error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.get('/x-report', authorize('admin', 'cashier'), validate(dateQuerySchema), (req, res) => {
  try {
    res.json(buildPeriodReport(req.businessId, req.query.date));
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('X report error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.post('/z-close', authorize('admin', 'cashier'), validate(zCloseSchema), (req, res) => {
  try {
    const result = closePeriod(
      req.businessId,
      req.branchId || null,
      req.user.id,
      req.body.date,
      req.body.note,
    );
    res.status(201).json(result);
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: err.message });
    if (err.status === 400) return res.status(400).json({ error: err.message, open_orders: err.openOrders || [] });
    console.error('Z close error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
