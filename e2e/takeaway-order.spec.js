const { test, expect } = require('@playwright/test');
const { loginAsCashier } = require('./helpers/session');

test('cashier can create takeaway order with selected customer', async ({ page }) => {
  await loginAsCashier(page);

  await page.getByTestId('tables-new-takeaway-button').click();
  await expect(page).toHaveURL(/\/order\/takeaway/);

  const firstProductButton = page.locator('[data-testid^="product-card-"]').first();
  await expect(firstProductButton).toBeVisible();
  await firstProductButton.click();

  const saveButton = page.getByTestId('order-save-button');
  await expect(saveButton).toBeVisible();
  await saveButton.click();

  await expect(page.getByTestId('order-customer-search-input')).toBeVisible();
  const firstCustomer = page.locator('[data-testid^="customer-row-"]').first();
  await expect(firstCustomer).toBeVisible();
  await firstCustomer.click();
  await page.waitForTimeout(200);

  await saveButton.click();

  await expect(page).toHaveURL(/\/tables/);
  await expect(page.locator('[data-testid^="takeaway-order-card-"]').first()).toBeVisible();
});
