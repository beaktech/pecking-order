# Changelog

## 0.1.0 — Unreleased

First public release of **Pecking Order**, by Beak Tech. The package has not yet been published to npm.

### Reliability and security

- Prevent simultaneous processes from opening the same review workspace, with recovery after a stopped process.
- Preserve unsaved station-detail edits when a recording review refreshes the preparation screen.
- Remove unused review mutation and batch-analysis methods; tests use the production save path.
- Add a community code of conduct.

- Reject foreign Host/Origin requests to the local app, limit JSON request bodies and validate review values before saving. Escape stored decision text when rendering cards.
- Neutralise formula-like CSV text while preserving numeric coordinates and measurements.
- Publish review and upload-default changes only after successful disk writes; failed saves cannot silently become active or leak into later saves.
- Share overlapping rescans and spectrogram requests, publish caches atomically from unique temporary folders, and clean up failed generation.
- Add contributor guidance and a private security-reporting policy. Clarify supported runtime maintenance and one-process-per-workspace use.

### Recording sources and setup

- Import standard BirdNET-Go audio exports, including duration suffixes and WAV, FLAC, MP3, M4A, Opus and Ogg files.
- Import BirdNET-Pi's `By_Date` archive using exact filenames and metadata from its SQLite `detections` table. The maintained Nachtzuster fork is the primary target; synthetic fixtures also cover the original format.
- Read Pi databases **read-only**, one row at a time with `.iterate()`. Missing or unreadable databases name the expected `BirdNET-Pi/scripts/birds.db` file. There is **no `BirdDB.txt` fallback**.
- Raise the minimum Node version from 20.19 to **22.13** for built-in SQLite without an npm dependency. Suppress only the specific SQLite experimental warning; other warnings remain visible.
- Report metadata conflicts, unmatched files and ambiguous local times. Explain that missing older Pi audio is normal because BirdNET-Pi deletes recordings while retaining detection records.
- Save first-run station settings, import literal native-config coordinates without executing configuration, and keep recording time zones separate from display time zones. Use native common names or explicit labels, with a bundled IOC English-name fallback when metadata has no common name. Retain scientific names for unknown species; no BirdNET labels or models are bundled. Include the lookup data’s CC BY 3.0 attribution separately from the MIT application licence.

### Review and export

- Add **Prepare uploads**, listing kept clips across species with reusable station details, metadata checks, per-field copying and selectable-text clipboard fallback.
- Save upload defaults per source archive and preserve recording-specific overrides. Use the same resolved details in the preparation screen and WAV/CSV exports.
- Stop assuming “song” for new reviews. Flag missing sound types, location information and identification confirmation, and show which unconfirmed clips will be excluded from export.
- Keep submission manual: the CSV remains a preparation manifest pending confirmation of Xeno-canto’s batch-upload template.

- Show common and scientific names together in the species picker, results and review heading; search by either name.
- Anchor the searchable species picker above the page, with mouse, touch and keyboard selection.
- Redesign recording cards with integrated audio controls, icon-led metrics, clearer species names and orange keep actions.
- Follow playback with a spectrogram playhead and seek by clicking, tapping, dragging or using arrow keys.
- Search and rank recordings, inspect spectrograms, listen, keep/reject and confirm identifications manually.
- Score candidates using BirdNET confidence, estimated SNR, peak level and clipping risk. The analysis filter changes neither originals nor exported audio.
- Export a separate WAV/CSV/checklist folder for manual Xeno-canto preparation. Never upload, alter original recordings or silently omit missing selections. Failed exports leave previous exports intact.
- Keep saved reviews, caches and exports in the launch directory, outside the installed package or npm cache. Package updates retain reviews when reopened from the same review folder.

### Platforms and packaging

- Use `pecking-order` for the package and CLI and `PECKING_ORDER_ARCHIVE` for the archive environment variable.
- Request the browser and file manager on macOS, Windows and Linux, with copyable URL/path fallbacks. Treat numeric Explorer exit codes, including 1, as requested launches.
- Check FFmpeg and FFprobe at startup, with platform-specific installation hints. Document the WSL/Linux-filesystem route for native Pi filenames on Windows.
- Add an MIT licence with **Beak Tech Community Interest Company** as copyright holder and package author. Show the Beak Tech logo and name above the application title.
- Include a public README, synthetic demonstration screenshot, source compatibility references and credits. Restrict npm contents to application files, neutral examples and public documentation.
- Prepare version **0.1.0** for publication by removing the temporary `private` flag. Publication remains a separate owner action.
- Add GitHub Actions for macOS, Windows and Linux on Node 22.13.0, latest 22 and 24, including offline package checks. Check hosted results for the release revision.
