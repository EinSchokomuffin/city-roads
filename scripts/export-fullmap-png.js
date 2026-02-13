const {spawn} = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const {chromium} = require('playwright');

const PORT = 8085;
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;
const OUT_DIR = path.join(__dirname, '..', 'exports');

run().catch(err => {
  console.error(err);
  process.exit(1);
});

async function run() {
  ensureDir(OUT_DIR);

  const devServer = startDevServer();
  await waitForServer();

  const browser = await chromium.launch();
  const context = await browser.newContext({acceptDownloads: true});
  const page = await context.newPage();
  page.setDefaultTimeout(0);

  await page.goto(BASE_URL, {waitUntil: 'networkidle'});

  await page.click('[data-action="toggle-settings"]');
  await page.waitForSelector('[data-export="full-map-png"]');

  const downloadPromise = page.waitForEvent('download');
  await page.click('[data-export="full-map-png"]');
  const download = await downloadPromise;

  const fileName = `berlin-fullmap-${Date.now()}.png`;
  const outPath = path.join(OUT_DIR, fileName);
  await download.saveAs(outPath);
  console.log(`Saved: ${outPath}`);

  await browser.close();
  devServer.kill();
}

function startDevServer() {
  const proc = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev', '--', '--host', HOST, '--port', String(PORT)], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    shell: process.platform === 'win32'
  });
  return proc;
}

function waitForServer() {
  return new Promise(resolve => {
    const start = Date.now();
    const timer = setInterval(() => {
      http.get(BASE_URL, res => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          clearInterval(timer);
          resolve();
        }
      }).on('error', () => {
        if (Date.now() - start > 120000) {
          clearInterval(timer);
          resolve();
        }
      });
    }, 500);
  });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {recursive: true});
  }
}
