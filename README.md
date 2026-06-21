# Rainmatter Air Extension

A Chrome extension that keeps air-quality data visible in the browser.

## Install locally

1. Clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose this repository.
5. Open the extension's Settings page and enter an OpenAQ API key and location ID.

## What it includes

- Popup dashboard for AQI, category, and pollutant measurements
- Options page for configuring API endpoint and location
- Background service worker that fetches and caches the latest snapshot
- Content script overlay for quick at-a-glance visibility on any webpage

## Data source

The extension defaults to OpenAQ API v3. OpenAQ requires an API key and a numeric
location ID; both can be entered on the extension's Settings page. The key is stored
in local extension storage (not Chrome sync) and is sent as the `X-API-Key` header only
to the configured API endpoint.

When an API does not report an AQI directly, the extension displays an indicative
AQI calculated from available pollutant measurements using CPCB breakpoints. Latest
sensor readings are not a substitute for the averaging periods required for an
official CPCB AQI.

## Check

Use Node.js 24 or newer, then run:

```bash
npm run check
```

GitHub Actions runs the same validation for pushes and pull requests and publishes
the packaged extension as a short-lived workflow artifact.

Run a real-browser smoke test when Chrome for Testing or Chromium is installed:

```bash
npm run test:browser
```

Set `CHROME_PATH` when the browser executable is not in a standard location. Branded
Google Chrome 137 and newer does not support automated unpacked-extension loading, so
use Chrome for Testing or Chromium. The test loads the unpacked extension headlessly
and verifies service-worker storage, popup rendering, and Settings credential loading.

To verify the configured OpenAQ location against the live API, copy `.env.example`
to `.env`, add your key, and run:

```bash
npm run test:live
```

## Package

Create a Chrome Web Store-ready ZIP in `dist/`:

```bash
npm run package
```

The package uses an explicit runtime-file allowlist, so local files such as `.env`, tests,
and development scripts are excluded.

## Permissions and privacy

- `storage` saves settings and the latest snapshot.
- `alarms` schedules background refreshes.
- OpenAQ host access allows the default API connection.
- Custom API host access is optional and requested only when configured.
- HTTP/HTTPS content-script access displays the optional overlay; page content is not read or transmitted.

See [PRIVACY.md](PRIVACY.md) for the complete data-handling summary.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and pull-request guidance.
