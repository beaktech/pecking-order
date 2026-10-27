import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const launchOptions = { timeout: 5000, windowsHide: true, maxBuffer: 256 * 1024 }

function desktopAvailable(platform, env) {
  return platform !== 'linux' || Boolean(env.DISPLAY || env.WAYLAND_DISPLAY)
}

export async function openBrowser(url, { platform = process.platform, env = process.env, run = execFileAsync } = {}) {
  if (!desktopAvailable(platform, env)) return false
  const command = {
    darwin: ['open', [url]],
    win32: ['rundll32.exe', ['url.dll,FileProtocolHandler', url]],
    linux: ['xdg-open', [url]],
  }[platform]
  if (!command) return false
  try { await run(...command, launchOptions); return true }
  catch { return false }
}

export async function revealFile(path, { platform = process.platform, env = process.env, run = execFileAsync, inspect = stat } = {}) {
  const fallback = { path, opened: false, message: 'The file manager is unavailable. Copy the recording path below.' }
  try { await inspect(path) }
  catch { return { ...fallback, message: 'The recording is no longer accessible. Check the archive location; its indexed path is below.' } }
  if (!desktopAvailable(platform, env)) return fallback
  // Open the containing folder on Windows and Linux. Passing the folder as one
  // argument avoids Explorer's comma-separated /select syntax for archive names.
  const command = {
    darwin: ['open', ['-R', path]],
    win32: ['explorer.exe', [win32.dirname(path)]],
    linux: ['xdg-open', [posix.dirname(path)]],
  }[platform]
  if (!command) return fallback
  try {
    await run(...command, launchOptions)
  } catch (error) {
    // Explorer can exit with 1 after successfully handing off the request.
    // Numeric exit codes mean it started; spawn failures use codes such as
    // ENOENT or EACCES. Keep the fallback for those failures and timeouts.
    if (platform !== 'win32' || typeof error.code !== 'number') return fallback
  }
  return { path, opened: true, message: platform === 'darwin' ? 'Requested this recording in Finder. Its full path is below.' : 'Requested the containing folder in your file manager. The recording’s full path is below.' }
}

export function checkSourcePlatform(source, platform = process.platform) {
  if (source === 'birdnet-pi' && platform === 'win32') {
    throw new Error('BirdNET-Pi filenames contain colons, which native Windows paths cannot represent. Run Pecking Order inside WSL with Node.js 22.13+ and FFmpeg, and copy the archive and a consistent birds.db backup into the Linux filesystem (not /mnt/c). Keep the original filenames. See the README’s BirdNET-Pi on Windows instructions.')
  }
}

export async function checkAudioTools({ platform = process.platform, run = execFileAsync } = {}) {
  const tools = ['ffmpeg', 'ffprobe']
  const results = await Promise.allSettled(tools.map((tool) => run(tool, ['-version'], launchOptions)))
  const unavailable = tools.filter((_, index) => results[index].status === 'rejected')
  if (!unavailable.length) return
  const hint = {
    darwin: 'On macOS, install FFmpeg with Homebrew: brew install ffmpeg.',
    win32: 'On Windows, get an FFmpeg build from https://ffmpeg.org/download.html and add its bin folder (containing ffmpeg.exe and ffprobe.exe) to PATH. Open a new terminal afterwards.',
    linux: 'On Debian/Ubuntu (including Ubuntu in WSL), run sudo apt install ffmpeg. For other Linux distributions, install the ffmpeg package using your package manager.',
  }[platform] || 'Install FFmpeg and FFprobe from https://ffmpeg.org/download.html and add them to PATH.'
  throw new Error(`Required audio tools could not run: ${unavailable.join(', ')}. Both FFmpeg and FFprobe must be available on PATH. ${hint} Check with ffmpeg -version and ffprobe -version in this terminal.`)
}
