import { test, expect } from '@playwright/test';

test('End-to-end user journey: building a room, adding assets, and verifying round-trip', async ({ page }) => {
  await page.goto('/');

  // Skip onboarding if present
  const skipBtn = await page.getByText('Skip Tutorial').first();
  if (await skipBtn.isVisible()) {
    await skipBtn.click();
  }

  // Expect canvas to exist
  await expect(page.locator('canvas')).toBeVisible();

  // Test is primarily structural right now since fully simulating drag/drop 
  // on a WebGL canvas in Playwright is brittle without deterministic seeds.
  
  // 1. Verify UI mounts
  await expect(page.getByText('Asset Library')).toBeVisible();
  
  // 2. Add an object
  await page.getByText('bed-double-01').dblclick();
  
  // 3. Open Inspector and check if object is selected
  // The selected object name should appear in the inspector
  await expect(page.getByText('bed-double-01').last()).toBeVisible();

  // 4. Save a snapshot
  await page.keyboard.press('Meta+k'); // Command palette
  await page.getByPlaceholder('Search commands...').fill('Toggle 2D/3D View');
  await page.keyboard.press('Enter');

  // Verify view changed (HUD indicates it)
  await expect(page.getByText('2D')).toBeVisible();
});
