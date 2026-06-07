const { expect } = require('@playwright/test');

async function loginAsCashier(page) {
  // HashRouter kullanıldığı için URL'ler /#/path formatında
  await page.goto('/#/login');
  await page.getByTestId('login-email-input').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('login-email-input').fill('kasiyer@demo.com');
  await page.getByTestId('login-password-input').fill('123456');
  await page.getByTestId('login-submit-button').click();
  try {
    // CI ortamında ilk açılış yavaş olabilir; 20s'ye kadar bekle.
    await page.waitForURL(/\/(home|tables|settings)/, { timeout: 20_000 });
  } catch {
    const businessSelect = page.getByRole('combobox');
    if (await businessSelect.isVisible().catch(() => false)) {
      await businessSelect.selectOption({ index: 0 });
      await page.getByTestId('login-submit-button').click();
    }
  }

  // Hedef: /#/tables. Readiness'a yönlenmişsek direkt /#/tables'a yönlendir.
  await page.goto('/#/tables');
  await expect(page).toHaveURL(/\/tables/, { timeout: 15_000 });
}

module.exports = { loginAsCashier };
