# Contributing

## Development setup

This project requires Node.js 24 or newer for the local validation and packaging scripts. The extension runtime itself has no third-party dependencies or build step.

1. Fork and clone the repository.
2. Run `npm run check`.
3. Load the repository as an unpacked extension from `chrome://extensions`.
4. Make a focused change with tests where the behavior can be exercised outside Chrome.
5. Run `npm run check` again before opening a pull request.

Run `npm run test:browser` for changes that affect the manifest, service worker, popup,
or Settings page. The command requires Chrome for Testing or Chromium; set
`CHROME_PATH` if its executable is not in a standard location.

Use `npm run package` to create the same ZIP artifact produced by continuous integration.

## Credentials

Never commit API keys. Copy `.env.example` to `.env` for optional live API testing; `.env` is ignored by Git. Contributors should use their own OpenAQ key and run `npm run test:live` only when live verification is needed.

## Extension permissions

Keep permissions narrowly scoped. Any change to manifest permissions or data handling must include corresponding updates to `README.md` and `PRIVACY.md`.

## Pull requests

Keep commits focused and explain user-visible behavior, validation performed, and any remaining limitations. Do not include generated `dist/` archives in commits.
