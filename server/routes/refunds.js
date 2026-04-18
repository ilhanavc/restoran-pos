import { Router } from 'express';
import { z } from 'zod';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createFullRefundForOrder,
  createRefundForPayment,
  getRefundablePaymentsForOrder,
} from '../services/refundService.js';

const router = Router();
router.use(authenticate, businessScope);

const createRefundSchema = {
  body: z.object({
    payment_id: z.string().min(1, 'Ödeme kimliği gerekli'),
    amount: z.number().positive('İade tutarı sıfırdan büyük olmalıdır'),
    reason: z.string().max(500).optional().nullable(),
  }),
};

const fullOrderRefundSchema = {
  params: z.object({
    orderId: z.string().min(1),
  }),
  body: z.object({
    reason: z.string().max(500).optional().nullable(),
  }),
};

router.get('/orders/:orderId/payments', authorize('admin', 'cashier'), (req, res) => {
  try {
    res.json({ payments: getRefundablePaymentsForOrder(req.businessId, req.params.orderId) });
  } catch (err) {
    console.error('Refundable payments error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.post('/', authorize('admin', 'cashier'), validate(createRefundSchema), (req, res) => {
  try {
    const refund = createRefundForPayment(req.businessId, req.user.id, req.body);
    res.status(201).json({ refund });
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: err.message });
    if (err.isNotFound) return res.status(404).json({ error: err.message });
    if (err.isBadRequest || err.status === 400) return res.status(400).json({ error: err.message });
    console.error('Refund create error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.post('/orders/:orderId/full', authorize('admin', 'cashier'), validate(fullOrderRefundSchema), (req, res) => {
  try {
    const result = createFullRefundForOrder(
      req.businessId,
      req.user.id,
      req.params.orderId,
      req.body.reason,
    );
    res.status(201).json(result);
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: err.message });
    if (err.isNotFound) return res.status(404).json({ error: err.message });
    if (err.isBadRequest || err.status === 400) return res.status(400).json({ error: err.message });
    console.error('Order refund create error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
