function parsePrintOptions(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export const AUTO_PRINT_EVENTS = Object.freeze({
  KITCHEN_TABLE_ORDER_CREATE: 'kitchen_table_order_create',
  KITCHEN_TAKEAWAY_ORDER_CREATE: 'kitchen_takeaway_order_create',
  KITCHEN_ORDER_ADJUSTMENT: 'kitchen_order_adjustment',
  RECEIPT_PAYMENT_COMPLETE: 'receipt_payment_complete',
  RECEIPT_TABLE_CLOSE: 'receipt_table_close',
  RECEIPT_TAKEAWAY_COMPLETE: 'receipt_takeaway_complete',
});

const EVENT_TO_KEY = Object.freeze({
  [AUTO_PRINT_EVENTS.KITCHEN_TABLE_ORDER_CREATE]: 'onTableOrderCreate',
  [AUTO_PRINT_EVENTS.KITCHEN_TAKEAWAY_ORDER_CREATE]: 'onTakeawayOrderCreate',
  [AUTO_PRINT_EVENTS.KITCHEN_ORDER_ADJUSTMENT]: 'onOrderAdjustment',
  [AUTO_PRINT_EVENTS.RECEIPT_PAYMENT_COMPLETE]: 'onPaymentComplete',
  [AUTO_PRINT_EVENTS.RECEIPT_TABLE_CLOSE]: 'onTableClose',
  [AUTO_PRINT_EVENTS.RECEIPT_TAKEAWAY_COMPLETE]: 'onTakeawayComplete',
});

const ROLE_GUARDS = Object.freeze({
  [AUTO_PRINT_EVENTS.KITCHEN_TABLE_ORDER_CREATE]: 'kitchen',
  [AUTO_PRINT_EVENTS.KITCHEN_TAKEAWAY_ORDER_CREATE]: 'kitchen',
  [AUTO_PRINT_EVENTS.KITCHEN_ORDER_ADJUSTMENT]: 'kitchen',
  [AUTO_PRINT_EVENTS.RECEIPT_PAYMENT_COMPLETE]: 'receipt',
  [AUTO_PRINT_EVENTS.RECEIPT_TABLE_CLOSE]: 'receipt',
  [AUTO_PRINT_EVENTS.RECEIPT_TAKEAWAY_COMPLETE]: 'receipt',
});

export function isAutoPrintEnabledForPrinter(printer, eventType) {
  if (!eventType) return true;
  if (!printer || !printer.is_active) return false;
  const expectedRole = ROLE_GUARDS[eventType];
  if (expectedRole && printer.type !== expectedRole) return false;
  const po = parsePrintOptions(printer.print_options);
  const autoPrint = po?.autoPrint || {};
  const key = EVENT_TO_KEY[eventType];
  if (!key) return true;
  return autoPrint[key] === true;
}
