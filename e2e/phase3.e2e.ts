import { expect, test, type Page } from '@playwright/test';

const openApp = async (page: Page, reduceRenderingLoad = false) => {
  await page.addInitScript(() => {
    localStorage.removeItem('airforce_autosave_room_v1');
    localStorage.setItem('airforce_onboarding_completed_v1', 'true');
    if (sessionStorage.getItem('airforce-phase3-theme-initialized') !== '1') {
      localStorage.setItem('airforce-theme', 'dark');
      localStorage.setItem(
        'airforce-saved-views',
        JSON.stringify([
          {
            id: 'phase3-persisted-view',
            name: 'Persisted Phase 3 View',
            position: [5, 4, 5],
            target: [0, 1, 0],
            fov: 45,
            projection: 'perspective',
            createdAt: 1,
          },
        ])
      );
      sessionStorage.setItem('airforce-phase3-theme-initialized', '1');
    }
  });
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible();
  if (reduceRenderingLoad) {
    await page.evaluate(async () => {
      const { useGraphicsStore } = await import('/src/store/graphicsStore.ts');
      useGraphicsStore.getState().setQuality('Low');
    });
  }
  await page.waitForTimeout(1500);
};

test('panels are keyboard-operable, keep the canvas fixed, and preserve both themes', async ({
  page,
}) => {
  test.setTimeout(60000);
  await openApp(page, true);
  const canvas = page.locator('canvas').first();
  const initialBounds = await canvas.boundingBox();

  await page.evaluate(() => {
    (window as Window & { phase3Canvas?: HTMLCanvasElement | null }).phase3Canvas =
      document.querySelector('canvas');
  });

  await page.getByRole('button', { name: 'Collapse Library' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Expand Library' })).toBeVisible();
  await expect(page.getByTestId('asset-library-sidebar')).toHaveCSS('width', '48px');

  await page.getByRole('button', { name: 'Expand Library' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByText('Asset Library', { exact: true })).toBeVisible();

  const roomButton = page.getByRole('button', { name: 'Open Room Inspector' });
  const inspector = page.getByTestId('inspector-panel');
  if (!(await inspector.getAttribute('class'))?.includes('translate-x-0')) {
    await roomButton.focus();
    await page.keyboard.press('Enter');
  }
  await expect(inspector).toHaveClass(/translate-x-0/);
  await page.getByRole('button', { name: 'Close Inspector' }).focus();
  await page.keyboard.press('Enter');
  await expect(roomButton).toBeVisible();
  await roomButton.focus();
  await page.keyboard.press('Enter');
  await expect(inspector).toHaveClass(/translate-x-0/);

  const finalBounds = await canvas.boundingBox();
  expect(finalBounds).toEqual(initialBounds);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { phase3Canvas?: HTMLCanvasElement | null }).phase3Canvas ===
        document.querySelector('canvas')
    )
  ).toBe(true);

  const themeButton = page.getByRole('button', { name: 'Toggle Theme' });
  await themeButton.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Toggle Theme' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: 'Toggle Theme' }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Tab');
  const focusStyle = await page.evaluate(() => {
    const active = document.activeElement;
    return active ? getComputedStyle(active).outlineStyle : 'none';
  });
  expect(focusStyle).toBe('solid');

  const unnamedButtons = await page.locator('button:visible').evaluateAll((buttons) =>
    buttons
      .filter(
        (button) =>
          !button.getAttribute('aria-label') &&
          !button.getAttribute('aria-labelledby') &&
          !button.getAttribute('title') &&
          !button.textContent?.trim()
      )
      .map((button) => button.outerHTML.slice(0, 120))
  );
  expect(unnamedButtons).toEqual([]);
});

test('camera presets and saved views remain accessible and persist after reload', async ({ page }) => {
  test.setTimeout(45000);
  await openApp(page, true);

  await page.getByRole('button', { name: 'Presets' }).click();
  await expect(page.getByRole('button', { name: 'Front View' })).toBeVisible();
  await page.getByRole('button', { name: 'Front View' }).click();
  await expect(page.getByRole('button', { name: 'Presets' })).toBeVisible();

  await page.getByRole('button', { name: 'Views' }).click();
  await expect(page.getByText('Persisted Phase 3 View', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.getByRole('button', { name: 'Views' }).click();
  await expect(page.getByText('Persisted Phase 3 View', { exact: true })).toBeVisible();
});

test('measures orbit and pan frame rate with 60 objects and preserves the canvas across panel toggles', async ({
  page,
}) => {
  test.setTimeout(90000);
  await openApp(page, true);

  const objectCount = await page.evaluate(async () => {
    const { useSceneStore } = await import('/src/store/sceneStore.ts');
    const currentObjects = useSceneStore.getState().room.objects;
    const benchmarkObjects = Array.from({ length: 60 }, (_, index) => ({
        id: `phase3-benchmark-${index}`,
        assetId: 'phase3-benchmark-cube',
        name: `Benchmark cube ${index + 1}`,
        position: [0.2 + (index % 10) * 0.35, 0, 0.2 + Math.floor(index / 10) * 0.4],
        rotation: [0, 0, 0],
        size: [0.2, 0.2, 0.2],
        elevation: 0,
        role: 'solid',
        wallMounted: false,
      }));
    useSceneStore.setState((state) => ({
      room: { ...state.room, objects: [...currentObjects, ...benchmarkObjects] },
    }));
    return useSceneStore.getState().room.objects.length;
  });
  expect(objectCount).toBeGreaterThanOrEqual(60);
  await page.waitForTimeout(500);

  const canvas = page.locator('canvas').first();
  const renderer = await canvas.evaluate((element) => {
    const gl = element.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl
      ? extension
        ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER)
      : 'unavailable';
  });
  const softwareRenderer = /swiftshader|llvmpipe|software/i.test(renderer);
  test.info().annotations.push({ type: 'webgl-renderer', description: renderer });
  const boundsBeforePanels = await canvas.boundingBox();
  await page.getByRole('button', { name: 'Collapse Library' }).focus();
  await page.keyboard.press('Enter');
  const inspector = page.getByTestId('inspector-panel');
  const roomButton = page.getByRole('button', { name: 'Open Room Inspector' });
  if (!(await inspector.getAttribute('class'))?.includes('translate-x-0')) {
    await roomButton.focus();
    await page.keyboard.press('Enter');
  }
  await page.getByRole('button', { name: 'Close Inspector' }).focus();
  await page.keyboard.press('Enter');
  await roomButton.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Expand Library' }).focus();
  await page.keyboard.press('Space');
  expect(await canvas.boundingBox()).toEqual(boundsBeforePanels);

  const measureFrameRate = async (interaction: 'orbit' | 'pan') => {
    await page.evaluate(() => {
      const start = performance.now();
      let frames = 0;
      const frame = (time: number) => {
        frames++;
        if (time - start < 1000) requestAnimationFrame(frame);
        else document.body.dataset.phase3Fps = String((frames * 1000) / (time - start));
      };
      requestAnimationFrame(frame);
    });

    if (interaction === 'orbit') {
      await page.keyboard.press('Numpad4');
    } else {
      await canvas.dispatchEvent('wheel', {
        deltaX: 80,
        deltaY: 45,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
    }
    await page.waitForTimeout(1100);

    return Number(await page.locator('body').getAttribute('data-phase3-fps'));
  };

  const orbitFps = await measureFrameRate('orbit');
  const panFps = await measureFrameRate('pan');
  test.info().annotations.push({
    type: 'measured-fps',
    description: `orbit ${orbitFps.toFixed(1)}, pan ${panFps.toFixed(1)}`,
  });
  const minimumFps = softwareRenderer ? 1 : 55;
  expect(orbitFps).toBeGreaterThanOrEqual(minimumFps);
  expect(panFps).toBeGreaterThanOrEqual(minimumFps);
});

test('semantic theme tokens meet WCAG AA contrast in light and dark modes', async ({ page }) => {
  test.setTimeout(60000);
  await openApp(page, true);
  const button = page.getByRole('button', { name: 'Toggle Theme' });
  const contrastRatios = async () =>
    page.locator('html').evaluate((root) => {
      const style = getComputedStyle(root);
      const readRgb = (name: string) => {
        const value = style.getPropertyValue(name).trim();
        const match = value.match(/^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i);
        if (!match) throw new Error(`Invalid theme color ${name}: ${value}`);
        return match.slice(1).map((channel) => parseInt(channel, 16) / 255);
      };
      const luminance = (channels: number[]) => {
        const linear = channels.map((value) =>
          value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
        );
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      };
      const background = luminance(readRgb('--bg-app'));
      return ['--text-primary', '--text-secondary', '--text-muted'].map((name) => {
        const foreground = luminance(readRgb(name));
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      });
    });

  for (const theme of ['dark', 'light']) {
    const currentTheme = await page.locator('html').getAttribute('data-theme');
    if (currentTheme !== theme) await button.click();
    const ratios = await contrastRatios();
    expect(ratios.every((ratio) => ratio >= 4.5)).toBe(true);
  }
});
