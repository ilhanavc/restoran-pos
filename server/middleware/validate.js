/**
 * Zod tabanlı request validation middleware.
 * Kullanım: router.post('/path', validate(schema), handler)
 *
 * schema: { body?, query?, params? } — ZodSchema nesneleri
 */
import { ZodError } from 'zod';

export function validate(schema) {
  return (req, res, next) => {
    try {
      if (schema.body) req.body = schema.body.parse(req.body);
      if (schema.query) req.query = schema.query.parse(req.query);
      if (schema.params) req.params = schema.params.parse(req.params);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: 'Geçersiz istek verisi',
          details: err.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      next(err);
    }
  };
}
