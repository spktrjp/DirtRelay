// DirtRelay: ORCA ";" strings (UDP) -> SuperDirt /dirt/play (OSC bundles), with a slot GUI over HTTP + SSE.
// No external dependencies. Spec notes: docs/01_SuperDirt受信仕様.md, docs/02_ハブ要件メモ.md
'use strict'
const dgram = require('dgram')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const W = require('./public/wave.js')

const CFG = {
  inPort: +(process.env.IN_PORT || 49161),
  oscPort: +(process.env.OSC_PORT || 49162),
  tidalPort: +(process.env.TIDAL_PORT || 57130), // set Tidal's superdirtTarget oPort to this
  dirtHost: process.env.DIRT_HOST || '127.0.0.1',
  dirtPort: +(process.env.DIRT_PORT || 57120),
  httpPort: +(process.env.HTTP_PORT || 49170),
  latency: process.env.LATENCY ? +process.env.LATENCY : null, // null = use preset (default 0.2)
  samplesDir: process.env.DIRT_SAMPLES || path.join(os.homedir(), 'Library/Application Support/SuperCollider/downloaded-quarks/Dirt-Samples'),
  preset: process.env.DIRTRELAY_PRESET || path.join(__dirname, 'presets', 'current.json')
}
const events = new (require('events'))()
module.exports = { CFG, events }
function fatal (msg) { console.error(msg); if (require.main === module) process.exit(1); else events.emit('fatal', msg) }

// Synths verified to load (sc/start_dirt.scd, 2026-11-04) + SuperDirt core synths
const SYNTHS = ['superhammond', 'supervibe', 'supermandolin', 'supersquare', 'superreese', 'superhoover', 'superzow', 'supertron',
  'supergong', 'superfork', 'supersiren', 'superstatic', 'superkick', 'super808', 'supersnare', 'superhat', 'superclap',
  'supercomparator', 'supergrind', 'superprimes', 'superwavemechanics', 'soskick', 'soshats', 'sostoms', 'sossnare',
  'imp', 'psin', 'pmsin', 'gabor', 'cyclo',
  // need sc3-plugins (installed 2026-11-04, SC3plugins 3.14.1)
  'superpiano', 'supersaw', 'superfm', 'superhex', 'superpwm', 'superchip', 'supernoise']
let SAMPLES = []
try {
  SAMPLES = fs.readdirSync(CFG.samplesDir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => ({ name: d.name, count: fs.readdirSync(path.join(CFG.samplesDir, d.name)).filter(f => /\.(wav|aiff?|flac)$/i.test(f)).length }))
    .sort((a, b) => a.name.localeCompare(b.name))
} catch (e) { console.warn('samples dir not readable:', CFG.samplesDir) }
const isSample = (name) => SAMPLES.some(s => s.name === name)

// ---------- state ----------
const DEFAULT_SOUNDS = ['superhammond', 'supervibe', 'supermandolin', 'supersquare', 'superreese', 'superhoover', 'superzow', 'supertron',
  'supergong', 'superfork', 'supersiren', 'superstatic', 'superkick', 'super808', 'supersnare', 'superhat']
function defaultState () {
  return {
    bpm: 120,
    input: 'udp', // 'udp' = ORCA UDP (;), 'osc' = DirtRelay OSC, 'tidal' = Tidal relay
    latency: 0.2, // s. Native SC 3.14 (arm64): 0 late notes at 0.1–0.2. Under SC 3.12/Rosetta use ~0.5
    slots: DEFAULT_SOUNDS.map((s, i) => ({ id: i.toString(16), sound: s, n: 0, orbit: i >= 12 ? 1 : 0, mute: false, sustain: 0.3, params: [] })),
    orbits: [0, 1, 2, 3].map(o => ({ orbit: o, params: [] }))
  }
}
let state = defaultState()
try { state = Object.assign(defaultState(), JSON.parse(fs.readFileSync(CFG.preset, 'utf8'))) } catch (e) { /* first run */ }
if (CFG.latency != null) state.latency = CFG.latency
if (!(state.latency > 0)) state.latency = 0.2
let saveTimer = null
function save () {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { fs.mkdirSync(path.dirname(CFG.preset), { recursive: true }); fs.writeFile(CFG.preset, JSON.stringify(state, null, 1), () => {}) }, 400)
}
const T0 = Date.now()
const now = () => (Date.now() - T0) / 1000
const counters = state.slots.map(() => 0)

// ---------- OSC ----------
const pad = (b) => Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))])
const oscStr = (s) => pad(Buffer.from(String(s)))
const INT_KEYS = new Set(['orbit', 'cut'])
function oscMsg (addr, pairs) {
  const args = pairs.flat()
  const tags = ',' + args.map((a, i) => typeof a === 'string' ? 's' : (i % 2 === 1 && INT_KEYS.has(args[i - 1])) ? 'i' : 'f').join('')
  const body = args.map((a, i) => {
    if (typeof a === 'string') return oscStr(a)
    const b = Buffer.alloc(4)
    if (tags[i + 1] === 'i') b.writeInt32BE(Math.round(a)); else b.writeFloatBE(a)
    return b
  })
  return Buffer.concat([oscStr(addr), oscStr(tags), ...body])
}
function bundle (secFromNow, msg) {
  const t = Date.now() / 1000 + secFromNow + 2208988800
  const tt = Buffer.alloc(8); tt.writeUInt32BE(Math.floor(t)); tt.writeUInt32BE(Math.floor((t % 1) * 2 ** 32), 4)
  const sz = Buffer.alloc(4); sz.writeInt32BE(msg.length)
  return Buffer.concat([oscStr('#bundle'), tt, sz, msg])
}
const out = dgram.createSocket('udp4')
let dirtSeen = 0
out.on('message', (m) => { if (m.toString('utf8', 0, 16).startsWith('/dirt/hello/rep')) dirtSeen = Date.now() })
out.bind(0)
setInterval(() => out.send(oscMsg('/dirt/hello', []), CFG.dirtPort, CFG.dirtHost), 2000)

// ---------- parsing ORCA strings (Pilot-compatible) ----------
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz'
const int36 = (c) => B36.indexOf(String(c).toLowerCase())
const NOTE = { C: 0, c: 1, D: 2, d: 3, E: 4, e: 5, F: 5, f: 6, G: 7, g: 8, A: 9, a: 10, B: 11, b: 12 }
function parse (msg) {
  let m = /^([0-9a-zA-Z])([0-8])([a-gA-G])([0-9a-zA-Z])?([0-9a-zA-Z])?$/.exec(msg)
  if (m) {
    return { type: 'note', slot: int36(m[1]), note: NOTE[m[3]] + (+m[2] - 5) * 12,
      vel: m[4] ? Math.min(1, int36(m[4]) / 15) : null, len: m[5] ? int36(m[5]) / 15 : null }
  }
  m = /^bpm(\d{2,3})$/i.exec(msg)
  if (m) return { type: 'bpm', bpm: +m[1] }
  m = /^([a-z0-9]+)(?::(\d+))?$/.exec(msg)
  if (m && isSample(m[1])) return { type: 'sample', s: m[1], n: m[2] ? +m[2] : 0 }
  return { type: 'other' }
}

// ---------- play ----------
function play (slotIdx, ev, raw, extra = []) {
  const s = state.slots[slotIdx]
  if (!s) return
  const t = now(), seed = counters[slotIdx]++
  const sample = isSample(s.sound)
  const o = [['s', s.sound], ['orbit', s.orbit | 0]]
  if (sample) {
    if (s.n) o.push(['n', +s.n])
    if (ev.note) o.push(['speed', +(2 ** (ev.note / 12)).toFixed(4)])
  } else {
    o.push(['note', ev.note || 0])
    o.push(['sustain', ev.len != null ? +(ev.len * W.barSec(state.bpm)).toFixed(3) : +s.sustain || 0.3])
  }
  if (ev.vel != null) o.push(['amp', +(0.6 * ev.vel).toFixed(3)])
  const add = (p, k, mark) => { if (p.on) o.push([p.name, +W.val(p, t, state.bpm, seed + k).toFixed(4), mark]) }
  s.params.forEach((p, k) => add(p, k, 'm'))
  const orb = state.orbits[s.orbit | 0]
  if (orb) orb.params.forEach((p, k) => add(p, k, 'o'))
  for (const [k, v] of extra) { const j = o.findIndex(x => x[0] === k); if (j >= 0) o[j] = [k, v, 'x']; else o.push([k, v, 'x']) }
  if (!s.mute) out.send(bundle(state.latency, oscMsg('/dirt/play', o.map(([k, v]) => [k, v]))), CFG.dirtPort, CFG.dirtHost)
  broadcast('hit', { slot: slotIdx, raw, out: o, t, n: seed, muted: !!s.mute })
}
function playDirect (ev, raw) {
  const o = [['s', ev.s], ['n', ev.n], ['orbit', 0]]
  out.send(bundle(state.latency, oscMsg('/dirt/play', o)), CFG.dirtPort, CFG.dirtHost)
  broadcast('hit', { slot: -1, raw, out: o, t: now() })
}

function handleText (txt) {
  for (const raw of String(txt).split(';').map(x => x.trim()).filter(Boolean)) {
    const ev = parse(raw)
    if (ev.type === 'note') play(ev.slot, ev, raw)
    else if (ev.type === 'sample') playDirect(ev, raw)
    else if (ev.type === 'bpm') { state.bpm = ev.bpm; save(); broadcast('state', { state }) }
    else broadcast('hit', { slot: -1, raw, out: null, t: now(), ignored: true })
  }
}

// ---------- DirtRelay OSC: drive SuperDirt from any OSC tool (Max, Pd, TouchDesigner, …) ----------
// /dirtrelay "04C" ["c3C" ...]            same text as ORCA UDP, one message per string arg
// /dirtrelay/note slot oct semi [vel len]  numeric (semi 0-11, vel/len 0-1)
// /dirtrelay/play slot [key value …]       play a slot; any SuperDirt param overrides the slot's (e.g. note 7 cutoff 900)
// /dirtrelay/bpm bpm
// /dirt/play key value …                   raw SuperDirt event, relayed with the relay latency (monitored as slot -)
function oscDecode (b, out = []) {
  let i = 0
  const str = () => { const e = b.indexOf(0, i); const v = b.toString('utf8', i, e); i = (e + 4) & ~3; return v }
  const head = str()
  if (head === '#bundle') {
    i += 8
    while (i + 4 <= b.length) { const n = b.readInt32BE(i); i += 4; oscDecode(b.subarray(i, i + n), out); i += n }
    return out
  }
  const tags = str(), args = []
  for (const t of tags.slice(1)) {
    if (t === 'i') { args.push(b.readInt32BE(i)); i += 4 } else if (t === 'f') { args.push(b.readFloatBE(i)); i += 4 } else if (t === 's' || t === 'S') args.push(str())
    else if (t === 'd') { args.push(b.readDoubleBE(i)); i += 8 } else if (t === 'h') { args.push(Number(b.readBigInt64BE(i))); i += 8 } else if (t === 'T') args.push(1); else if (t === 'F') args.push(0)
  }
  out.push({ addr: head, args, types: tags.slice(1) })
  return out
}
const fmtRaw = (addr, args) => `${addr} ${args.map(a => typeof a === 'number' ? +a.toFixed(3) : a).join(' ')}`.trim()
function handleOsc (buf) {
  let msgs
  try { msgs = oscDecode(buf) } catch (e) { return broadcast('hit', { slot: -1, raw: 'bad OSC', out: null, t: now(), ignored: true }) }
  for (const { addr, args } of msgs) {
    const raw = fmtRaw(addr, args)
    if (addr === '/dirtrelay') args.filter(a => typeof a === 'string').forEach(handleText)
    else if (addr === '/dirtrelay/bpm' && args[0] >= 20) { state.bpm = Math.round(args[0]); save(); broadcast('state', { state }) }
    else if (addr === '/dirtrelay/note' && args.length >= 3) {
      play(args[0] | 0, { type: 'note', note: (args[2] | 0) + ((args[1] | 0) - 5) * 12, vel: args[3] ?? null, len: args[4] ?? null }, raw)
    } else if (addr === '/dirtrelay/play' && args.length >= 1) {
      const slot = typeof args[0] === 'string' ? int36(args[0]) : args[0] | 0
      const extra = []; for (let k = 1; k + 1 < args.length; k += 2) extra.push([String(args[k]), args[k + 1]])
      const nt = extra.find(x => x[0] === 'note')
      play(slot, { type: 'note', note: nt ? +nt[1] : 0, vel: null, len: null }, raw, extra.filter(x => x[0] !== 'note'))
    } else if (addr === '/dirt/play' && args.length >= 2) {
      const o = []; for (let k = 0; k + 1 < args.length; k += 2) o.push([String(args[k]), args[k + 1]])
      out.send(bundle(state.latency, oscMsg('/dirt/play', o)), CFG.dirtPort, CFG.dirtHost)
      broadcast('hit', { slot: -1, raw, out: o, t: now() })
    } else broadcast('hit', { slot: -1, raw, out: null, t: now(), ignored: true })
  }
}

// ---------- input protocol (switchable from the GUI) ----------
// ---------- Tidal relay: Tidal (oPort 57130) -> DirtRelay -> SuperDirt; replies go back to Tidal ----------
// Bundles are forwarded byte-for-byte (timetags kept) unless an orbit has DirtRelay effects ON,
// in which case those params are added/overridden in /dirt/play. /c_set goes Tidal -> scsynth directly.
const tfwd = dgram.createSocket('udp4')
let tidalAddr = null, tidalCount = 0
tfwd.on('message', (m) => { if (tidalAddr && inp && state.input === 'tidal') inp.send(m, tidalAddr.port, tidalAddr.address) })
tfwd.bind(0)
function oscEncodeTyped (addr, args, types) {
  const body = args.map((a, i) => {
    const t = types[i]
    if (t === 's' || t === 'S') return oscStr(a)
    if (t === 'i') { const b = Buffer.alloc(4); b.writeInt32BE(Math.round(a)); return b }
    if (t === 'd') { const b = Buffer.alloc(8); b.writeDoubleBE(a); return b }
    const b = Buffer.alloc(4); b.writeFloatBE(a); return b
  })
  return Buffer.concat([oscStr(addr), oscStr(',' + types.join('')), ...body])
}
function handleTidal (m, r) {
  tidalAddr = { address: r.address, port: r.port }
  let msgs = []
  try { msgs = oscDecode(m) } catch (e) {}
  const plays = msgs.filter(x => x.addr === '/dirt/play')
  let outBuf = m
  const isBundle = m.length >= 16 && m.toString('utf8', 0, 7) === '#bundle'
  const t = now()
  const injected = plays.map(p => {
    const kv = {}; for (let k = 0; k + 1 < p.args.length; k += 2) kv[p.args[k]] = k + 1
    const orb = state.orbits[kv.orbit != null ? p.args[kv.orbit] | 0 : 0]
    const add = orb ? orb.params.filter(q => q.on) : []
    if (!add.length) return null
    const args = p.args.slice(), types = p.types.split('')
    add.forEach((q, k) => {
      const v = +W.val(q, t, state.bpm, tidalCount + k).toFixed(4)
      if (kv[q.name] != null) { args[kv[q.name]] = v; types[kv[q.name]] = 'f' } else { args.push(q.name, v); types.push('s', 'f') }
    })
    return oscEncodeTyped('/dirt/play', args, types)
  })
  if (isBundle && plays.length === 1 && msgs.length === 1 && injected[0]) {
    const msg = injected[0], sz = Buffer.alloc(4); sz.writeInt32BE(msg.length)
    outBuf = Buffer.concat([m.subarray(0, 16), sz, msg]) // "#bundle\0" + original timetag
  }
  tfwd.send(outBuf, CFG.dirtPort, CFG.dirtHost)
  for (const p of plays) {
    tidalCount++
    const o = []; for (let k = 0; k + 1 < p.args.length; k += 2) o.push([p.args[k], p.args[k + 1]])
    const id = (o.find(x => x[0] === '_id_') || [])[1]
    const show = o.filter(x => !['_id_', 'cps', 'cycle', 'delta'].includes(x[0])).map(([k, v]) => `${k} ${typeof v === 'number' ? +v.toFixed(3) : v}`).join(' ')
    broadcast('hit', { slot: -1, raw: `d${id ?? '?'} ${show}`, out: o, t, tidal: true })
  }
}

const PROTOCOLS = { udp: { port: CFG.inPort, label: 'ORCA UDP', handle: (m) => handleText(m.toString()) },
  osc: { port: CFG.oscPort, label: 'DirtRelay OSC', handle: handleOsc },
  tidal: { port: CFG.tidalPort, label: 'Tidal', handle: handleTidal } }
let inp = null
function setInput (mode) {
  if (!PROTOCOLS[mode]) mode = 'udp'
  if (inp) { try { inp.close() } catch (e) {} }
  const p = PROTOCOLS[mode]
  inp = dgram.createSocket('udp4')
  inp.on('message', (m, r) => p.handle(m, r))
  inp.on('error', (e) => { broadcast('hit', { slot: -1, raw: `port ${p.port} in use`, out: null, t: now(), ignored: true }); if (!started) fatal(`UDP ${p.port}: ${e.message}`) })
  inp.bind(p.port, () => { started = true })
  state.input = mode
}
let started = false
setInput(state.input || 'udp')

// ---------- HTTP + SSE ----------
const clients = new Set()
function broadcast (type, data) {
  const line = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
  for (const c of clients) c.write(line)
}
setInterval(() => broadcast('status', status()), 1000)

// ---------- setups (save / load a whole setup as a file) ----------
// A setup is what makes up a piece: tempo, the 16 slots and the orbit mixer.
// Input protocol and latency belong to the machine, so they are not part of it.
const SETUP_FORMAT = 'dirtrelay-setup'
function getSetup () {
  return { format: SETUP_FORMAT, version: 1, bpm: state.bpm, slots: state.slots, orbits: state.orbits }
}
function loadSetup (obj) {
  if (!obj || typeof obj !== 'object') throw new Error('not a DirtRelay setup')
  if (obj.format && obj.format !== SETUP_FORMAT) throw new Error('not a DirtRelay setup')
  if (!Array.isArray(obj.slots) || !obj.slots.length) throw new Error('setup has no slots')
  const def = defaultState()
  const slots = def.slots.map((d, i) => {
    const x = obj.slots[i]
    if (!x || typeof x !== 'object') return d
    return Object.assign({}, d, x, { id: d.id, params: Array.isArray(x.params) ? x.params : [] })
  })
  const orbits = def.orbits.map((d, i) => {
    const x = Array.isArray(obj.orbits) ? obj.orbits[i] : null
    return x && typeof x === 'object' ? { orbit: d.orbit, params: Array.isArray(x.params) ? x.params : [] } : d
  })
  state.slots = slots
  state.orbits = orbits
  if (obj.bpm >= 20 && obj.bpm <= 300) state.bpm = +obj.bpm
  save()
  broadcast('state', { state })
  broadcast('status', status())
}
module.exports.getSetup = getSetup
module.exports.loadSetup = loadSetup
const status = () => ({ dirt: Date.now() - dirtSeen < 5000, input: state.input, inLabel: PROTOCOLS[state.input].label, inPort: PROTOCOLS[state.input].port, dirtPort: CFG.dirtPort, latency: state.latency, t0: T0, bpm: state.bpm })

function body (req) { return new Promise((resolve) => { let d = ''; req.on('data', c => { d += c }); req.on('end', () => { try { resolve(JSON.parse(d || '{}')) } catch (e) { resolve({}) } }) }) }
const send = (res, code, obj, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(obj) : obj) }
const STATIC = { '/': 'index.html', '/wave.js': 'wave.js' }

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0]
  if (req.method === 'GET' && STATIC[url]) {
    const f = STATIC[url]
    return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', f)), f.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8')
  }
  if (req.method === 'GET' && url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.write(`event: state\ndata: ${JSON.stringify({ state })}\n\n`)
    res.write(`event: status\ndata: ${JSON.stringify(status())}\n\n`)
    clients.add(res); req.on('close', () => clients.delete(res))
    return
  }
  if (req.method === 'GET' && url === '/api/sounds') return send(res, 200, { synths: SYNTHS, samples: SAMPLES })
  let m
  if (req.method === 'POST' && (m = /^\/api\/(slot|orbit)\/(\d+)$/.exec(url))) {
    const b = await body(req), list = m[1] === 'slot' ? state.slots : state.orbits, i = +m[2]
    if (!list[i] || !b.item) return send(res, 400, { error: 'bad target' })
    list[i] = b.item; save()
    broadcast('state', { state, origin: b.origin })
    return send(res, 200, { ok: true })
  }
  if (req.method === 'POST' && (m = /^\/api\/test\/(\d+)$/.exec(url))) {
    const i = +m[1]; play(i, { type: 'note', note: 0, vel: null, len: null }, `${(i).toString(16)}5C`)
    return send(res, 200, { ok: true })
  }
  if (req.method === 'POST' && url === '/api/input') {
    const b = await body(req); setInput(b.input); save()
    broadcast('status', status()); return send(res, 200, { ok: true, input: state.input })
  }
  if (req.method === 'POST' && url === '/api/latency') {
    const b = await body(req); if (b.latency >= 0.05 && b.latency <= 2) state.latency = +(+b.latency).toFixed(2); save()
    broadcast('status', status()); return send(res, 200, { ok: true, latency: state.latency })
  }
  if (req.method === 'POST' && url === '/api/bpm') {
    const b = await body(req); if (b.bpm >= 20 && b.bpm <= 300) state.bpm = +b.bpm; save()
    broadcast('state', { state, origin: b.origin }); return send(res, 200, { ok: true })
  }
  send(res, 404, { error: 'not found' })
}).on('error', (e) => fatal(`HTTP ${CFG.httpPort}: ${e.message}`)).listen(CFG.httpPort, '127.0.0.1', () => {
  events.emit('ready')
  console.log(`DirtRelay in ${PROTOCOLS[state.input].label}:${PROTOCOLS[state.input].port}  ->  ${CFG.dirtHost}:${CFG.dirtPort}  latency ${state.latency}s`)
  console.log(`GUI       http://127.0.0.1:${CFG.httpPort}/`)
  console.log(`sounds    ${SYNTHS.length} synths, ${SAMPLES.length} sample banks`)
})
