/* ============================================================
   AURA — Smart Home Orchestration Interface
   ============================================================ */

// 1. CONSTANTS & TOKENS
const TIMING = { micro: 180, sm: 320, md: 500, hero: 720 };
const EASE = {
  out: [0.22, 1, 0.36, 1],
  int: [0.32, 0.72, 0, 1],
};

// 2. AURA_STATE — Full data model
const AURA_STATE_INITIAL = {
  rooms: {
    living:   { light: true,  brightness: 80, colorTemp: 3200 },
    bedroom:  { light: true,  brightness: 60, colorTemp: 2700 },
    kitchen:  { light: true,  brightness: 90, colorTemp: 4000 },
    bathroom: { light: true,  brightness: 70, colorTemp: 3000 },
  },
  masterBrightness: 0.80,
  globalColorTemp: 3200,
  climate: { temperature: 21, humidity: 68, target: 21 },
  security: { mode: 'home' },
  scene: null,
  audio: { enabled: true },
  energy: {
    period: 'today',
    data: {
      today: [0.3,0.2,0.2,0.1,0.1,0.2,0.8,1.4,1.2,1.0,1.3,2.1,2.4,2.0,1.8,1.6,2.2,2.8,2.4,2.0,1.7,1.4,1.0,0.7],
      week:  [14,16,18,15,20,22,19,18,21,20,23,17,16,18,14,19,22,20,18,17,15,16,14,18,21,19,17,15],
      month: [480,510,490,520,500,470,490,530,515,495,505,490,510,525,488,502,515,498,488,510,502,495,508,512,498,485,520,505,490,510,495],
    }
  },
  devices: [
    { id: 'thermostat', name: 'Smart Thermostat', status: 'online', value: '21.4°C' },
    { id: 'hub',        name: 'Central Hub',      status: 'online', value: '14 nodes' },
    { id: 'lights',     name: 'Living Lights',    status: 'online', value: '80%' },
    { id: 'camera',     name: 'Front Camera',     status: 'online', value: 'Recording' },
    { id: 'door',       name: 'Door Sensor',      status: 'online', value: 'Locked' },
    { id: 'audio',      name: 'Audio System',     status: 'online', value: 'Standby' },
    { id: 'air',        name: 'Air Quality',      status: 'online', value: '23 AQI' },
    { id: 'blind',      name: 'Smart Blinds',     status: 'online', value: 'Open 60%' },
  ],
  insights: [
    'You save <strong>23%</strong> energy vs. similar homes',
    'Bedroom is <strong>warmer</strong> than usual — adjust?',
    'Front door open <strong>2h</strong> — unusual pattern',
    'Evening detected — preparing <strong>Cinema</strong> mode',
    'Air quality is <strong>excellent</strong> · 23 AQI',
    'Solar forecast: <strong>4.2 kWh</strong> expected today',
  ],
  scenes: {
    morning: { temp: 22, brightness: 0.70, colorTemp: 2700, secMode: 'home',  accent: 'var(--acc-l)', lights: {living:true,bedroom:true,kitchen:true,bathroom:false} },
    focus:   { temp: 20, brightness: 1.00, colorTemp: 5000, secMode: 'home',  accent: 'var(--acc-c)', lights: {living:true,bedroom:false,kitchen:false,bathroom:false} },
    cinema:  { temp: 19, brightness: 0.15, colorTemp: 2200, secMode: 'home',  accent: 'var(--acc-s)', lights: {living:true,bedroom:false,kitchen:false,bathroom:false} },
    sleep:   { temp: 18, brightness: 0.00, colorTemp: 2200, secMode: 'night', accent: 'oklch(0.55 0.08 240)', lights: {living:false,bedroom:false,kitchen:false,bathroom:false} },
  },
};

// 3. STORE — Reactive state (30 lines)
function createStore(initial) {
  const state = JSON.parse(JSON.stringify(initial));
  const subs = new Set();
  return {
    get: () => state,
    set(updates) {
      const merge = (target, src) => {
        for (const k in src) {
          if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
            if (!target[k]) target[k] = {};
            merge(target[k], src[k]);
          } else {
            target[k] = src[k];
          }
        }
      };
      merge(state, updates);
      subs.forEach(fn => fn(state));
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
const store = createStore(AURA_STATE_INITIAL);

// 4. UTILITIES
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mapRange = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);
const qs = (sel, ctx = document) => ctx.querySelector(sel);
const qsa = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const wait = ms => new Promise(r => setTimeout(r, ms));

// Spring solver
function createSpring(stiffness = 160, damping = 22) {
  let pos = 0, vel = 0, target = 0, raf = null;
  const listeners = [];
  const tick = () => {
    const dt = 1 / 60;
    const f = stiffness * (target - pos) - damping * vel;
    vel += f * dt;
    pos += vel * dt;
    listeners.forEach(fn => fn(pos));
    if (Math.abs(target - pos) > 0.001 || Math.abs(vel) > 0.001) {
      raf = requestAnimationFrame(tick);
    } else {
      pos = target; vel = 0;
      listeners.forEach(fn => fn(pos));
      raf = null;
    }
  };
  return {
    to(t) { target = t; if (!raf) raf = requestAnimationFrame(tick); },
    set(v) { pos = v; vel = 0; target = v; listeners.forEach(fn => fn(pos)); if (raf) { cancelAnimationFrame(raf); raf = null; } },
    onUpdate(fn) { listeners.push(fn); },
    get value() { return pos; },
  };
}

// Web Audio feedback
function createAudio() {
  let ctx = null;
  return {
    play(freq = 220, dur = 0.04, vol = 0.12) {
      if (!store.get().audio.enabled) return;
      try {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + dur + 0.01);
      } catch (e) { /* AudioContext blocked */ }
    },
  };
}
const audio = createAudio();

// OKLCH temperature color interpolation
function tempToOKLCH(kelvin) {
  const t = clamp((kelvin - 2200) / (6500 - 2200), 0, 1);
  if (t < 0.3) {
    const s = t / 0.3;
    const l = lerp(0.72, 0.85, s);
    const c = lerp(0.14, 0.12, s);
    const h = lerp(55, 70, s);
    return `oklch(${l.toFixed(2)} ${c.toFixed(2)} ${h.toFixed(0)})`;
  } else if (t < 0.7) {
    const s = (t - 0.3) / 0.4;
    const l = lerp(0.85, 0.92, s);
    const c = lerp(0.12, 0.03, s);
    const h = lerp(70, 85, s);
    return `oklch(${l.toFixed(2)} ${c.toFixed(2)} ${h.toFixed(0)})`;
  } else {
    const s = (t - 0.7) / 0.3;
    const l = lerp(0.92, 0.88, s);
    const c = lerp(0.03, 0.09, s);
    const h = lerp(85, 210, s);
    return `oklch(${l.toFixed(2)} ${c.toFixed(2)} ${h.toFixed(0)})`;
  }
}

// 5. INITIALIZATION

// ── Boot sequence ──
async function runBoot() {
  const boot = qs('#boot');
  const canvas = qs('#boot-canvas');
  const wordmark = qs('#boot-wordmark');
  const lettersEl = qs('#boot-letters');

  if (!canvas) return;

  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W; canvas.height = H;
  const ctx2d = canvas.getContext('2d');

  const isDark = document.documentElement.dataset.theme === 'dark';
  const lineColor = isDark ? 'oklch(0.95 0.005 255)' : 'oklch(0.18 0.015 255)';
  ctx2d.strokeStyle = lineColor;
  ctx2d.lineWidth = 0.8;
  ctx2d.lineCap = 'round';

  // House floorplan dimensions
  const cx = W / 2, cy = H / 2;
  const scale = Math.min(W, H) * 0.28;

  // Animate the outer rect and dividers
  let start = null;
  const totalDur = 900;

  await new Promise(resolve => {
    const animate = (ts) => {
      if (!start) start = ts;
      const elapsed = ts - start;
      const p = clamp(elapsed / totalDur, 0, 1);
      ctx2d.clearRect(0, 0, W, H);
      ctx2d.globalAlpha = 0.6;

      // Outer wall
      if (p > 0) {
        const rp = clamp(p * 2, 0, 1);
        const perimeter = 2 * (scale * 2 + scale * 1.5);
        let drawn = perimeter * rp;
        const rx = cx - scale, ry = cy - scale * 0.75;
        const rw = scale * 2, rh = scale * 1.5;

        ctx2d.beginPath();
        ctx2d.moveTo(rx, ry);
        const segs = [[rx+rw,ry],[rx+rw,ry+rh],[rx,ry+rh],[rx,ry]];
        let cx2 = rx, cy2 = ry;
        for (const [tx, ty] of segs) {
          const segLen = Math.hypot(tx - cx2, ty - cy2);
          if (drawn <= 0) break;
          if (drawn >= segLen) {
            ctx2d.lineTo(tx, ty);
            cx2 = tx; cy2 = ty;
            drawn -= segLen;
          } else {
            const t2 = drawn / segLen;
            ctx2d.lineTo(cx2 + (tx - cx2) * t2, cy2 + (ty - cy2) * t2);
            drawn = 0;
          }
        }
        ctx2d.stroke();
      }

      // Inner walls
      if (p > 0.5) {
        const ip = clamp((p - 0.5) * 2, 0, 1);
        ctx2d.globalAlpha = 0.4 * ip;
        const vp = clamp(ip * 1.5, 0, 1);
        ctx2d.beginPath();
        ctx2d.moveTo(cx, cy - scale * 0.75);
        ctx2d.lineTo(cx, cy - scale * 0.75 + (scale * 0.85) * vp);
        ctx2d.stroke();
        const hp = clamp((ip - 0.3) * 1.5, 0, 1);
        if (hp > 0) {
          ctx2d.beginPath();
          ctx2d.moveTo(cx - scale, cy + scale * 0.1);
          ctx2d.lineTo(cx - scale + scale * 2 * hp, cy + scale * 0.1);
          ctx2d.stroke();
        }
      }

      // Room glow dots
      if (p > 0.75) {
        const gp = clamp((p - 0.75) * 4, 0, 1);
        ctx2d.globalAlpha = gp * 0.15;
        const roomCenters = [
          [cx - scale * 0.5, cy - scale * 0.3],
          [cx + scale * 0.5, cy - scale * 0.3],
          [cx - scale * 0.5, cy + scale * 0.3],
          [cx + scale * 0.5, cy + scale * 0.3],
        ];
        for (const [rx, ry] of roomCenters) {
          const grad = ctx2d.createRadialGradient(rx, ry, 0, rx, ry, scale * 0.35);
          grad.addColorStop(0, isDark ? 'rgba(255,200,80,0.8)' : 'rgba(200,140,40,0.6)');
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx2d.fillStyle = grad;
          ctx2d.beginPath();
          ctx2d.arc(rx, ry, scale * 0.35, 0, Math.PI * 2);
          ctx2d.fill();
        }
      }

      ctx2d.globalAlpha = 1;
      if (p < 1) requestAnimationFrame(animate);
      else resolve();
    };
    requestAnimationFrame(animate);
  });

  // Show AURA wordmark
  const letters = 'AURA'.split('');
  lettersEl.innerHTML = letters.map(l => `<span style="font-variation-settings:'wght' 100">${l}</span>`).join('');
  wordmark.style.opacity = '1';

  // Animate letter weights
  await wait(80);
  const spans = lettersEl.querySelectorAll('span');
  spans.forEach((span, i) => {
    setTimeout(() => {
      span.style.fontVariationSettings = "'wght' 500";
    }, i * 60);
  });

  await wait(600);

  // Retract boot
  boot.style.transition = 'opacity 0.4s ease';
  canvas.style.transition = 'opacity 0.3s ease';
  canvas.style.opacity = '0';
  wordmark.style.transition = 'opacity 0.3s ease, transform 0.5s cubic-bezier(0.22,1,0.36,1)';
  wordmark.style.opacity = '0';
  wordmark.style.transform = 'scale(0.5) translate(-40vw, -40vh)';

  await wait(400);
  boot.style.opacity = '0';
  await wait(420);
  boot.style.display = 'none';

  // Animate hero headline
  qsa('.hw').forEach((el, i) => {
    setTimeout(() => el.classList.add('visible'), 80 + i * 120);
  });
}

// ── Theme ──
function initTheme() {
  const saved = localStorage.getItem('aura-theme');
  const prefer = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const theme = saved || prefer;
  document.documentElement.dataset.theme = theme;
}

function toggleTheme(ev) {
  const current = document.documentElement.dataset.theme;
  const next = current === 'dark' ? 'light' : 'dark';
  const ripple = qs('#theme-ripple');
  const btn = qs('#theme-btn');
  const rect = btn.getBoundingClientRect();
  const rx = ((rect.left + rect.width / 2) / window.innerWidth * 100).toFixed(1) + '%';
  const ry = ((rect.top + rect.height / 2) / window.innerHeight * 100).toFixed(1) + '%';
  ripple.style.setProperty('--rx', rx);
  ripple.style.setProperty('--ry', ry);

  // Update ripple background to new theme canvas color
  ripple.style.background = next === 'dark' ? 'oklch(0.14 0.015 255)' : 'oklch(0.97 0.010 85)';
  ripple.classList.add('expanding');

  setTimeout(() => {
    document.documentElement.dataset.theme = next;
    localStorage.setItem('aura-theme', next);
    ripple.classList.remove('expanding');
    ripple.style.clipPath = 'circle(0% at 50% 50%)';
  }, 620);

  // Theme button icon morph
  const moon = btn.querySelector('.moon-path');
  const spokes = btn.querySelector('.sun-spokes');
  if (next === 'dark') {
    moon.style.opacity = '1';
    spokes.style.opacity = '0';
  } else {
    moon.style.opacity = '0';
    spokes.style.opacity = '1';
  }
}

// ── Smooth scroll (Lenis-like) ──
function initSmoothScroll() {
  let current = window.scrollY, target = window.scrollY, ticking = false;
  const LERP_FACTOR = 0.12;

  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return; // Allow pinch zoom
    target = clamp(target + e.deltaY, 0, document.body.scrollHeight - window.innerHeight);
  }, { passive: true });

  const tick = () => {
    current = lerp(current, target, LERP_FACTOR);
    if (Math.abs(current - target) < 0.5) current = target;
    // Use scrollTop on documentElement for compatibility
    window.scrollTo({ top: current, behavior: 'instant' });
    updateScrollDependents(current);
    ticking = false;
    if (Math.abs(current - target) > 0.5) requestAnimationFrame(tick);
    else ticking = false;
  };

  const schedTick = () => { if (!ticking) { ticking = true; requestAnimationFrame(tick); } };

  window.addEventListener('wheel', schedTick, { passive: true });
  window.addEventListener('scroll', () => {
    target = window.scrollY;
    updateScrollDependents(window.scrollY);
  }, { passive: true });
}

function updateScrollDependents(scrollY) {
  // Nav scroll state
  const nav = qs('#nav');
  if (scrollY > 40) nav.classList.add('scrolled');
  else nav.classList.remove('scrolled');

  // Progress bar
  const max = document.body.scrollHeight - window.innerHeight;
  const pct = max > 0 ? (scrollY / max) * 100 : 0;
  const prog = qs('#nav-progress');
  if (prog) prog.style.width = pct + '%';
}

// 6. MODULES

// ── Custom cursor ──
function initCursor() {
  if (!window.matchMedia('(hover: hover)').matches) return;
  const dot = qs('#c-dot'), ring = qs('#c-ring'), label = qs('#c-label');
  if (!dot || !ring) return;

  let mx = -100, my = -100, rx = -100, ry = -100;
  const RING_LAG = 0.12;

  document.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; });

  // Update target on cursor element
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-cursor]');
    const cursor = el?.dataset.cursor;
    if (cursor && cursor !== 'adjust') {
      const labels = { explore: 'EXPLORE', activate: 'ACTIVATE', inspect: 'INSPECT', expand: 'EXPAND', close: 'CLOSE', navigate: 'GO', toggle: 'TOGGLE' };
      const lbl = labels[cursor] || cursor.toUpperCase();
      label.textContent = lbl;
      ring.classList.add('expanded');
    } else {
      label.textContent = '';
      ring.classList.remove('expanded');
    }
  });

  // raf loop for lerp
  const frame = () => {
    dot.style.left = mx + 'px';
    dot.style.top = my + 'px';
    rx = lerp(rx, mx, RING_LAG);
    ry = lerp(ry, my, RING_LAG);
    ring.style.left = rx + 'px';
    ring.style.top = ry + 'px';
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ── Magnetic elements ──
function initMagnetic() {
  const RADIUS = 80, STRENGTH = 0.22;
  document.addEventListener('mousemove', (e) => {
    qsa('[data-mag]').forEach(el => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dx = e.clientX - cx, dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < RADIUS) {
        el.style.setProperty('--mag-x', `${dx * STRENGTH}px`);
        el.style.setProperty('--mag-y', `${dy * STRENGTH}px`);
      } else {
        el.style.setProperty('--mag-x', '0px');
        el.style.setProperty('--mag-y', '0px');
      }
    });
  });
}

// ── 3D card tilt ──
function initTilt() {
  const MAX_TILT = 6;
  document.querySelectorAll('.dev-card').forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      const rx = -y * MAX_TILT, ry = x * MAX_TILT;
      card.style.transform = `perspective(600px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(0px)`;
      card.style.setProperty('--glow-x', `${(x + 0.5) * 100}%`);
      card.style.setProperty('--glow-y', `${(y + 0.5) * 100}%`);
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  });
}

// ── Intersection Observer reveals ──
function initReveal() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });

  qsa('.reveal-item').forEach(el => io.observe(el));

  // Device cards staggered
  const cardIO = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const cards = qsa('.dev-card');
        cards.forEach((c, i) => {
          setTimeout(() => c.classList.add('visible'), i * 55);
        });
        cardIO.disconnect();
      }
    });
  }, { threshold: 0.08 });
  const gallery = qs('.dev-gallery');
  if (gallery) cardIO.observe(gallery);

  // Sensor rows stagger
  const sensIO = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        qsa('.sensor-row').forEach((row, i) => {
          setTimeout(() => row.classList.add('visible'), i * 80);
        });
        sensIO.disconnect();
      }
    });
  }, { threshold: 0.3 });
  const sensEl = qs('.sensor-list');
  if (sensEl) sensIO.observe(sensEl);

  // Timeline
  const tlIO = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        tlIO.unobserve(e.target);
        // Grow timeline line
        const line = qs('#tl-line');
        if (line) line.style.height = '100%';
      }
    });
  }, { threshold: 0.15 });
  qsa('.tl-event').forEach(el => tlIO.observe(el));

  // Energy chart
  const chartIO = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        animateChart();
        chartIO.disconnect();
      }
    });
  }, { threshold: 0.3 });
  const chartEl = qs('.chart-wrap');
  if (chartEl) chartIO.observe(chartEl);
}

// ── Parallax ──
function initParallax() {
  const els = qsa('[data-parallax]');
  if (!els.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  window.addEventListener('scroll', () => {
    const sy = window.scrollY;
    els.forEach(el => {
      const factor = parseFloat(el.dataset.parallax);
      el.style.transform = `translate3d(0, ${sy * factor}px, 0)`;
    });
  }, { passive: true });
}

// 7. COMPONENTS

// ── Arc brightness slider ──
function initArcSlider() {
  const svg = qs('#arc-svg');
  if (!svg) return;
  const fillEl = qs('#arc-fill');
  const thumb = qs('#arc-thumb');
  const valEl = qs('#arc-val');

  const CX = 60, CY = 68, R = 52;
  let dragging = false;
  let p = store.get().masterBrightness;

  function arcPoint(pct) {
    const angle = Math.PI - pct * Math.PI;
    return {
      x: CX + R * Math.cos(angle),
      y: CY - R * Math.sin(angle),
    };
  }

  function update(pct) {
    p = clamp(pct, 0.02, 1);
    const pt = arcPoint(p);
    thumb.setAttribute('cx', pt.x.toFixed(2));
    thumb.setAttribute('cy', pt.y.toFixed(2));
    const largeArc = p > 0.5 ? 1 : 0;
    fillEl.setAttribute('d', `M10 68 A${R} ${R} 0 ${largeArc} 0 ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`);
    valEl.textContent = Math.round(p * 100) + '%';
    store.set({ masterBrightness: p });
    updateLightsStatus();
    audio.play(440 + p * 220, 0.03, 0.08);
  }

  function pctFromPointer(e) {
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * 120;
    const svgY = ((e.clientY - rect.top) / rect.height) * 72;
    const dx = svgX - CX, dy = -(svgY - CY);
    let angle = Math.atan2(dy, dx);
    if (angle < 0) angle += 2 * Math.PI;
    const pct = 1 - angle / Math.PI;
    return pct;
  }

  svg.addEventListener('pointerdown', (e) => {
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    update(pctFromPointer(e));
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    update(pctFromPointer(e));
  });
  svg.addEventListener('pointerup', () => { dragging = false; });

  // Init
  update(p);
}

// ── Color temperature strip ──
function initColorTempStrip() {
  const strip = qs('#ct-strip');
  const thumb = qs('#ct-thumb');
  const val = qs('#ct-val');
  if (!strip) return;

  let dragging = false;
  let currentTemp = 3200;

  function update(clientX) {
    const rect = strip.getBoundingClientRect();
    const t = clamp((clientX - rect.left) / rect.width, 0, 1);
    currentTemp = Math.round(lerp(2200, 6500, t));
    thumb.style.left = (t * 100) + '%';
    val.textContent = currentTemp + 'K';
    strip.setAttribute('aria-valuenow', currentTemp);
    store.set({ globalColorTemp: currentTemp });
    // Update thermostat tile tint
    updateClimateColor();
    audio.play(300 + t * 200, 0.025, 0.06);
  }

  strip.addEventListener('pointerdown', (e) => {
    dragging = true;
    strip.setPointerCapture(e.pointerId);
    update(e.clientX);
  });
  strip.addEventListener('pointermove', (e) => { if (dragging) update(e.clientX); });
  strip.addEventListener('pointerup', () => { dragging = false; });
  strip.addEventListener('keydown', (e) => {
    const rect = strip.getBoundingClientRect();
    const t = clamp((currentTemp - 2200) / 4300 + (e.key === 'ArrowRight' ? 0.02 : e.key === 'ArrowLeft' ? -0.02 : 0), 0, 1);
    update(rect.left + t * rect.width);
  });

  // Init position (3200K = ~24%)
  const initT = (3200 - 2200) / 4300;
  thumb.style.left = (initT * 100) + '%';
}

// ── Circular Thermostat ──
function initThermostat() {
  const svg = qs('#thermo-svg');
  if (!svg) return;
  const fillEl = qs('#thermo-fill');
  const humFill = qs('#hum-fill');
  const thumb = qs('#thermo-thumb');
  const tempTxt = qs('#thermo-temp');
  const humTxt = qs('#thermo-hum');

  const CX = 90, CY = 90, R = 75, HUM_R = 64;
  const CIRC = 2 * Math.PI * R;
  const HUM_CIRC = 2 * Math.PI * HUM_R;
  const SPAN_DEG = 270;
  const START_DEG = 135;

  let dragging = false;
  const tempSpring = createSpring(180, 22);

  function thumbPos(p) {
    const angle = (START_DEG + p * SPAN_DEG) * Math.PI / 180;
    return {
      x: CX + R * Math.cos(angle),
      y: CY + R * Math.sin(angle),
    };
  }

  function renderTemp(p) {
    const temp = 16 + p * 14;
    const arcLen = (SPAN_DEG / 360) * CIRC;
    const filled = p * arcLen;
    fillEl.setAttribute('stroke-dasharray', `${filled.toFixed(1)} 9999`);

    const humP = store.get().climate.humidity / 100;
    const humArcLen = (SPAN_DEG / 360) * HUM_CIRC;
    humFill.setAttribute('stroke-dasharray', `${(humP * humArcLen).toFixed(1)} 9999`);

    const pt = thumbPos(p);
    thumb.setAttribute('cx', pt.x.toFixed(2));
    thumb.setAttribute('cy', pt.y.toFixed(2));
    tempTxt.textContent = temp.toFixed(1) + '°';

    // Color shift with temperature
    const cold = 'oklch(0.72 0.12 220)', hot = 'oklch(0.78 0.15 50)';
    const tileClimate = qs('[data-domain="climate"]');
    if (tileClimate) {
      const bg = `oklch(${lerp(0.14, 0.17, p).toFixed(2)} ${lerp(0.015, 0.025, p).toFixed(3)} ${lerp(255, 80, p).toFixed(0)})`;
      if (document.documentElement.dataset.theme === 'dark') {
        tileClimate.style.background = bg;
      }
    }

    svg.setAttribute('aria-valuenow', Math.round(temp));
    store.set({ climate: { temperature: parseFloat(temp.toFixed(1)), target: parseFloat(temp.toFixed(1)) } });
  }

  tempSpring.onUpdate(renderTemp);

  // Init
  const initP = (store.get().climate.temperature - 16) / 14;
  tempSpring.set(initP);
  renderTemp(initP);

  function pFromPointer(e) {
    const rect = svg.getBoundingClientRect();
    const svgScale = 180 / rect.width;
    const svgX = (e.clientX - rect.left) * svgScale;
    const svgY = (e.clientY - rect.top) * svgScale;
    let angle = Math.atan2(svgY - CY, svgX - CX) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    // Convert to 0-1 based on 135° → 135°+270°
    let p;
    if (angle >= START_DEG) {
      p = (angle - START_DEG) / SPAN_DEG;
    } else if (angle <= (START_DEG + SPAN_DEG - 360)) {
      p = (angle + 360 - START_DEG) / SPAN_DEG;
    } else {
      // Dead zone (45° to 135°)
      p = angle < 90 ? 1 : 0;
    }
    return clamp(p, 0, 1);
  }

  svg.addEventListener('pointerdown', (e) => {
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    const p = pFromPointer(e);
    tempSpring.to(p);
    audio.play(200 + p * 300, 0.04, 0.08);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const p = pFromPointer(e);
    tempSpring.to(p);
  });
  svg.addEventListener('pointerup', () => { dragging = false; });
  svg.addEventListener('keydown', (e) => {
    const cur = (store.get().climate.temperature - 16) / 14;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') tempSpring.to(clamp(cur + 0.07, 0, 1));
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') tempSpring.to(clamp(cur - 0.07, 0, 1));
  });

  // AI suggest button
  const aiPill = qs('#ai-pill');
  if (aiPill) {
    aiPill.addEventListener('click', () => {
      const target = (21 - 16) / 14;
      tempSpring.to(target);
      audio.play(660, 0.06, 0.10);
    });
  }

  return { setTemp: (t) => tempSpring.to((t - 16) / 14) };
}

// ── Light toggles + floorplan sync ──
function initLightToggles() {
  qsa('.sw-input').forEach(input => {
    input.addEventListener('change', () => {
      const room = input.dataset.room;
      const on = input.checked;
      store.set({ rooms: { [room]: { light: on } } });
      updateRoomBloom(room, on);
      updateLightsStatus();
      audio.play(on ? 440 : 220, 0.04, 0.09);
      // Haptic flash
      input.closest('.sw-track')?.classList.add('flash');
      setTimeout(() => input.closest('.sw-track')?.classList.remove('flash'), 100);
    });
  });
}

function updateRoomBloom(room, on) {
  // Hero floorplan
  const heroBloom = qs(`#hero-fp .fp-bloom[data-room="${room}"]`);
  if (heroBloom) heroBloom.classList.toggle('off', !on);
  // Lights tile floorplan
  const tileBloom = qs(`#lfp .lfp-bloom[data-room="${room}"]`);
  if (tileBloom) tileBloom.classList.toggle('off', !on);
  // Update hero floorplan room glow
  updateHeroFP();
}

function updateHeroFP() {
  const rooms = store.get().rooms;
  Object.entries(rooms).forEach(([room, state]) => {
    const bloom = qs(`#hero-fp .fp-bloom[data-room="${room}"]`);
    if (bloom) bloom.classList.toggle('off', !state.light);
  });
}

function updateLightsStatus() {
  const rooms = store.get().rooms;
  const on = Object.values(rooms).filter(r => r.light).length;
  const total = Object.keys(rooms).length;
  const stat = qs('#lights-stat');
  if (stat) stat.textContent = on === total ? `${total} of ${total} on` : on === 0 ? 'All off' : `${on} of ${total} on`;
}

function updateClimateColor() {
  const fill = qs('#thermo-fill');
  const hum = qs('#hum-fill');
  const temp = store.get().climate.temperature;
  const p = (temp - 16) / 14;
  const hue = lerp(220, 50, p);
  const l = lerp(0.65, 0.78, p);
  const c = lerp(0.13, 0.16, p);
  const color = `oklch(${l.toFixed(2)} ${c.toFixed(2)} ${hue.toFixed(0)})`;
  if (fill) fill.style.stroke = color;
  if (hum) hum.style.stroke = color;
}

// ── Segmented control (Security) ──
function initSegControl() {
  const ctrl = qs('#seg-ctrl');
  if (!ctrl) return;
  const segs = qsa('.seg', ctrl);
  const ind = qs('.seg-ind', ctrl);

  function activate(seg) {
    segs.forEach(s => { s.classList.remove('active'); s.setAttribute('aria-checked', 'false'); });
    seg.classList.add('active');
    seg.setAttribute('aria-checked', 'true');
    const mode = seg.dataset.mode;
    store.set({ security: { mode } });
    updateSecStatus(mode);

    // Move indicator with FLIP
    const r = seg.getBoundingClientRect();
    const pr = ctrl.getBoundingClientRect();
    ind.style.left = (r.left - pr.left) + 'px';
    ind.style.width = r.width + 'px';

    audio.play(330, 0.05, 0.08);
  }

  segs.forEach(seg => {
    seg.addEventListener('click', () => activate(seg));
  });

  // Init
  const active = segs[0];
  setTimeout(() => {
    const r = active.getBoundingClientRect();
    const pr = ctrl.getBoundingClientRect();
    ind.style.left = (r.left - pr.left) + 'px';
    ind.style.width = r.width + 'px';
  }, 50);
}

function updateSecStatus(mode) {
  const stat = qs('#sec-stat');
  const msgs = { home: 'Secured', away: 'Monitoring', night: 'Night Mode' };
  if (stat) { stat.textContent = msgs[mode] || 'Active'; }
}

// ── Energy chart ──
function buildChartPath(data, W = 460, H = 100) {
  const max = Math.max(...data) * 1.15;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * W,
    y: H - (v / max) * H * 0.88,
  }));

  // Smooth bezier curve
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const cp1x = pts[i].x + (pts[i + 1].x - pts[i].x) / 3;
    const cp1y = pts[i].y;
    const cp2x = pts[i + 1].x - (pts[i + 1].x - pts[i].x) / 3;
    const cp2y = pts[i + 1].y;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`;
  }

  const fillD = d + ` L${pts[pts.length - 1].x},${H} L${pts[0].x},${H} Z`;
  return { linePath: d, fillPath: fillD, points: pts };
}

let chartPoints = [];

function animateChart() {
  const chart = qs('#en-chart');
  const linePath = qs('#ch-line');
  const fillPath = qs('#ch-fill');
  const clipRect = qs('#chart-clip-rect');
  if (!chart || !linePath) return;

  const data = store.get().energy.data[store.get().energy.period];
  const { linePath: ld, fillPath: fd, points: pts } = buildChartPath(data);
  chartPoints = pts;

  linePath.setAttribute('d', ld);
  fillPath.setAttribute('d', fd);

  // Animate clip rect width
  clipRect.setAttribute('width', 0);
  const dur = 1200;
  let start = null;
  const animate = (ts) => {
    if (!start) start = ts;
    const p = clamp((ts - start) / dur, 0, 1);
    const ep = 1 - Math.pow(1 - p, 3); // ease out cubic
    clipRect.setAttribute('width', (ep * 460).toFixed(1));
    if (p < 1) requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}

function initEnergyChart() {
  const chart = qs('#en-chart');
  const guide = qs('#ch-guide');
  const point = qs('#ch-point');
  const tooltip = qs('#ch-tip');
  if (!chart) return;

  chart.addEventListener('mousemove', (e) => {
    if (!chartPoints.length) return;
    const rect = chart.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 460;
    // Find closest point
    let closest = chartPoints[0], minD = Infinity;
    chartPoints.forEach(pt => {
      const d = Math.abs(pt.x - mx);
      if (d < minD) { minD = d; closest = pt; }
    });
    const idx = chartPoints.indexOf(closest);
    guide.setAttribute('x1', closest.x.toFixed(1));
    guide.setAttribute('x2', closest.x.toFixed(1));
    guide.setAttribute('opacity', '0.4');
    point.setAttribute('cx', closest.x.toFixed(1));
    point.setAttribute('cy', closest.y.toFixed(1));
    point.setAttribute('opacity', '1');

    const data = store.get().energy.data[store.get().energy.period];
    const tipTime = qs('.tip-time'), tipVal = qs('.tip-val');
    if (tipTime) tipTime.textContent = `${String(idx).padStart(2,'0')}:00`;
    if (tipVal) tipVal.textContent = `${data[idx]?.toFixed(1) || '--'} kWh`;

    const pctX = (closest.x / 460) * 100;
    const pctY = ((closest.y / 110) * 100);
    if (tooltip) {
      tooltip.style.left = `${pctX}%`;
      tooltip.style.top = `${pctY}%`;
      tooltip.classList.add('visible');
    }
  });
  chart.addEventListener('mouseleave', () => {
    guide.setAttribute('opacity', '0');
    point.setAttribute('opacity', '0');
    tooltip?.classList.remove('visible');
  });

  // Period buttons
  qsa('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      store.set({ energy: { period: btn.dataset.period } });
      animateChart();
    });
  });
}

// ── AURA Insights rotation ──
function initInsights() {
  let current = 0;
  const insights = qsa('.insight');
  if (!insights.length) return;

  setInterval(() => {
    const prev = insights[current];
    prev.classList.remove('active');
    prev.classList.add('exiting');
    setTimeout(() => prev.classList.remove('exiting'), TIMING.md);

    current = (current + 1) % insights.length;
    insights[current].classList.add('active');
  }, 7000);
}

// ── Camera timestamp ──
function initCameraTimestamp() {
  const el = qs('#cam-ts');
  if (!el) return;
  const update = () => {
    const now = new Date();
    el.textContent = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
  };
  update();
  setInterval(update, 1000);
}

// ── Scene activation (THE WOW MOMENT) ──
let thermoSetFn = null;

function activateScene(sceneName) {
  const scene = store.get().scenes[sceneName];
  if (!scene) return;

  // Mark active scene button
  qsa('.scene-card').forEach(c => c.classList.remove('active'));
  qs(`.scene-card[data-scene="${sceneName}"]`)?.classList.add('active');
  document.body.dataset.scene = sceneName;

  // Update state
  store.set({ scene: sceneName });

  // 1. Orchestrate room lights with stagger
  const rooms = Object.entries(scene.lights);
  rooms.forEach(([room, on], i) => {
    setTimeout(() => {
      const input = qs(`.sw-input[data-room="${room}"]`);
      if (input) {
        input.checked = on;
        input.dispatchEvent(new Event('change'));
      }
    }, i * 120);
  });

  // 2. Animate thermostat
  setTimeout(() => {
    if (thermoSetFn) thermoSetFn(scene.temp);
  }, 200);

  // 3. Update brightness arc
  setTimeout(() => {
    const arcSvg = qs('#arc-svg');
    if (arcSvg) {
      // Simulate pointer to update arc
      store.set({ masterBrightness: scene.brightness });
      const CX = 60, CY = 68, R = 52;
      const p = scene.brightness;
      const angle = Math.PI - p * Math.PI;
      const pt = { x: CX + R * Math.cos(angle), y: CY - R * Math.sin(angle) };
      const fillEl = qs('#arc-fill');
      const thumb = qs('#arc-thumb');
      const valEl = qs('#arc-val');
      if (fillEl && thumb && valEl) {
        thumb.setAttribute('cx', pt.x.toFixed(2));
        thumb.setAttribute('cy', pt.y.toFixed(2));
        const largeArc = p > 0.5 ? 1 : 0;
        fillEl.setAttribute('d', `M10 68 A${R} ${R} 0 ${largeArc} 0 ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`);
        valEl.textContent = Math.round(p * 100) + '%';
      }
    }
  }, 300);

  // 4. Update security mode
  setTimeout(() => {
    const seg = qs(`.seg[data-mode="${scene.secMode}"]`);
    if (seg) seg.click();
  }, 500);

  // 5. Pulse AURA orb
  setTimeout(() => {
    const orb = qs('#aura-orb');
    if (orb) {
      orb.style.transform = 'scale(1.3)';
      orb.style.transition = 'transform 0.4s cubic-bezier(0.22,1,0.36,1)';
      setTimeout(() => {
        orb.style.transform = 'scale(1)';
        setTimeout(() => { orb.style.transform = ''; orb.style.transition = ''; }, 500);
      }, 400);
    }
  }, 600);

  // 6. Accent color shift
  setTimeout(() => {
    document.documentElement.style.setProperty('--acc', scene.accent);
    setTimeout(() => document.documentElement.style.removeProperty('--acc'), 0);
    // Re-apply via body data attr (CSS handles it via body[data-scene])
  }, 100);

  // Sound fanfare
  const notes = [440, 550, 660];
  notes.forEach((f, i) => setTimeout(() => audio.play(f, 0.08, 0.10), i * 100));

  // Chat response
  addChatMessage(`Scene activated: <strong>${sceneName.charAt(0).toUpperCase() + sceneName.slice(1)}</strong>. Your home is adjusting.`, false);
}

// 8. CHAT INTERFACE
function initChat() {
  const orb = qs('#chat-orb');
  const panel = qs('#chat-panel');
  const closeBtn = qs('#chat-close');
  const input = qs('#chat-inp');
  const sendBtn = qs('#chat-send');
  const msgs = qs('#chat-msgs');
  const typing = qs('#typing-ind');
  if (!orb || !panel) return;

  let isOpen = false;

  function openChat() {
    isOpen = true;
    panel.removeAttribute('hidden');
    orb.style.display = 'none';
    setTimeout(() => input?.focus(), 50);
  }

  function closeChat() {
    isOpen = false;
    panel.setAttribute('hidden', '');
    orb.style.display = '';
  }

  orb.addEventListener('click', openChat);
  orb.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChat(); } });
  closeBtn?.addEventListener('click', closeChat);
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') closeChat(); });

  // Quick chip commands
  qsa('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const msg = chip.dataset.msg;
      if (input) input.value = msg;
      sendMessage(msg);
    });
  });

  sendBtn?.addEventListener('click', () => {
    const msg = input?.value.trim();
    if (msg) { sendMessage(msg); input.value = ''; }
  });
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const msg = input.value.trim();
      if (msg) { sendMessage(msg); input.value = ''; }
    }
  });

  window.addChatMessage = function(text, isUser = true) {
    const div = document.createElement('div');
    div.className = 'msg ' + (isUser ? 'msg-u' : 'msg-a');
    div.innerHTML = `<p>${text}</p>`;
    msgs?.appendChild(div);
    msgs?.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' });
  };

  async function sendMessage(text) {
    addChatMessage(text, true);
    if (input) input.value = '';

    // Show typing
    typing?.removeAttribute('hidden');
    await wait(1200);
    typing?.setAttribute('hidden', '');

    const response = parseIntent(text.toLowerCase());
    // Typewriter effect
    const div = document.createElement('div');
    div.className = 'msg msg-a';
    const p = document.createElement('p');
    div.appendChild(p);
    msgs?.appendChild(div);
    msgs?.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' });

    let i = 0;
    const typeInterval = setInterval(() => {
      p.innerHTML = response.slice(0, i + 1);
      i++;
      if (i >= response.length) clearInterval(typeInterval);
    }, 18);

    // Execute action
    if (response._action) response._action();
  }

  function parseIntent(text) {
    // Lights off
    if (/turn off (all )?lights?|lights? off/i.test(text)) {
      const act = () => {
        qsa('.sw-input').forEach(i => { i.checked = false; i.dispatchEvent(new Event('change')); });
      };
      const r = Object.assign('Turning off all lights. Quiet descends.', { _action: act });
      return r;
    }
    if (/turn on (all )?lights?|lights? on/i.test(text)) {
      const act = () => {
        qsa('.sw-input').forEach(i => { i.checked = true; i.dispatchEvent(new Event('change')); });
      };
      return Object.assign('All lights on.', { _action: act });
    }
    // Specific room lights
    const roomMatch = text.match(/turn (on|off) (living|bedroom|kitchen|bathroom|bath)/i);
    if (roomMatch) {
      const on = roomMatch[1] === 'on';
      const room = roomMatch[2] === 'bath' ? 'bathroom' : roomMatch[2];
      const act = () => {
        const inp = qs(`.sw-input[data-room="${room}"]`);
        if (inp) { inp.checked = on; inp.dispatchEvent(new Event('change')); }
      };
      return Object.assign(`${room.charAt(0).toUpperCase() + room.slice(1)} lights ${on ? 'on' : 'off'}.`, { _action: act });
    }
    // Temperature
    const tempMatch = text.match(/set temp(erature)? to (\d+)/i);
    if (tempMatch) {
      const t = parseInt(tempMatch[2]);
      const act = () => { if (thermoSetFn) thermoSetFn(t); };
      return Object.assign(`Setting temperature to ${t}°C. The room will adjust gradually.`, { _action: act });
    }
    // Scenes
    if (/morning/i.test(text)) return Object.assign('Good morning. Easing into the day.', { _action: () => activateScene('morning') });
    if (/focus|work/i.test(text)) return Object.assign('Focus mode active. Conditions optimized for deep work.', { _action: () => activateScene('focus') });
    if (/cinema|movie|film/i.test(text)) return Object.assign('Cinema mode. Dimming lights, dropping temperature.', { _action: () => activateScene('cinema') });
    if (/sleep|goodnight|good night/i.test(text)) return Object.assign('Goodnight. All lights will fade slowly. Sleep well.', { _action: () => activateScene('sleep') });
    if (/i.?m (leaving|gone|out)/i.test(text)) return Object.assign('Away mode active. Monitoring everything while you\'re out.', { _action: () => activateScene('focus') });
    if (/i.?m (home|back|here)/i.test(text)) return Object.assign('Welcome back. Your home is warming up.', { _action: () => activateScene('morning') });
    // Status queries
    if (/how.?(is|are|s) (the )?(temp|climate|warm|cold)/i.test(text)) return `Temperature is ${store.get().climate.temperature}°C. Humidity at ${store.get().climate.humidity}%.`;
    if (/how many (lights?|rooms)/i.test(text)) {
      const on = Object.values(store.get().rooms).filter(r => r.light).length;
      return `${on} of 4 rooms are lit.`;
    }
    // Fallbacks — curated, never "I don't understand"
    const fallbacks = [
      'That\'s a subtle request. Let me sit with it.',
      'Your home is listening, even when I\'m not sure what to say.',
      'I noticed that. Give me a moment to think.',
      'The house heard you. I\'m interpreting.',
      'Try: "goodnight", "cinema mode", or "set temp to 21".',
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }
}

// ── Modal ──
function initModal() {
  const backdrop = qs('#modal-bg');
  const infoBtn = qs('#s-info-btn');
  const closeBtn = qs('#modal-close');
  const ackBtn = qs('#modal-ack');
  const closeDoor = qs('#modal-close-door');
  if (!backdrop) return;

  function open() {
    backdrop.removeAttribute('hidden');
    qs('#modal-panel')?.focus?.();
    audio.play(330, 0.06, 0.08);
  }
  function close() {
    backdrop.setAttribute('hidden', '');
  }

  infoBtn?.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  ackBtn?.addEventListener('click', close);
  closeDoor?.addEventListener('click', () => {
    closeDoor.textContent = 'Closed ✓';
    setTimeout(close, 600);
  });
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  backdrop.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

// ── Audio toggle ──
function initAudioToggle() {
  const btn = qs('#audio-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const enabled = !store.get().audio.enabled;
    store.set({ audio: { enabled } });
    btn.classList.toggle('muted', !enabled);
    btn.setAttribute('aria-label', enabled ? 'Toggle sound feedback' : 'Sound disabled');
  });
}

// ── Nav logo animation ──
function initNavLogo() {
  const node = qs('#bm-node');
  if (!node) return;
  qs('.nav-brand')?.addEventListener('mouseenter', () => {
    node.style.transition = 'transform 0.4s cubic-bezier(0.22,1,0.36,1)';
    node.setAttribute('r', '4');
  });
  qs('.nav-brand')?.addEventListener('mouseleave', () => {
    node.setAttribute('r', '2');
  });
}

// ── CTA scroll ──
function initCTA() {
  qs('#cta-btn')?.addEventListener('click', () => {
    qs('#controls')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// 9. EVENT BINDINGS
function bindEvents() {
  qs('#theme-btn')?.addEventListener('click', toggleTheme);
}

// 10. LIFECYCLE — MOUNT
async function mount() {
  initTheme();
  await runBoot();

  // Modules
  initCursor();
  initMagnetic();
  initSmoothScroll();
  initParallax();

  // Components
  initArcSlider();
  initColorTempStrip();
  const thermoApi = initThermostat();
  thermoSetFn = thermoApi?.setTemp || null;
  initLightToggles();
  initSegControl();
  initEnergyChart();
  initInsights();
  initCameraTimestamp();
  initChat();
  initModal();
  initAudioToggle();
  initNavLogo();
  initCTA();

  // Reveals (after boot)
  initReveal();
  initTilt();

  // Scene cards
  qsa('.scene-card').forEach(card => {
    card.addEventListener('click', () => activateScene(card.dataset.scene));
  });

  // Initial chart
  animateChart();

  // Subscribe to state changes for global updates
  store.subscribe((state) => {
    updateHeroFP();
    updateLightsStatus();
  });

  bindEvents();

  // Initial floorplan state
  updateHeroFP();
  updateLightsStatus();
}

document.addEventListener('DOMContentLoaded', mount);

// Hide landing overlay on Enter or Esc for smooth UX
window.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('landing-overlay');
  if (overlay) {
    // Hide on Enter key
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === 'Escape') && overlay.style.display !== 'none') {
        overlay.style.display = 'none';
      }
    });
    // Prevent scroll/interaction when overlay is visible
    if (overlay.style.display !== 'none') {
      document.body.style.overflow = 'hidden';
      overlay.addEventListener('transitionend', () => {
        if (overlay.style.display === 'none') document.body.style.overflow = '';
      });
      overlay.querySelector('.landing-enter-btn').addEventListener('click', () => {
        document.body.style.overflow = '';
      });
    }
  }
});
