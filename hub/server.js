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
  dirtHost: process.env.DIRT_HOST || '127.0.0.1',
  dirtPort: +(process.env.DIRT_PORT || 57120),
  httpPort: +(process.env.HTTP_PORT || 49170),
  latency: +(process.env.LATENCY || 0.2),
  samplesDir: process.env.DIRT_SAMPLES || path.join(os.homedir(), 'Library/Application Support/SuperCollider/downloaded-quarks/Dirt-Samples'),
  preset: path.join(__dirname, 'presets', 'current.json')
}

// Synths verified to load without sc3plugins (sc/start_dirt.scd, 2026-11-04) + SuperDirt core synths
const SYNTHS = ['superhammond', 'supervibe', 'supermandolin', 'supersquare', 'superreese', 'superhoover', 'superzow', 'supertron',
  'supergong', 'superfork', 'supersiren', 'superstatic', 'superkick', 'super808', 'supersnare', 'superhat', 'superclap',
  'supercomparator', 'supergrind', 'superprimes', 'superwavemechanics', 'soskick', 'soshats', 'sostoms', 'sossnare',
  'imp', 'psin', 'pmsin', 'gabor', 'cyclo']
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
    slots: DEFAULT_SOUNDS.map((s, i) => ({ id: i.toString(16), sound: s, n: 0, orbit: i >= 12 ? 1 : 0, mute: false, sustain: 0.3, params: [] })),
    orbits: [0, 1, 2, 3].map(o => ({ orbit: o, params: [] }))
  }
}
let state = defaultState()
try { state = Object.assign(defaultState(), JSON.parse(fs.readFileSync(CFG.preset, 'utf8'))) } catch (e) { /* first run */ }
let saveTimer = null
function save () {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => fs.writeFile(CFG.preset, JSON.stringify(state, null, 1), () => {}), 400)
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
function play (slotIdx, ev, raw) {
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
  if (!s.mute) out.send(bundle(CFG.latency, oscMsg('/dirt/play', o.map(([k, v]) => [k, v]))), CFG.dirtPort, CFG.dirtHost)
  broadcast('hit', { slot: slotIdx, raw, out: o, t, n: seed, muted: !!s.mute })
}
function playDirect (ev, raw) {
  const o = [['s', ev.s], ['n', ev.n], ['orbit', 0]]
  out.send(bundle(CFG.latency, oscMsg('/dirt/play', o)), CFG.dirtPort, CFG.dirtHost)
  broadcast('hit', { slot: -1, raw, out: o, t: now() })
}

const inp = dgram.createSocket('udp4')
inp.on('message', (m) => {
  for (const raw of m.toString().split(';').map(x => x.trim()).filter(Boolean)) {
    const ev = parse(raw)
    if (ev.type === 'note') play(ev.slot, ev, raw)
    else if (ev.type === 'sample') playDirect(ev, raw)
    else if (ev.type === 'bpm') { state.bpm = ev.bpm; save(); broadcast('state', { state }) }
    else broadcast('hit', { slot: -1, raw, out: null, t: now(), ignored: true })
  }
})
inp.on('error', (e) => { console.error(`UDP ${CFG.inPort}: ${e.message}`); process.exit(1) })
inp.bind(CFG.inPort)

// ---------- HTTP + SSE ----------
const clients = new Set()
function broadcast (type, data) {
  const line = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
  for (const c of clients) c.write(line)
}
setInterval(() => broadcast('status', status()), 1000)
const status = () => ({ dirt: Date.now() - dirtSeen < 5000, inPort: CFG.inPort, dirtPort: CFG.dirtPort, latency: CFG.latency, t0: T0, bpm: state.bpm })

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
  if (req.method === 'POST' && url === '/api/bpm') {
    const b = await body(req); if (b.bpm >= 20 && b.bpm <= 300) state.bpm = +b.bpm; save()
    broadcast('state', { state, origin: b.origin }); return send(res, 200, { ok: true })
  }
  send(res, 404, { error: 'not found' })
}).listen(CFG.httpPort, '127.0.0.1', () => {
  console.log(`DirtRelay in udp:${CFG.inPort}  ->  ${CFG.dirtHost}:${CFG.dirtPort}  latency ${CFG.latency}s`)
  console.log(`GUI       http://127.0.0.1:${CFG.httpPort}/`)
  console.log(`sounds    ${SYNTHS.length} synths, ${SAMPLES.length} sample banks`)
})
