import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const chromePath = await findChrome();
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'rainmatter-air-chrome-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  `--load-extension=${root}`,
  `--disable-extensions-except=${root}`,
  // Required in CI (Docker/GitHub Actions) where Chrome can't use its sandbox
  ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let chromeErrors = '';
chrome.stderr.on('data', chunk => { chromeErrors += chunk; });

try {
  const port = await readDebuggingPort(profile);
  // Extension is pre-loaded via --load-extension; find its service worker by URL pattern.
  // background.js is the declared service_worker in manifest.json.
  const worker = await waitForTarget(port, target => (
    target.type === 'service_worker' &&
    target.url.startsWith('chrome-extension://') &&
    target.url.endsWith('/background.js')
  ));
  const extensionId = new URL(worker.url).hostname;
  const workerClient = await connect(worker.webSocketDebuggerUrl);
  // Wait for chrome.runtime to be fully initialised inside the service worker.
  await waitForExpression(workerClient, `Boolean(chrome.runtime?.id)`);
  const runtime = await evaluate(workerClient, `({
    id: chrome.runtime?.id,
    name: chrome.runtime?.getManifest()?.name,
    optionsUrl: chrome.runtime?.getURL('options.html'),
    hasStorage: Boolean(chrome.storage)
  })`);
  workerClient.close();
  assert(runtime.name === 'Rainmatter Air', `Unexpected extension worker name: ${runtime.name ?? 'undefined'} (id: ${runtime.id ?? 'undefined'})`);
  assert(runtime.hasStorage, 'Storage API was unavailable in the extension worker.');
  const optionsUrl = runtime.optionsUrl;
  const options = await createTarget(port, optionsUrl);
  const optionsClient = await connect(options.webSocketDebuggerUrl);
  await waitForExpression(optionsClient, `location.protocol === 'chrome-extension:' && document.readyState === 'complete'`);

  await evaluate(optionsClient, `(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const { snapshot } = await chrome.storage.local.get(['snapshot']);
      if (snapshot?.status && snapshot.status !== 'loading') return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Extension initialization did not finish.');
  })()`, true);

  await evaluate(optionsClient, `Promise.all([
    chrome.storage.sync.set({
      apiBaseUrl: 'https://api.openaq.org/v3', country: 'IN', location: 'Smoke Test City',
      locationId: '8118', overlayEnabled: true, refreshMinutes: 30
    }),
    chrome.storage.local.set({
      apiKey: 'browser-test-key',
      snapshot: {
        status: 'ok', city: 'Smoke Test City', country: 'IN',
        updatedAt: '2026-06-21T06:00:00Z', lastAttemptAt: '2026-06-21T06:00:00Z',
        aqi: 123, aqiKind: 'indicative', category: 'Moderately Polluted', source: 'Test fixture',
        measurements: [{ parameter: 'pm25', value: 72.5, unit: 'µg/m³' }],
        message: 'Browser smoke-test snapshot.'
      }
    })
  ])`, true);

  const storage = await evaluate(optionsClient, `(async () => ({
    synced: await chrome.storage.sync.get(null),
    local: await chrome.storage.local.get(['apiKey'])
  }))()`, true);
  assert(!Object.hasOwn(storage.synced, 'apiKey'), 'API key leaked into synchronized storage');
  assert(storage.local.apiKey === 'browser-test-key', 'API key was not available in local storage');

  const popup = await createTarget(port, `chrome-extension://${extensionId}/popup.html`);
  const popupClient = await connect(popup.webSocketDebuggerUrl);
  await waitForExpression(popupClient, `document.querySelector('#aqi')?.textContent === '123'`);
  const popupState = await evaluate(popupClient, `({
    aqi: document.querySelector('#aqi').textContent,
    category: document.querySelector('#category').textContent,
    label: document.querySelector('#score-label').textContent,
    source: document.querySelector('#source').textContent
  })`);
  assert(popupState.aqi === '123', 'Popup did not render the cached AQI');
  assert(popupState.category === 'Moderately Polluted', 'Popup category was incorrect');
  assert(popupState.label === 'Indicative AQI', 'Popup did not identify an indicative AQI');
  assert(popupState.source === 'Test fixture', 'Popup source was incorrect');

  await optionsClient.send('Page.reload');
  await waitForExpression(optionsClient, `document.querySelector('#apiKey')?.value === 'browser-test-key'`);
  const optionsState = await evaluate(optionsClient, `({
    apiKeyType: document.querySelector('#apiKey').type,
    location: document.querySelector('#location').value,
    locationId: document.querySelector('#locationId').value
  })`);
  assert(optionsState.apiKeyType === 'password', 'API key input was not masked');
  assert(optionsState.location === 'Smoke Test City', 'Options location did not load');
  assert(optionsState.locationId === '8118', 'Options location ID did not load');

  popupClient.close();
  optionsClient.close();
  console.log('Chrome smoke test passed: service worker storage, popup, and options page.');
} catch (error) {
  if (chromeErrors.trim()) console.error(chromeErrors.trim().split('\n').slice(-8).join('\n'));
  throw error;
} finally {
  chrome.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => chrome.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 2000)),
  ]);
  if (chrome.exitCode == null) chrome.kill('SIGKILL');
  await fs.rm(profile, { recursive: true, force: true });
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch { /* try the next path */ }
  }
  throw new Error('Chrome for Testing or Chromium was not found. Set CHROME_PATH to its executable.');
}

async function readDebuggingPort(directory) {
  const file = path.join(directory, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (chrome.exitCode != null) throw new Error(`Chrome exited before startup with code ${chrome.exitCode}.`);
    try { return Number((await fs.readFile(file, 'utf8')).split(/\r?\n/)[0]); }
    catch { await delay(100); }
  }
  throw new Error('Timed out waiting for Chrome remote debugging.');
}

async function waitForTarget(port, predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(2000),
    }).then(response => response.json());
    const target = targets.find(predicate);
    if (target) return target;
    await delay(100);
  }
  throw new Error('Timed out waiting for the extension service worker.');
}

async function createTarget(port, url) {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(2000),
  }).then(response => response.json());
  const browserClient = await connect(version.webSocketDebuggerUrl);
  const { targetId } = await browserClient.send('Target.createTarget', { url });
  browserClient.close();
  return waitForTarget(port, target => target.id === targetId);
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    clearTimeout(callback.timer);
    if (message.error) callback.reject(new Error(message.error.message));
    else callback.resolve(message.result);
  });
  return {
    close: () => socket.close(),
    send(method, params = {}) {
      const messageId = ++id;
      socket.send(JSON.stringify({ id: messageId, method, params }));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(messageId);
          reject(new Error(`Timed out waiting for Chrome DevTools method ${method}.`));
        }, 10000);
        pending.set(messageId, { resolve, reject, timer });
      });
    },
  };
}

async function evaluate(client, expression, awaitPromise = false) {
  const response = await client.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || 'Browser evaluation failed.');
  return response.result.value;
}

async function waitForExpression(client, expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(client, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for browser expression: ${expression}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
