/**
 * npm run showcase:thumbs: renders a thumbnail of each showcase story with headless Chrome
 * (Playwright, a dev dependency) into public/showcase/<story>/thumb.jpg. Needs the dev server
 * (npm run dev) on http://localhost:3000 and the precomputed results (npm run showcase:build).
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.SHOWCASE_URL ?? 'http://localhost:3000/';
const OUT = path.resolve(process.cwd(), 'public', 'showcase');
const launch = async () => {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  } catch {
    return chromium.launch({ headless: true });
  }
};
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => {
  localStorage.removeItem('airforce_autosave_room_v1');
  localStorage.setItem('airforce_onboarding_completed_v1', 'true');
  localStorage.setItem('airforce-theme', 'dark');
});
await page.goto(BASE);
await page.locator('canvas').first().waitFor();
await page.waitForTimeout(1500);
// Collapse the asset library so the house fills the frame
await page.getByRole('button', { name: 'Collapse Library' }).click().catch(() => {});
const ids = JSON.parse(fs.readFileSync(path.join(OUT, 'stories.json'), 'utf8'));
for (const id of ids) {
  await page.getByTestId('examples-btn').click();
  await page.locator(`[data-testid="example-card"][data-story="${id}"] [data-testid="example-open"]`).click();
  await page.waitForSelector('[data-testid="story-precomputed"]', { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, id, 'thumb.jpg'), type: 'jpeg', quality: 62, clip: { x: 60, y: 120, width: 880, height: 550 } });
  console.log('thumb', id);
}
await page.getByTestId('story-exit').click();
await browser.close();
