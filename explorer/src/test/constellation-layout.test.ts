import { test, expect } from '@playwright/test';

test('test interactive mode node positions when switching to Constellation and others', async ({ page }) => {
  // Let's test in Interactive Mode
  await page.goto('http://localhost:3001/');
  await page.waitForSelector('.graph-controls-floating');
  await page.waitForTimeout(1000);

  const getCanvasStatus = async (stepName: string) => {
    const res = await page.evaluate(() => {
      const cy = (window as any).__CY__;
      const all = cy.nodes();
      const visible = cy.nodes(':visible');
      const positions = visible.map((n: any) => ({
        id: n.id(),
        x: Math.round(n.position('x')),
        y: Math.round(n.position('y')),
      }));
      const uniqueCoords = new Set(positions.map(p => `${p.x},${p.y}`));
      const archBtn = document.querySelector('[data-testid="architecture-mode-toggle"]');
      const layoutBtn = document.querySelector('[data-testid="layout-mode-toggle"]');
      return {
        arch: archBtn?.textContent?.trim(),
        layout: layoutBtn?.getAttribute('title'),
        allCount: all.length,
        visibleCount: visible.length,
        uniqueCoordsCount: uniqueCoords.size,
        sample: positions.slice(0, 5),
      };
    });
    console.log(stepName, JSON.stringify(res, null, 2));
    return res;
  };

  await getCanvasStatus('1. Initial (Hierarchical, Interactive)');

  // Cycle: Hybrid
  await page.click('[data-testid="architecture-mode-toggle"]');
  await page.waitForTimeout(1500);
  await getCanvasStatus('2. Hybrid (Interactive)');

  // Cycle: Orbit
  await page.click('[data-testid="architecture-mode-toggle"]');
  await page.waitForTimeout(1500);
  await getCanvasStatus('3. Orbit (Interactive)');

  // Cycle: Constellation
  await page.click('[data-testid="architecture-mode-toggle"]');
  await page.waitForTimeout(1500);
  await getCanvasStatus('4. Constellation (Interactive)');

  // Cycle: Back to Hierarchical
  await page.click('[data-testid="architecture-mode-toggle"]');
  await page.waitForTimeout(1500);
  await getCanvasStatus('5. Hierarchical (Interactive, after cycle)');
});
