// Shared modulation math (server + browser). A bar = 4 beats at the given BPM.
(function (root) {
  const SHAPES = ['const', 'sine', 'saw', 'tri', 'square', 'rand', 'perlin'];
  const GLYPH = { const: '—', sine: '∿', saw: '⟋', tri: '△', square: '⊓', rand: '⁘', perlin: '≈' };
  const hsh = (x) => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s) };
  const perl = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hsh(i) * (1 - u) + hsh(i + 1) * u };
  function wave (sh, ph, seed) {
    const p = ((ph % 1) + 1) % 1;
    switch (sh) {
      case 'sine': return 0.5 - 0.5 * Math.cos(p * 2 * Math.PI);
      case 'saw': return p;
      case 'tri': return p < 0.5 ? p * 2 : 2 - p * 2;
      case 'square': return p < 0.5 ? 0 : 1;
      case 'rand': return hsh(seed);
      case 'perlin': return perl(ph * 4);
    }
    return 0;
  }
  const barSec = (bpm) => 240 / (bpm || 120);
  function val (p, t, bpm, seed) {
    if (p.shape === 'const') return +p.fix;
    return +p.min + (p.max - p.min) * wave(p.shape, t / (barSec(bpm) * (p.bars || 1)), seed);
  }
  const W = { SHAPES, GLYPH, wave, val, barSec };
  if (typeof module !== 'undefined') module.exports = W; else root.W = W;
})(this);
