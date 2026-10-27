import test from 'node:test'
import assert from 'node:assert/strict'
import { checkAudioTools, checkSourcePlatform, openBrowser, revealFile } from '../src/platform.js'

for (const [platform, command, args] of [
  ['darwin', 'open', ['http://127.0.0.1:4317']],
  ['win32', 'rundll32.exe', ['url.dll,FileProtocolHandler', 'http://127.0.0.1:4317']],
  ['linux', 'xdg-open', ['http://127.0.0.1:4317']],
]) {
  test(`${platform}: browser uses the desktop launcher without a shell`, async () => {
    let called = false
    assert.equal(await openBrowser('http://127.0.0.1:4317', {
      platform, env: { WAYLAND_DISPLAY: 'wayland-0' },
      run: async (file, argv, options) => {
        called = true
        assert.equal(file, command)
        assert.deepEqual(argv, args)
        assert.equal(options.shell, undefined)
        assert.equal(options.timeout, 5000)
      },
    }), true)
    assert.equal(called, true)
  })
}

for (const [platform, path, command, args] of [
  ['darwin', '/Bird songs/Robin, garden/clip.wav', 'open', ['-R', '/Bird songs/Robin, garden/clip.wav']],
  ['linux', '/Bird songs/$(example) & garden/clip.wav', 'xdg-open', ['/Bird songs/$(example) & garden']],
  ['win32', 'C:\\Bird songs\\Robin, garden & café\\clip.wav', 'explorer.exe', ['C:\\Bird songs\\Robin, garden & café']],
  ['win32', '\\\\station\\Bird songs\\2026\\clip.wav', 'explorer.exe', ['\\\\station\\Bird songs\\2026']],
]) {
  test(`${platform}: reveal preserves the path ${path}`, async () => {
    let called = false
    const result = await revealFile(path, {
      platform, env: { DISPLAY: ':0' }, inspect: async (value) => assert.equal(value, path),
      run: async (file, argv, options) => {
        called = true
        assert.equal(file, command)
        assert.deepEqual(argv, args)
        assert.equal(options.shell, undefined)
        assert.equal(options.windowsHide, true)
      },
    })
    assert.equal(called, true)
    assert.equal(result.path, path)
    assert.equal(result.opened, true)
  })
}

test('headless Linux and unsupported platforms provide paths without launching anything', async () => {
  for (const platform of ['linux', 'unsupported']) {
    const options = { platform, env: {}, inspect: async () => {}, run: async () => assert.fail('must not launch') }
    assert.equal(await openBrowser('http://127.0.0.1:4317', options), false)
    const result = await revealFile('/recordings/clip.wav', options)
    assert.equal(result.opened, false)
    assert.equal(result.path, '/recordings/clip.wav')
    assert.match(result.message, /Copy/)
  }
})

test('missing launchers, failed starts and timeouts retain the copyable path', async () => {
  for (const code of ['ENOENT', 'EACCES', 'ETIMEDOUT', null]) {
    const options = { platform: 'win32', inspect: async () => {}, run: async () => { throw Object.assign(new Error('failed'), { code }) } }
    assert.equal(await openBrowser('http://127.0.0.1:4317', options), false)
    const result = await revealFile('C:\\archive\\clip.wav', options)
    assert.equal(result.opened, false)
    assert.equal(result.path, 'C:\\archive\\clip.wav')
  }
})

test('Explorer exit code 1 and other numeric exit codes still report the folder request', async () => {
  const path = 'C:\\archive\\clip.wav'
  for (const code of [1, 2, 255]) {
    const result = await revealFile(path, {
      platform: 'win32', inspect: async () => {},
      run: async (file) => {
        assert.equal(file, 'explorer.exe')
        throw Object.assign(new Error('Command failed'), { code })
      },
    })
    assert.equal(result.opened, true)
    assert.equal(result.path, path)
    assert.match(result.message, /Requested the containing folder/)
    assert.doesNotMatch(result.message, /unavailable/)
  }
})

test('other desktop launchers still fall back on a nonzero exit code', async () => {
  for (const platform of ['darwin', 'linux']) {
    const result = await revealFile('/archive/clip.wav', {
      platform, env: { DISPLAY: ':0' }, inspect: async () => {},
      run: async () => { throw Object.assign(new Error('Command failed'), { code: 1 }) },
    })
    assert.equal(result.opened, false)
    assert.match(result.message, /unavailable/)
  }
})

test('a disconnected archive provides its indexed path without trying a launcher', async () => {
  const result = await revealFile('/missing/clip.wav', {
    inspect: async () => { throw new Error('ENOENT') }, run: async () => assert.fail('must not launch'),
  })
  assert.equal(result.path, '/missing/clip.wav')
  assert.equal(result.opened, false)
  assert.match(result.message, /no longer accessible/)
})

test('native Windows Pi setup explains the Linux-filesystem route; Go and Linux Pi are allowed', () => {
  assert.throws(() => checkSourcePlatform('birdnet-pi', 'win32'), /colons.*WSL.*Linux filesystem.*not \/mnt\/c/)
  for (const platform of ['darwin', 'linux', 'win32']) assert.doesNotThrow(() => checkSourcePlatform('birdnet-go', platform))
  for (const platform of ['darwin', 'linux']) assert.doesNotThrow(() => checkSourcePlatform('birdnet-pi', platform))
})

test('startup checks both FFmpeg and FFprobe', async () => {
  const calls = []
  await checkAudioTools({ run: async (file, args, options) => {
    calls.push(file)
    assert.deepEqual(args, ['-version'])
    assert.equal(options.timeout, 5000)
  } })
  assert.deepEqual(calls.sort(), ['ffmpeg', 'ffprobe'])
})

for (const [platform, hint] of [['darwin', /brew install ffmpeg/], ['win32', /ffmpeg.exe and ffprobe.exe.*PATH/], ['linux', /sudo apt install ffmpeg/]]) {
  test(`${platform}: reports each unavailable audio tool and installation instructions`, async () => {
    for (const missing of [['ffmpeg'], ['ffprobe'], ['ffmpeg', 'ffprobe']]) {
      await assert.rejects(checkAudioTools({ platform, run: async (file) => {
        if (missing.includes(file)) throw new Error('unavailable')
      } }), (error) => {
        assert.ok(error.message.includes(`could not run: ${missing.join(', ')}.`))
        assert.match(error.message, hint)
        return true
      })
    }
  })
}
