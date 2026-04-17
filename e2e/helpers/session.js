const { expect } = require('@playwright/test');

async function loginAsCashier(page) {
  await page.goto('/login');
  await page.getByTestId('login-email-input').fill('kasiyer@demo.com');
  await page.getByTestId('login-password-input').fill('123456');
  await page.getByTestId('login-submit-button').click();
  try {
    await page.waitForURL(/\/(home|tables)/, { timeout: 5_000 });
  } catch {
    const businessSelect = page.getByRole('combobox');
    await expect(businessSelect).toBeVisible({ timeout: 10_000 });
    await businessSelect.selectOption({ index: 0 });
    await page.getByTestId('login-submit-button').click();
  }

  await expect(page).toHaveURL(/\/(home|tables)/);
  await page.goto('/tables');
  await expect(page).toHaveURL(/\/tables/);
}

module.exports = { loginAsCashier };
