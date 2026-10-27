// Renders icons/icon.svg to PNG app icons using the pre-installed Playwright Chromium.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import { readFileSync, writeFileSync } from 'node:fs';
const svg = readFileSync(new URL('../icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), await page.screenshot({ omitBackground: true }));
  await page.close();
}
await browser.close();
console.log('icons written');
