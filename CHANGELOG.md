# Changelog

## 0.1.0 — Unreleased

First public release of **Pecking Order**, by Beak Tech. Release files are prepared locally; nothing has been published to npm or GitHub.

### Recording sources and setup

- Import standard BirdNET-Go audio exports, including duration suffixes and WAV, FLAC, MP3, M4A, Opus and Ogg files.
- Import BirdNET-Pi's `By_Date` archive using exact filenames and metadata from its SQLite `detections` table. The maintained Nachtzuster fork is the primary target; synthetic fixtures also cover the original format.
- Read Pi databases **read-only**, one row at a time with `.iterate()`. Missing or unreadable databases name the expected `BirdNET-Pi/scripts/birds.db` file. There is **no `BirdDB.txt` fallback**.
- Raise the minimum Node version from 20.19 to **22.13** for built-in SQLite without an npm dependency. Suppress only the specific SQLite experimental warning; other warnings remain visible.
- Report metadata conflicts, unmatched files and ambiguous local times. Explain that missing older Pi audio is normal because BirdNET-Pi deletes recordings while retaining detection records.
- Save first-run station settings, import literal native-config coordinates without executing configuration, and keep recording time zones separate from display time zones. Use native common names or explicit labels, with scientific-name fallback; no BirdNET labels or models are bundled.

### Review and export

- Search and rank recordings, inspect spectrograms, listen, keep/reject and confirm identifications manually.
- Score candidates using BirdNET confidence, estimated SNR, peak level and clipping risk. The analysis filter changes neither originals nor exported audio.
- Export a separate WAV/CSV/checklist folder for manual Xeno-canto preparation. Never upload, alter original recordings or silently omit missing selections. Failed exports leave previous exports intact.
- Keep saved reviews, caches and exports in the launch directory, outside the installed package or npm cache. Package updates retain reviews when reopened from the same review folder.

### Platforms and packaging

- Use `pecking-order` for the package and CLI and `PECKING_ORDER_ARCHIVE` for the archive environment variable.
- Request the browser and file manager on macOS, Windows and Linux, with copyable URL/path fallbacks. Treat numeric Explorer exit codes, including 1, as requested launches.
- Check FFmpeg and FFprobe at startup, with platform-specific installation hints. Document the WSL/Linux-filesystem route for native Pi filenames on Windows.
- Add an MIT licence with **Beak Tech Community Interest Company** as copyright holder and package author. Use **By Beak Tech** above the application title.
- Include a public README, synthetic demonstration screenshot, source compatibility references and credits. Restrict npm contents to application files, neutral examples and public documentation.
- Prepare version **0.1.0** for publication by removing the temporary `private` flag. Publication remains a separate owner action.
- Add GitHub Actions for macOS, Windows and Linux on Node 22.13.0, latest 22 and 24, including offline package checks. Hosted jobs have not run before the initial repository push.
