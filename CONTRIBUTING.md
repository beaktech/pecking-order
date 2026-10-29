# Contributing to Pecking Order

Bug reports, documentation improvements and small pull requests are welcome. Discuss larger changes in an issue before starting, especially new source formats, dependencies or changes to the review workflow.

## Set up and check a change

Install a maintained Node.js LTS release (minimum supported version: 22.13) and FFmpeg/FFprobe on PATH, as described in the [README](README.md#install). There are no npm runtime dependencies and no compilation step. ESLint and Playwright are development-only tools installed from the committed lockfile.

From a source checkout:

```sh
npm ci --ignore-scripts
npm start -- --help
npm run lint
npm test
npm run test:package
npx --no-install playwright install chromium webkit
npm run test:browser
```

The package check creates and installs a tarball offline in temporary folders and exercises import, analysis, review, export and restart. It needs permission to start temporary localhost servers. Tests generate synthetic audio and databases; never point tests at a real station archive.

ESLint checks application code, browser code, tests and scripts with zero warnings allowed. Playwright checks keyboard species selection, playback/seeking, review persistence, unsaved station details, clipboard fallback and WAV export in Chromium and WebKit. These are functional tests with synthetic recordings, not screenshot comparisons. On Linux, install browser system libraries with `npx --no-install playwright install --with-deps chromium webkit`. There is no configured formatter or type checker. Follow the surrounding JavaScript style: two-space indentation, single quotes and no semicolons. Run `git diff --check` before submitting. Add a regression test for a bug fix, and update the README and changelog for changes users will notice. GitHub Actions runs lint, tests and the package check on pull requests across Linux, macOS and Windows, plus a dedicated Linux browser-test job.

## Repository map

- `src/cli.js`: CLI entry point, startup and rescan lifecycle.
- `src/config.js`, `src/station-config.js`: review workspace and station settings.
- `src/sources.js`, `src/sqlite.js`, `src/time.js`: read-only source imports and recording timestamps.
- `src/library.js`, `src/common-names.js`, `resources/`: index, species lookup and attribution.
- `src/server.js`: loopback HTTP API, static UI, media and spectrograms.
- `src/analyse.js`, `src/store.js`: measurements and saved reviews.
- `src/preparation.js`, `src/export.js`: upload details and manual submission exports.
- `public/`: browser UI; `app.js` is its entry point.
- `test/`: Node's built-in test suite.
- `browser/`, `playwright.config.js`: isolated browser interaction tests.
- `eslint.config.js`: JavaScript correctness checks.
- `scripts/check-package.mjs`: offline release-package verification.
- `.github/workflows/test.yml`: cross-platform CI.

## Scope and data handling

Keep original recordings and source databases unchanged. Uploading to Xeno-canto remains a manual user action. Use small synthetic fixtures and omit private recordings, credentials, precise station locations, local config and exported metadata from issues and pull requests.

Keep fixes focused. Describe the problem, resulting behaviour and checks run in your pull request. Follow the [code of conduct](CODE_OF_CONDUCT.md) when participating in the project. Report suspected security vulnerabilities privately using [SECURITY.md](SECURITY.md), rather than posting an exploit or private data in an issue.

Application code is MIT-licensed. The IOC names data has separate CC BY 3.0 attribution; see [resources/ATTRIBUTION.md](resources/ATTRIBUTION.md). Preserve that distinction in contributions and releases.
