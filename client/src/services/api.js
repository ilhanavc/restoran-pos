import { ApiHttpClient } from './api/core.js';
import { authMixin } from './api/auth.js';
import { tablesMixin } from './api/tables.js';
import { productsMixin } from './api/products.js';
import { ordersMixin } from './api/orders.js';
import { paymentsMixin } from './api/payments.js';
import { refundsMixin } from './api/refunds.js';
import { customersMixin } from './api/customers.js';
import { calleridMixin } from './api/callerid.js';
import { reportsMixin } from './api/reports.js';
import { reservationsMixin } from './api/reservations.js';
import { stockMixin } from './api/stock.js';
import { waiterCallMixin } from './api/waiterCall.js';
import { adminMixin } from './api/admin.js';

class ApiService extends ApiHttpClient {}

Object.assign(
  ApiService.prototype,
  authMixin,
  tablesMixin,
  productsMixin,
  ordersMixin,
  paymentsMixin,
  refundsMixin,
  customersMixin,
  calleridMixin,
  reportsMixin,
  reservationsMixin,
  stockMixin,
  waiterCallMixin,
  adminMixin,
);

export const api = new ApiService();
export default api;
