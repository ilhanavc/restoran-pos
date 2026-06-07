const { test, expect } = require('@playwright/test');
const { loginAsCashier } = require('./helpers/session');

test('cashier can create table order and close with payment', async ({ page }) => {
  await loginAsCashier(page);

  const firstEmptyTable = page.locator('[data-table-status="empty"]').first();
  await expect(firstEmptyTable).toBeVisible();
  await firstEmptyTable.click();

  await expect(page).toHaveURL(/\/order\/table\//);

  const firstProductButton = page.locator('[data-testid^="product-card-"]').first();
  await expect(firstProductButton).toBeVisible();
  await firstProductButton.click();

  const saveButton = page.getByTestId('order-save-button');
  await expect(saveButton).toBeVisible();
  await saveButton.click();

  await expect(page).toHaveURL(/\/tables/);

  const occupiedTable = page.locator('[data-table-status="occupied"]').first();
  await expect(occupiedTable).toBeVisible();
  await occupiedTable.click();

  await expect(page).toHaveURL(/\/order\/table\//);

  const paymentButton = page.getByTestId('order-payment-button');
  await expect(paymentButton).toBeVisible();
  await paymentButton.click();

  const payCloseAction = page.getByTestId('payment-action-pay-close');
  await expect(payCloseAction).toBeVisible();
  await payCloseAction.click();

  const submitPaymentButton = page.getByTestId('payment-submit-button');
  await expect(submitPaymentButton).toBeVisible();
  await submitPaymentButton.click();

  await expect(page.getByText('İşlem Tamamlandı')).toBeVisible();
});
