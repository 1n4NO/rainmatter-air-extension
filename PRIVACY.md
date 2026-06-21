# Privacy

Rainmatter Air does not operate a server and does not collect analytics.

## Data stored by the extension

- API URL, API key, location, refresh interval, and overlay preference are stored in Chrome synchronized extension storage.
- The most recent air-quality snapshot is stored locally in the browser.

The API key is sent only to the configured air-quality API as an `X-API-Key` request header. Users should supply their own key and can remove stored extension data by uninstalling the extension.

## Website access

The content script runs on HTTP and HTTPS pages only to display the optional air-quality overlay. It does not read, collect, or transmit page content. Access to custom API origins is requested separately when the user saves that API URL.
