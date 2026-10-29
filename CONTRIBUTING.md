# Contributing to Pecking Order

Bug reports, documentation improvements and small pull requests are welcome. Discuss larger changes in an issue before starting, especially new source formats, dependencies or changes to the review workflow.

## Set up and check a change

Install a maintained Node.js LTS release (minimum supported version: 22.13) and FFmpeg/FFprobe on PATH, as described in the [README](README.md#install). There are no npm dependencies to install and no compilation step.

From a source checkout:

```sh
npm start -- --help
npm test
npm run test:package
```

The package check creates and installs a tarball offline in temporary folders and exercises import, analysis, review, export and restart. It needs permission to start temporary localhost servers. Tests generate synthetic audio and databases; never point tests at a real station archive.

There is currently no configured linter, formatter or type checker. Follow the surrounding JavaScript style: two-space indentation, single quotes and no semicolons. Run `git diff --check` before submitting. Add a regression test for a bug fix, and update the README and changelog for changes users will notice. GitHub Actions runs the tests and package check on pull requests across Linux, macOS and Windows.

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
- `scripts/check-package.mjs`: offline release-package verification.
- `.github/workflows/test.yml`: cross-platform CI.

## Scope and data handling

Keep original recordings and source databases unchanged. Uploading to Xeno-canto remains a manual user action. Use small synthetic fixtures and omit private recordings, credentials, precise station locations, local config and exported metadata from issues and pull requests.

Keep fixes focused. Describe the problem, resulting behaviour and checks run in your pull request. Use respectful, constructive language when discussing contributions. Report suspected security vulnerabilities privately using [SECURITY.md](SECURITY.md), rather than posting an exploit or private data in an issue.

Application code is MIT-licensed. The IOC names data has separate CC BY 3.0 attribution; see [resources/ATTRIBUTION.md](resources/ATTRIBUTION.md). Preserve that distinction in contributions and releases.
