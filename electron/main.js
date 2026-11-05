// DirtRelay desktop app: runs the relay (hub/server.js) in the main process, shows its GUI,
// and starts SuperDirt (sc/start_dirt.scd) in the background when none is answering on 57120.
'use strict'
const { app, BrowserWindow, Menu, dialog, screen, shell, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const dgram = require('dgram')
const { spawn, execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const SC_SUPPORT = path.join(os.homedir(), 'Library/Application Support/SuperCollider')
const SCLANG = '/Applications/SuperCollider.app/Contents/MacOS/sclang'

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0) }

// Presets live in userData (the app bundle is read-only). First run seeds them from the repo default.
const presetFile = path.join(app.getPath('userData'), 'presets', 'current.json')
if (!fs.existsSync(presetFile)) {
  fs.mkdirSync(path.dirname(presetFile), { recursive: true })
  const seed = path.join(ROOT, 'hub', 'presets', 'current.json')
  if (fs.existsSync(seed)) fs.copyFileSync(seed, presetFile)
}
process.env.DIRTRELAY_PRESET = presetFile

let win = null
let sc = null // sclang child we started
let scState = 'idle'
const logFile = path.join(app.getPath('userData'), 'superdirt.log')

// ---------- settings (output device) ----------
const settingsFile = path.join(app.getPath('userData'), 'settings.json')
function loadSettings () { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')) } catch (e) { return {} } }
let settings = loadSettings()
function saveSettings () { try { fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)) } catch (e) {} }

// CoreAudio output devices, as SuperCollider names them (system_profiler uses the same names).
let outDevices = []
function scanOutDevices () {
  try {
    const j = JSON.parse(execFileSync('system_profiler', ['SPAudioDataType', '-json'], { timeout: 8000 }).toString())
    const items = (j.SPAudioDataType || []).flatMap(x => x._items || [])
    outDevices = items.filter(d => d.coreaudio_device_output).map(d => ({
      name: d._name,
      isDefault: d.coreaudio_default_audio_output_device === 'spaudio_yes'
    }))
  } catch (e) { outDevices = [] }
}
function setOutDevice (name) {
  settings.outDevice = name || null
  saveSettings()
  buildMenu()
  if (sc) restartDirt()
}

// ---------- SuperDirt ----------
function encodeHello () {
  const pad = (b) => Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))])
  return Buffer.concat([pad(Buffer.from('/dirt/hello')), pad(Buffer.from(','))])
}
function dirtAnswers (port, timeout = 1500) {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4')
    const done = (v) => { clearTimeout(t); try { s.close() } catch (e) {} resolve(v) }
    const t = setTimeout(() => done(false), timeout)
    s.on('message', (m) => { if (m.toString().startsWith('/dirt/hello/reply')) done(true) })
    s.on('error', () => done(false))
    s.bind(0, () => s.send(encodeHello(), port, '127.0.0.1'))
  })
}

function startDirt () {
  if (sc) return
  if (!fs.existsSync(SCLANG)) {
    dialog.showMessageBox({ type: 'warning', message: 'SuperCollider not found', detail: `${SCLANG} is missing. Install SuperCollider, or start SuperDirt yourself.` })
    return
  }
  // Run sclang with a private HOME so the user's own startup.scd does not also boot a server.
  const home = path.join(app.getPath('userData'), 'sc-home')
  fs.mkdirSync(home, { recursive: true })
  // Class library config: the user's include paths (quarks) + the user's Extensions folder
  // (the private HOME hides ~/Library/Application Support/SuperCollider/Extensions, e.g. sc3plugins).
  const ext = path.join(SC_SUPPORT, 'Extensions')
  const include = []
  const conf = path.join(SC_SUPPORT, 'sclang_conf.yaml')
  if (fs.existsSync(conf)) {
    let inInc = false
    for (const line of fs.readFileSync(conf, 'utf8').split('\n')) {
      if (/^includePaths:/.test(line)) { inInc = true; continue }
      if (/^\S/.test(line)) inInc = false
      const m = inInc && /^\s*-\s+(.+?)\s*$/.exec(line)
      if (m) include.push(m[1].replace(/^['"]|['"]$/g, ''))
    }
  }
  if (fs.existsSync(ext)) include.push(ext)
  const myConf = path.join(home, 'sclang_conf.yaml')
  fs.writeFileSync(myConf, 'includePaths:\n' + include.map(p => `    -   ${JSON.stringify(p)}`).join('\n') + '\nexcludePaths: []\npostInlineWarnings: false\nexcludeDefaultPaths: false\n')
  const args = ['-l', myConf]
  args.push(path.join(ROOT, 'sc', 'start_dirt.scd'))
  const log = fs.createWriteStream(logFile, { flags: 'w' })
  sc = spawn(SCLANG, args, {
    cwd: path.join(ROOT, 'sc'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { HOME: home, DIRT_QUARKS: path.join(SC_SUPPORT, 'downloaded-quarks'), DIRT_EXTENSIONS: ext }, settings.outDevice ? { DIRT_OUTDEVICE: settings.outDevice } : {})
  })
  scState = 'starting'
  sc.stdout.pipe(log); sc.stderr.pipe(log)
  sc.stdout.on('data', (d) => { if (String(d).includes('HUB: SuperDirt ready')) { scState = 'running'; buildMenu() } })
  sc.on('exit', () => { sc = null; scState = 'idle'; buildMenu() })
  buildMenu()
}

function stopDirt () {
  if (!sc) return
  const pid = sc.pid
  try { // scsynth is a child of our sclang; stop it explicitly so it does not linger
    const kids = execFileSync('pgrep', ['-P', String(pid), 'scsynth']).toString().trim().split('\n').filter(Boolean)
    kids.forEach(k => { try { process.kill(+k, 'SIGTERM') } catch (e) {} })
  } catch (e) { /* none */ }
  try { sc.kill('SIGTERM') } catch (e) {}
  sc = null; scState = 'idle'
}

async function restartDirt () {
  stopDirt()
  setTimeout(startDirt, 1500)
}

// ---------- window / menu ----------
function createWindow (port) {
  // ORCA-like: no title bar, no minimise/maximise, drag anywhere that is not a control; size follows content.
  win = new BrowserWindow({
    width: 660,
    height: 600,
    useContentSize: true,
    frame: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    resizable: false,
    backgroundColor: '#000000',
    title: 'DirtRelay',
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') }
  })
  win.loadURL(`http://127.0.0.1:${port}/`)
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  win.on('closed', () => { win = null })
}

function buildMenu () {
  const label = { idle: 'stopped', starting: 'starting…', running: 'running (started by DirtRelay)' }[scState]
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'SuperDirt',
      submenu: [
        { label: `Status: ${label}`, enabled: false },
        { type: 'separator' },
        { label: 'Start SuperDirt', enabled: !sc, click: startDirt },
        { label: 'Restart SuperDirt', enabled: !!sc, accelerator: 'CmdOrCtrl+Shift+R', click: restartDirt },
        { label: 'Stop SuperDirt', enabled: !!sc, click: () => { stopDirt(); buildMenu() } },
        { type: 'separator' },
        {
          label: 'Output Device',
          submenu: [
            { label: 'System Default (at start)', type: 'radio', checked: !settings.outDevice, click: () => setOutDevice(null) },
            { type: 'separator' },
            ...outDevices.map(d => ({ label: d.name + (d.isDefault ? '  (current default)' : ''), type: 'radio', checked: settings.outDevice === d.name, click: () => setOutDevice(d.name) })),
            ...(settings.outDevice && !outDevices.some(d => d.name === settings.outDevice) ? [{ label: settings.outDevice + '  (not connected)', type: 'radio', checked: true, enabled: false }] : []),
            { type: 'separator' },
            { label: 'Rescan Devices', click: () => { scanOutDevices(); buildMenu() } }
          ]
        },
        { type: 'separator' },
        { label: 'Open SuperDirt Log', click: () => shell.openPath(logFile) },
        { label: 'Open Presets Folder', click: () => shell.openPath(path.dirname(presetFile)) }
      ]
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    },
    { role: 'windowMenu' }
  ]))
}

ipcMain.on('fit', (e, w, h) => {
  if (!win) return
  const wa = screen.getDisplayMatching(win.getBounds()).workAreaSize
  const [cw, ch] = win.getContentSize()
  const nw = Math.min(Math.max(w, 420), wa.width), nh = Math.min(Math.max(h, 200), wa.height)
  if (cw !== nw || ch !== nh) win.setContentSize(nw, nh)
})

// ---------- lifecycle ----------
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })

app.whenReady().then(async () => {
  scanOutDevices()
  buildMenu()
  let relay
  try {
    relay = require(path.join(ROOT, 'hub', 'server.js'))
  } catch (e) {
    dialog.showErrorBox('DirtRelay', `Relay failed to start:\n${e.message}`); app.quit(); return
  }
  relay.events.on('fatal', (msg) => {
    dialog.showErrorBox('DirtRelay', `${msg}\n\nAnother app (an old DirtRelay, Pilot, …) may be using this port.`)
    app.quit()
  })
  relay.events.once('ready', () => createWindow(relay.CFG.httpPort))
  if (!(await dirtAnswers(relay.CFG.dirtPort))) startDirt()
})

app.on('activate', () => { if (!win && BrowserWindow.getAllWindows().length === 0) app.whenReady().then(() => createWindow(require(path.join(ROOT, 'hub', 'server.js')).CFG.httpPort)) })
app.on('window-all-closed', () => app.quit())
app.on('before-quit', stopDirt)
process.on('SIGTERM', () => app.quit())
