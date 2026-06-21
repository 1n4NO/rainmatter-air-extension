# Rainmatter Air Extension

A Chrome extension scaffold for an air-quality platform that keeps pollution data visible in the browser.

## What it includes

- Popup dashboard for AQI, category, and pollutant measurements
- Options page for configuring API endpoint and location
- Background service worker that fetches and caches the latest snapshot
- Content script overlay for quick at-a-glance visibility on any webpage

## Data source

The extension defaults to OpenAQ API v3. OpenAQ requires an API key and a numeric
location ID; both can be entered on the extension's Settings page. The key is stored
in Chrome synchronized extension storage and is sent as the `X-API-Key` header only
to the configured API endpoint.

When an API does not report an AQI directly, the extension displays an indicative
AQI calculated from available pollutant measurements using CPCB breakpoints. Latest
sensor readings are not a substitute for the averaging periods required for an
official CPCB AQI.

## Check

```bash
npm run check
```

To verify the configured OpenAQ location against the live API, copy `.env.example`
to `.env`, add your key, and run:

```bash
npm run test:live
```
