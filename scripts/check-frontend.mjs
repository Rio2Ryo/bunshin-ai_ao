import { chromium } from 'playwright';

const url = process.argv[2] ?? 'https://72636e8a.bunshin-ai.pages.dev/twins';

const main = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on('console', (msg) => {
    console.log('CONSOLE:', msg.type(), msg.text());
  });
  page.on('pageerror', (err) => {
    console.log('PAGEERROR:', err.message);
  });
  page.on('response', (res) => {
    const u = res.url();
    if (u.includes('/api/trpc')) {
      console.log('TRPC:', res.status(), u);
    }
  });
  page.on('requestfailed', (req) => {
    console.log('REQFAILED:', req.url(), req.failure()?.errorText);
  });

  const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  console.log('GOTO:', resp?.status(), url);

  await page.waitForTimeout(3_000);

  // Check if root element has content
  const rootInner = await page.$eval('#root', (el) => el.innerHTML.slice(0, 200));
  console.log('ROOT_INNER_HEAD:', JSON.stringify(rootInner));

  await browser.close();
};

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
