import { ZodError } from 'zod';

/**
 * Zod şemasına göre req.body / req.query / req.params doğrular.
 * Hata varsa 400 döner; başarılıysa parse edilmiş değerleri req üzerine yazar.
 *
 * @param {{ body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny }} schema
 */
export function validate(schema) {
  return (req, res, next) => {
    try {
      if (schema.body)   req.body   = schema.body.parse(req.body);
      if (schema.query)  req.query  = schema.query.parse(req.query);
      if (schema.params) req.params = schema.params.parse(req.params);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: 'Geçersiz istek verisi',
          details: err.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
        });
      }
      next(err);
    }
  };
}
