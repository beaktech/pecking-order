# BirdNET-Pi on Windows

[Back to the README](../README.md). During the pre-release period, use the source or local-package command described there in place of `npx pecking-order`.

BirdNET-Pi's native filenames contain colons, which [Windows filename rules](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file) do not allow. Pecking Order stops native Windows Pi setup with an explanation rather than treating an incompatible copy as ordinary deleted recordings. Renaming recordings alone would break their exact match to the database.

Use [WSL](https://learn.microsoft.com/en-us/windows/wsl/install) with a Linux distribution such as Ubuntu. This is an additional requirement for this particular route, not for native BirdNET-Go or macOS/Linux Pi use. Install Node.js **22.13 or newer** and FFmpeg **inside WSL**, and put Pecking Order and the copied archive in its Linux home directory. Do not extract the archive onto `C:` or under `/mnt/c` (or another Windows-mounted drive). Preserve the `By_Date` folders and filenames; never rename live recordings or edit the live database for Pecking Order.

1. Make a consistent database snapshot on the Pi using SQLite's backup API. For example, run this with the Pi's existing Python 3, adjusting the source path. The destination must be a new snapshot file, separate from the live database:

   ```python
   from pathlib import Path
   import sqlite3

   source = Path.home() / 'BirdNET-Pi/scripts/birds.db'
   snapshot = Path.home() / 'birds-pecking-order-snapshot.db'
   if snapshot.exists():
       raise SystemExit('Choose a new snapshot filename')
   with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as live:
       with sqlite3.connect(snapshot) as copy:
           live.backup(copy)
   ```

2. From a WSL terminal, copy that snapshot and the extracted recordings into Linux storage. Replace `user@station` and the remote paths with your station's actual details. These commands read the Pi's files and write only local copies:

   ```bash
   mkdir -p "$HOME/birdnet-review/Extracted"
   scp -r 'user@station:/path/to/BirdSongs/Extracted/By_Date' "$HOME/birdnet-review/Extracted/"
   scp 'user@station:/path/to/birds-pecking-order-snapshot.db' "$HOME/birdnet-review/birds.db"
   ```

3. From a dedicated review directory inside WSL, run the published package:

   ```bash
   npx pecking-order --source birdnet-pi --archive "$HOME/birdnet-review/Extracted" --database "$HOME/birdnet-review/birds.db" --source-timezone Europe/London --no-open
   ```

   Substitute the Pi's actual recording time zone. Open `http://localhost:4317` in your Windows browser; [WSL supports localhost access from Windows](https://learn.microsoft.com/en-us/windows/wsl/networking#accessing-linux-networking-apps-from-windows-localhost). Keep the terminal running. Without a Linux desktop file manager, **Show file** provides the Linux path to copy.

The database snapshot is consistent; copying a changing audio folder is not a station-wide snapshot. Older audio deleted during transfer may be absent, and newer audio may have no row in the snapshot. Pecking Order reports these mismatches. Use an existing consistent station backup if you need an exact point-in-time archive. WSL instructions have been checked against Microsoft's documentation but have not yet been exercised on a Windows machine.
