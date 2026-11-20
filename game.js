/* =========================================================
   تیر و کمان — بازی تیراندازی با کمان
   Canvas 2D + WebAudio (بدون هیچ فایل خارجی)
   ========================================================= */
(() => {
  'use strict';

  /* ---------- ثابت‌های صحنه ---------- */
  const W = 1280;
  const H = 720;
  const GROUND_Y = 600;
  const BOW_X = 248;
  const BOW_Y = 446;
  const TARGET_R = 86;
  const GRAVITY = 470;
  const SPEED_MIN = 560;
  const SPEED_MAX = 1430;
  const CHARGE_TIME = 0.85;      // ثانیه تا رسیدن به نهایت قدرت
  const ARROWS_PER_GAME = 12;
  const WIND_BAR_MAX = 500;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });

  /* ---------- ابزارهای کوچک ---------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const TAU = Math.PI * 2;

  const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  const fa = (n) => String(Math.round(n)).replace(/\d/g, (d) => FA_DIGITS[+d]);

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /* ---------- مقیاس‌بندی و رزولوشن ---------- */
  let dpr = 1;
  const view = { s: 1, ox: 0, oy: 0 };

  function resize() {
    const cw = canvas.clientWidth || window.innerWidth;
    const ch = canvas.clientHeight || window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(cw * dpr));
    canvas.height = Math.max(1, Math.round(ch * dpr));
    const s = Math.min(cw / W, ch / H);
    view.s = s;
    view.ox = (cw - W * s) / 2;
    view.oy = (ch - H * s) / 2;

    // HUD را داخل کادر بازی نگه می‌داریم (نه روی نوارهای تیره)
    const hud = document.getElementById('hud');
    if (hud) {
      const small = ch < 500 || cw < 560;
      const padX = Math.max(small ? 10 : 16, Math.round(view.ox) + (small ? 10 : 18));
      const padY = Math.max(small ? 8 : 14, Math.round(view.oy) + (small ? 8 : 18));
      hud.style.padding = padY + 'px ' + padX + 'px';
    }
  }

  function toLogical(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left - view.ox) / view.s,
      y: (clientY - r.top - view.oy) / view.s,
    };
  }

  /* ---------- صدا (سنتز با WebAudio) ---------- */
  const audio = {
    ctx: null,
    enabled: true,
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    tone(freq, dur, type = 'sine', gain = 0.2, slideTo = null, delay = 0) {
      if (!this.enabled || !this.ctx) return;
      const c = this.ctx;
      const t0 = c.currentTime + delay;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(28, slideTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    },
    noise(dur = 0.15, gain = 0.2, freq = 1200, sweepTo = null, q = 1) {
      if (!this.enabled || !this.ctx) return;
      const c = this.ctx;
      const t0 = c.currentTime;
      const len = Math.max(1, Math.floor(c.sampleRate * dur));
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.6);
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = q;
      f.frequency.setValueAtTime(freq, t0);
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t0 + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f).connect(g).connect(c.destination);
      src.start(t0);
    },
    shoot(power) {
      this.noise(0.18, 0.16, 2600, 700, 0.9);
      this.tone(150 + power * 90, 0.14, 'triangle', 0.1, 80);
    },
    hit(score) {
      this.tone(150, 0.18, 'sine', 0.32, 65);
      this.noise(0.1, 0.3, 750, 220, 1.3);
      if (score >= 10) {
        this.tone(1046, 0.16, 'triangle', 0.13, null, 0.07);
        this.tone(1568, 0.24, 'triangle', 0.11, null, 0.16);
      } else if (score >= 6) {
        this.tone(784, 0.13, 'triangle', 0.09, null, 0.06);
      }
    },
    ground() {
      this.tone(95, 0.14, 'sine', 0.16, 48);
      this.noise(0.16, 0.16, 380, 130, 1);
    },
    miss() {
      this.noise(0.24, 0.07, 620, 200, 0.7);
    },
  };

  /* ---------- وضعیت بازی ---------- */
  const state = {
    mode: 'menu',            // menu | playing | gameover
    time: 0,
    score: 0,
    best: 0,
    arrowsLeft: ARROWS_PER_GAME,
    shotIndex: 0,
    shots: [],
    wind: 0,
    pointer: { x: 900, y: 320 },
    aiming: false,
    chargeStart: 0,
    power: 0,
    arrow: null,
    stuckTarget: [],
    stuckGround: [],
    particles: [],
    floats: [],
    shake: 0,
    flash: null,
    nextShotAt: null,
    ending: false,
    hintTimer: 0,
    target: { baseX: 900, baseY: 318, amp: 0, speed: 0.9, phase: 0 },
  };

  function loadBest() {
    try {
      return parseInt(localStorage.getItem('archery_best') || '0', 10) || 0;
    } catch (e) {
      return 0;
    }
  }
  function saveBest(v) {
    try {
      localStorage.setItem('archery_best', String(v));
    } catch (e) { /* نادیده */ }
  }
  state.best = loadBest();
  try {
    if (localStorage.getItem('archery_sound') === '0') audio.enabled = false;
  } catch (e) { /* نادیده */ }

  function targetCenter() {
    const t = state.target;
    return {
      x: t.baseX,
      y: t.baseY + Math.sin(state.time * t.speed + t.phase) * t.amp,
    };
  }

  /* ---------- منطق نوبت‌ها ---------- */
  function setupShot() {
    const i = state.shotIndex++;
    const prog = Math.min(i / (ARROWS_PER_GAME - 1), 1);
    const t = state.target;

    t.baseX = clamp(660 + prog * 420 + rand(-22, 22), 620, W - 150);
    t.baseY = 300 + rand(-42, 42);
    t.amp = i < 2 ? 0 : Math.min(16 + (i - 2) * 10, 60);
    t.speed = 1.0 + i * 0.065;
    t.phase = rand(0, TAU);

    state.stuckTarget.length = 0;
    state.arrow = null;
    state.aiming = false;
    state.power = 0;
    state.nextShotAt = null;
    state.shake = 0;
    state.flash = null;

    const windMax = Math.min(60 + i * 45, 480);
    const dir = Math.random() < 0.5 ? -1 : 1;
    state.wind = dir * rand(windMax * 0.4, windMax);
    if (Math.abs(state.wind) < 25) state.wind = 0;

    updateHUD();
  }

  function resetGame() {
    state.mode = 'playing';
    state.score = 0;
    state.arrowsLeft = ARROWS_PER_GAME;
    state.shotIndex = 0;
    state.shots = [];
    state.stuckTarget.length = 0;
    state.stuckGround.length = 0;
    state.particles.length = 0;
    state.floats.length = 0;
    state.arrow = null;
    state.aiming = false;
    state.power = 0;
    state.shake = 0;
    state.ending = false;
    state.hintTimer = 6.5;
    setupShot();
  }

  function aimAngle() {
    const dx = state.pointer.x - BOW_X;
    const dy = state.pointer.y - BOW_Y;
    const a = Math.atan2(dy, Math.max(dx, 26));
    return clamp(a, -1.42, 0.5);
  }

  function startCharge() {
    if (state.mode !== 'playing') return;
    if (state.aiming || state.arrow || state.ending) return;
    audio.ensure();
    state.aiming = true;
    // زمان کشیدن کمان بر پایهٔ زمان واقعی است تا روی دستگاه‌های کند هم یکسان حس شود
    state.chargeStart = performance.now() / 1000;
    state.power = 0;
    hideHint();
  }

  function shoot() {
    if (!state.aiming) return;
    const power = clamp(state.power, 0.12, 1);
    const ang = aimAngle();
    const speed = SPEED_MIN + power * (SPEED_MAX - SPEED_MIN);
    state.aiming = false;
    state.power = 0;

    state.arrow = {
      x: BOW_X + Math.cos(ang) * 46,
      y: BOW_Y + Math.sin(ang) * 46,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      alive: true,
      trail: [],
      ang,
    };
    state.shake = Math.max(state.shake, 3);
    audio.shoot(power);
  }

  function resolveShot(score) {
    state.arrow = null;
    state.shots.push(score);
    state.score += score;
    state.arrowsLeft = Math.max(0, state.arrowsLeft - 1);

    if (state.arrowsLeft <= 0) {
      state.ending = true;
      state.nextShotAt = state.time + 1.15;
    } else {
      state.nextShotAt = state.time + 0.85;
    }
    updateHUD();
  }

  function endGame() {
    state.mode = 'gameover';
    state.nextShotAt = null;
    const isRecord = state.score > state.best;
    if (isRecord) {
      state.best = state.score;
      saveBest(state.best);
    }

    const bulls = state.shots.filter((s) => s >= 10).length;
    const accurate = state.shots.filter((s) => s >= 6).length;
    const acc = state.shots.length ? Math.round((accurate / state.shots.length) * 100) : 0;

    document.getElementById('finalScore').textContent = fa(state.score);
    document.getElementById('resBest').textContent = fa(state.best);
    document.getElementById('resBull').textContent = fa(bulls);
    document.getElementById('resAcc').textContent = fa(acc) + '٪';
    document.getElementById('overTitle').textContent = isRecord
      ? 'رکورد جدید!'
      : state.score >= 70
      ? 'کماندار حرفه‌ای!'
      : state.score >= 40
      ? 'خوب بود!'
      : 'باز هم تلاش کن';

    const badge = document.getElementById('recordBadge');
    badge.hidden = !isRecord || state.score <= 0;

    document.getElementById('overScreen').classList.remove('hidden');
    updateHUD();
  }

  /* ---------- به‌روزرسانی فیزیک ---------- */
  function update(dt) {
    state.time += dt;
    if (state.hintTimer > 0) state.hintTimer -= dt;

    if (state.aiming) {
      state.power = clamp((performance.now() / 1000 - state.chargeStart) / CHARGE_TIME, 0, 1);
    }

    if (state.arrow && state.arrow.alive) updateArrow(dt);

    // ذرات
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.vy += 900 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) state.particles.splice(i, 1);
    }

    // نوشته‌های شناور
    for (let i = state.floats.length - 1; i >= 0; i--) {
      const f = state.floats[i];
      f.y -= 34 * dt;
      f.life -= dt;
      if (f.life <= 0) state.floats.splice(i, 1);
    }

    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 22);
    if (state.flash) {
      state.flash.life -= dt * 2.6;
      if (state.flash.life <= 0) state.flash = null;
    }

    if (state.nextShotAt !== null && state.time >= state.nextShotAt) {
      state.nextShotAt = null;
      if (state.ending) endGame();
      else setupShot();
    }
  }

  function updateArrow(dt) {
    const a = state.arrow;
    const steps = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / steps;

    for (let i = 0; i < steps; i++) {
      const px = a.x;
      const py = a.y;

      a.vx += state.wind * h;
      a.vy += GRAVITY * h;
      a.x += a.vx * h;
      a.y += a.vy * h;

      const c = targetCenter();

      // عبور از صفحهٔ سیبل (کمی داخل لبهٔ چپ صفحه)
      const impactX = c.x - TARGET_R * 0.45;
      if (px <= impactX && a.x >= impactX) {
        const f = (impactX - px) / Math.max(a.x - px, 1e-6);
        const hy = py + (a.y - py) * f;
        const d = Math.abs(hy - c.y);
        if (d <= TARGET_R) {
          onTargetHit(c, hy, d);
          return;
        }
      }

      // برخورد با زمین
      if (a.y >= GROUND_Y && a.x < W + 40) {
        onGroundHit(a.x);
        return;
      }

      // خارج از صحنه
      if (a.x > W + 80 || a.y > H + 60) {
        onOut();
        return;
      }
    }

    a.trail.push({ x: a.x, y: a.y });
    if (a.trail.length > 16) a.trail.shift();
  }

  function scoreFor(d) {
    if (d > TARGET_R) return 0;
    const band = Math.floor(d / (TARGET_R / 5));
    return 10 - 2 * clamp(band, 0, 4);
  }

  const SCORE_COLORS = { 10: '#ffd76a', 8: '#ff8a72', 6: '#7fc8ff', 4: '#dfe6f2', 2: '#eef2f8' };

  function onTargetHit(c, hy, d) {
    const score = scoreFor(d);
    const a = state.arrow;
    const ang = Math.atan2(a.vy, a.vx);
    state.stuckTarget.push({ ox: -TARGET_R * 0.45, oy: hy - c.y, ang });
    state.arrow = null;

    burst(c.x, hy, score === 10 ? 26 : 16, score >= 10 ? '#ffd76a' : score >= 6 ? '#ffb199' : '#cfe3f5');
    state.floats.push({
      x: c.x,
      y: hy - 26,
      text: '+' + fa(score),
      color: SCORE_COLORS[score] || '#fff',
      life: 1.2,
      maxLife: 1.2,
    });

    state.shake = Math.max(state.shake, score === 10 ? 10 : 6);
    state.flash = { x: c.x, y: hy, life: 1, maxLife: 1 };
    audio.hit(score);
    resolveShot(score);
  }

  function onGroundHit(x) {
    state.stuckGround.push({ x, ang: rand(-0.16, 0.06) });
    if (state.stuckGround.length > 14) state.stuckGround.shift();
    burst(x, GROUND_Y - 4, 12, '#6d8a6a', true);
    state.floats.push({ x, y: GROUND_Y - 52, text: 'خطا', color: '#f0a8a0', life: 1.1, maxLife: 1.1 });
    state.shake = Math.max(state.shake, 4);
    audio.ground();
    resolveShot(0);
  }

  function onOut() {
    audio.miss();
    state.floats.push({
      x: W - 160,
      y: 220,
      text: 'خطا',
      color: '#f0a8a0',
      life: 1.0,
      maxLife: 1.0,
    });
    resolveShot(0);
  }

  function burst(x, y, n, color, dust = false) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const sp = dust ? rand(30, 130) : rand(60, 340);
      state.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (dust ? 40 : 0),
        life: rand(0.35, 0.85),
        maxLife: 0.85,
        size: rand(1.6, dust ? 4.5 : 3.6),
        color,
      });
    }
  }

  /* ---------- ورودی ---------- */
  canvas.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'playing') return;
    e.preventDefault();
    state.pointer = toLogical(e.clientX, e.clientY);
    startCharge();
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* نادیده */ }
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    state.pointer = toLogical(e.clientX, e.clientY);
  });

  window.addEventListener('pointerup', () => {
    if (state.aiming) shoot();
  });

  window.addEventListener('pointercancel', () => {
    if (state.aiming) shoot();
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.mode === 'playing') {
        if (!state.aiming) startCharge();
      } else if (state.mode === 'menu') {
        startGame();
      } else if (state.mode === 'gameover') {
        startGame();
      }
    }
    if (e.key === 'ArrowUp') state.pointer.y = clamp(state.pointer.y - 22, 40, GROUND_Y - 20);
    if (e.key === 'ArrowDown') state.pointer.y = clamp(state.pointer.y + 22, 40, GROUND_Y - 20);
    if (e.key === 'ArrowLeft') state.pointer.x = clamp(state.pointer.x - 26, 120, W - 30);
    if (e.key === 'ArrowRight') state.pointer.x = clamp(state.pointer.x + 26, 120, W - 30);
    if (e.key === 'm' || e.key === 'M') toggleSound();
    if (e.key === 'r' || e.key === 'R') {
      if (state.mode !== 'menu') startGame();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && state.aiming) shoot();
  });

  /* ---------- HUD ---------- */
  const el = {
    score: document.getElementById('scoreValue'),
    best: document.getElementById('bestValue'),
    windValue: document.getElementById('windValue'),
    windDir: document.getElementById('windDir'),
    windFill: document.getElementById('windFill'),
    dots: document.getElementById('arrowDots'),
    hint: document.getElementById('hint'),
    soundBtn: document.getElementById('soundBtn'),
    startScreen: document.getElementById('startScreen'),
    overScreen: document.getElementById('overScreen'),
  };

  function updateHUD() {
    el.score.textContent = fa(state.score);
    el.best.textContent = fa(state.best);

    const w = Math.abs(state.wind);
    if (w < 25) {
      el.windValue.textContent = 'آرام';
    } else {
      el.windValue.textContent = fa(w);
    }
    el.windDir.textContent = w < 25 ? '•' : state.wind > 0 ? '→' : '←';

    const pct = clamp(w / WIND_BAR_MAX, 0, 1) * 50;
    el.windFill.style.width = pct + '%';
    if (state.wind >= 0) {
      el.windFill.style.left = '50%';
      el.windFill.style.right = 'auto';
    } else {
      el.windFill.style.right = '50%';
      el.windFill.style.left = 'auto';
    }

    // نقطه‌های تیر
    const used = ARROWS_PER_GAME - state.arrowsLeft;
    if (el.dots.children.length !== ARROWS_PER_GAME) {
      el.dots.innerHTML = '';
      for (let i = 0; i < ARROWS_PER_GAME; i++) {
        const s = document.createElement('span');
        s.className = 'dot';
        el.dots.appendChild(s);
      }
    }
    for (let i = 0; i < el.dots.children.length; i++) {
      el.dots.children[i].classList.toggle('used', i < used);
    }
  }

  function showHint() {
    if (state.mode === 'playing') el.hint.classList.add('show');
  }
  function hideHint() {
    state.hintTimer = 0;
    el.hint.classList.remove('show');
  }

  const isTouch = (() => {
    try {
      return window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    } catch (e) {
      return false;
    }
  })();

  function applyInputHints() {
    if (!isTouch) return;
    const action = document.getElementById('hintAction');
    if (action) action.textContent = 'انگشتت را روی صفحه';
    const pull = document.getElementById('stepPullText');
    if (pull) pull.textContent = 'انگشتت را روی صفحه نگه دار؛ هرچه بیشتر، قدرت بیشتر.';
    const sTip = document.getElementById('startTip');
    if (sTip) sTip.textContent = 'هرجا صفحه را لمس کنی، نشانه‌گیری همان‌جاست.';
    const aTip = document.getElementById('againTip');
    if (aTip) aTip.textContent = 'برای شروع دوباره، دکمهٔ بالا را بزن.';
  }

  function toggleSound() {
    audio.enabled = !audio.enabled;
    try {
      localStorage.setItem('archery_sound', audio.enabled ? '1' : '0');
    } catch (e) { /* نادیده */ }
    if (audio.enabled) audio.ensure();
    el.soundBtn.classList.toggle('is-muted', !audio.enabled);
    el.soundBtn.setAttribute('aria-label', audio.enabled ? 'خاموش کردن صدا' : 'روشن کردن صدا');
  }

  el.soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSound();
  });

  function startGame() {
    audio.ensure();
    el.startScreen.classList.add('hidden');
    el.overScreen.classList.add('hidden');
    resetGame();
    showHint();
  }

  document.getElementById('rotateContinue').addEventListener('click', () => {
    document.getElementById('rotateHint').classList.add('dismissed');
    resize();
    last = performance.now();
  });

  document.getElementById('startBtn').addEventListener('click', startGame);
  document.getElementById('againBtn').addEventListener('click', startGame);

  /* ---------- عناصر تزئینی ثابت ---------- */
  const stars = [];
  for (let i = 0; i < 70; i++) {
    stars.push({ x: rand(0, W), y: rand(0, 330), r: rand(0.6, 1.7), ph: rand(0, TAU), sp: rand(0.6, 2.2) });
  }

  const clouds = [];
  for (let i = 0; i < 6; i++) {
    clouds.push({ x: rand(0, W), y: rand(90, 300), w: rand(120, 300), h: rand(16, 40), o: rand(0.08, 0.2), sp: rand(2, 7) });
  }

  const grass = [];
  for (let i = 0; i < 240; i++) {
    grass.push({ x: rand(-20, W + 20), h: rand(7, 24), ph: rand(0, TAU), lean: rand(-0.5, 0.5) });
  }

  const fgGrass = [];
  for (let i = 0; i < 70; i++) {
    fgGrass.push({ x: rand(-40, W + 40), h: rand(26, 78), ph: rand(0, TAU), lean: rand(-0.9, 0.9) });
  }

  const motes = [];
  for (let i = 0; i < 46; i++) {
    motes.push({ x: rand(0, W), y: rand(120, GROUND_Y - 20), r: rand(0.8, 2.4), sp: rand(0.6, 1.5), ph: rand(0, TAU) });
  }

  const trees = [
    { x: 90, h: 74 }, { x: 132, h: 52 }, { x: 330, h: 44 }, { x: 560, h: 58 },
    { x: 610, h: 38 }, { x: 860, h: 46 }, { x: 1180, h: 66 }, { x: 1235, h: 48 },
  ];

  /* ---------- رسم صحنه ---------- */
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y + 40);
    g.addColorStop(0, '#0d1730');
    g.addColorStop(0.34, '#39386c');
    g.addColorStop(0.58, '#8e4f6e');
    g.addColorStop(0.78, '#d97e63');
    g.addColorStop(0.93, '#f2ae7c');
    g.addColorStop(1, '#f9d3a2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, GROUND_Y + 60);
  }

  function drawStars(t) {
    ctx.save();
    for (const s of stars) {
      const a = 0.25 + 0.6 * Math.abs(Math.sin(t * s.sp + s.ph));
      ctx.globalAlpha = a * clamp(1 - s.y / 360, 0.15, 1);
      ctx.fillStyle = '#fff6dd';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSun() {
    const cx = 1010;
    const cy = 470;
    const glow = ctx.createRadialGradient(cx, cy, 8, cx, cy, 320);
    glow.addColorStop(0, 'rgba(255, 226, 168, 0.85)');
    glow.addColorStop(0.25, 'rgba(255, 190, 120, 0.35)');
    glow.addColorStop(0.6, 'rgba(255, 150, 100, 0.12)');
    glow.addColorStop(1, 'rgba(255, 130, 90, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - 340, cy - 340, 680, 680);

    ctx.fillStyle = 'rgba(255, 240, 208, 0.95)';
    ctx.beginPath();
    ctx.arc(cx, cy, 54, 0, TAU);
    ctx.fill();
  }

  function drawClouds(t) {
    ctx.save();
    for (const c of clouds) {
      const x = ((c.x + t * c.sp) % (W + 400)) - 200;
      const g = ctx.createLinearGradient(0, c.y - c.h, 0, c.y + c.h);
      g.addColorStop(0, `rgba(255, 214, 190, ${c.o})`);
      g.addColorStop(1, `rgba(160, 120, 170, ${c.o * 0.35})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, c.y, c.w * 0.5, c.h, 0, 0, TAU);
      ctx.ellipse(x + c.w * 0.22, c.y - c.h * 0.45, c.w * 0.3, c.h * 0.8, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function hillLayer(baseY, amp, freq, phase, color) {
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, baseY);
    for (let x = 0; x <= W; x += 14) {
      const y =
        baseY -
        Math.sin(x * freq + phase) * amp -
        Math.sin(x * freq * 2.4 + phase * 1.7) * amp * 0.35;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawHills() {
    hillLayer(524, 26, 0.0042, 0.6, '#4a3c66');
    hillLayer(552, 20, 0.0062, 2.2, '#3a3156');
    hillLayer(578, 14, 0.0091, 4.1, '#2a2a47');
  }

  function drawTrees() {
    ctx.save();
    ctx.fillStyle = '#201f38';
    for (const tr of trees) {
      const baseY = 580;
      ctx.beginPath();
      ctx.moveTo(tr.x, baseY + 4);
      ctx.lineTo(tr.x - tr.h * 0.26, baseY + 4);
      ctx.lineTo(tr.x, baseY - tr.h);
      ctx.lineTo(tr.x + tr.h * 0.26, baseY + 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawGround(t) {
    const g = ctx.createLinearGradient(0, GROUND_Y - 6, 0, H);
    g.addColorStop(0, '#274238');
    g.addColorStop(0.35, '#1a332c');
    g.addColorStop(1, '#0a1917');
    ctx.fillStyle = g;
    ctx.fillRect(0, GROUND_Y - 4, W, H - GROUND_Y + 4);

    // خط افق چمن
    ctx.strokeStyle = 'rgba(150, 210, 170, 0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y - 3);
    ctx.lineTo(W, GROUND_Y - 3);
    ctx.stroke();

    // بوته‌های میانی
    for (const b of grass) {
      const sway = Math.sin(t * 1.4 + b.ph) * (3 + Math.abs(state.wind) * 0.012) + state.wind * 0.02;
      ctx.strokeStyle = `rgba(120, 190, 150, ${0.18 + (b.h / 24) * 0.2})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(b.x, GROUND_Y + 2);
      ctx.quadraticCurveTo(b.x + b.lean * 6 + sway * 0.6, GROUND_Y - b.h * 0.6, b.x + b.lean * 12 + sway, GROUND_Y - b.h);
      ctx.stroke();
    }
  }

  function drawFgGrass(t) {
    ctx.save();
    for (const b of fgGrass) {
      const sway = Math.sin(t * 1.1 + b.ph) * 5 + state.wind * 0.03;
      const grad = ctx.createLinearGradient(0, H - b.h, 0, H);
      grad.addColorStop(0, 'rgba(10, 30, 26, 0.85)');
      grad.addColorStop(1, 'rgba(4, 14, 12, 1)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(b.x, H + 6);
      ctx.quadraticCurveTo(b.x + b.lean * 18 + sway * 0.5, H - b.h * 0.55, b.x + b.lean * 34 + sway, H - b.h);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTarget(t) {
    const c = targetCenter();
    const R = TARGET_R;

    // سایه روی زمین
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(c.x, GROUND_Y, R * 0.72, 12, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // پایه
    ctx.strokeStyle = '#4a3d33';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c.x - 30, GROUND_Y);
    ctx.lineTo(c.x - 4, c.y + R * 0.55);
    ctx.moveTo(c.x + 30, GROUND_Y);
    ctx.lineTo(c.x + 4, c.y + R * 0.55);
    ctx.stroke();
    ctx.strokeStyle = '#5d4b3d';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(c.x - 52, GROUND_Y - 3);
    ctx.lineTo(c.x + 52, GROUND_Y - 3);
    ctx.stroke();

    // لبه تیره
    ctx.fillStyle = '#1b1a22';
    ctx.beginPath();
    ctx.arc(c.x, c.y, R + 6, 0, TAU);
    ctx.fill();

    // حلقه‌ها
    const bands = [
      { r: R, color: '#f4f0e4' },
      { r: R * 0.8, color: '#26262e' },
      { r: R * 0.6, color: '#2f8fd8' },
      { r: R * 0.4, color: '#e04a3f' },
      { r: R * 0.2, color: '#f4c542' },
    ];
    for (const b of bands) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, b.r, 0, TAU);
      ctx.fillStyle = b.color;
      ctx.fill();
      if (b.r !== R) {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // درخشش مرکز
    const gl = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, R * 0.55);
    gl.addColorStop(0, 'rgba(255, 245, 200, 0.45)');
    gl.addColorStop(1, 'rgba(255, 235, 170, 0)');
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.arc(c.x, c.y, R * 0.55, 0, TAU);
    ctx.fill();

    // نور لبه بالایی
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, R + 3, -2.6, -0.5);
    ctx.stroke();

    // اثر برخورد
    for (const s of state.stuckTarget) {
      ctx.fillStyle = 'rgba(8, 10, 18, 0.55)';
      ctx.beginPath();
      ctx.arc(c.x + s.ox + 2, c.y + s.oy, 4.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // تیرهای چسبیده
    for (const s of state.stuckTarget) {
      drawArrowShape(c.x + s.ox, c.y + s.oy, s.ang, true);
    }

    // درخشش لحظهٔ برخورد
    if (state.flash) {
      const f = state.flash;
      const k = clamp(f.life / f.maxLife, 0, 1);
      const fr = 40 + (1 - k) * 90;
      const fg = ctx.createRadialGradient(f.x, f.y, 2, f.x, f.y, fr);
      fg.addColorStop(0, `rgba(255, 248, 214, ${0.75 * k})`);
      fg.addColorStop(0.45, `rgba(255, 210, 120, ${0.35 * k})`);
      fg.addColorStop(1, 'rgba(255, 200, 110, 0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(f.x, f.y, fr, 0, TAU);
      ctx.fill();
    }

    // تیر در حال حرکت روی سیبل کشیده نشود؛ در لایه جدا رسم می‌شود
    void t;
  }

  function drawArrowShape(x, y, ang, stuck = false) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);

    // سایه
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.translate(1.5, 2.5);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-46, 0);
    ctx.lineTo(stuck ? 0 : 10, 0);
    ctx.stroke();
    ctx.restore();

    // بدنه
    ctx.strokeStyle = stuck ? '#d8c79c' : '#f2e5c2';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-46, 0);
    ctx.lineTo(stuck ? 2 : 12, 0);
    ctx.stroke();

    // نوک
    if (!stuck) {
      ctx.fillStyle = '#dbe6f2';
      ctx.beginPath();
      ctx.moveTo(20, 0);
      ctx.lineTo(7, -4.4);
      ctx.lineTo(7, 4.4);
      ctx.closePath();
      ctx.fill();
    }

    // پر
    ctx.fillStyle = '#e0554b';
    ctx.beginPath();
    ctx.moveTo(-46, 0);
    ctx.lineTo(-57, -7.5);
    ctx.lineTo(-34, -1.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f2efe6';
    ctx.beginPath();
    ctx.moveTo(-46, 0);
    ctx.lineTo(-57, 7.5);
    ctx.lineTo(-34, 1.2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawGroundArrows() {
    for (const s of state.stuckGround) {
      drawArrowShape(s.x, GROUND_Y - 2, s.ang + Math.PI, true);
    }
  }

  function drawFlyingArrow() {
    const a = state.arrow;
    if (!a) return;

    // رد تیر
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 1; i < a.trail.length; i++) {
      const p0 = a.trail[i - 1];
      const p1 = a.trail[i];
      ctx.globalAlpha = (i / a.trail.length) * 0.35;
      ctx.strokeStyle = '#ffe6b0';
      ctx.lineWidth = 1 + (i / a.trail.length) * 2.4;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.restore();

    drawArrowShape(a.x, a.y, Math.atan2(a.vy, a.vx));
  }

  function drawArcher() {
    const aiming = state.aiming;
    const ang = aiming ? aimAngle() : 0;
    const pull = aiming ? 8 + state.power * 36 : 8;

    // سایه
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(228, GROUND_Y + 2, 78, 13, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    const skin = '#141c2c';
    const rim = 'rgba(255, 186, 130, 0.45)';

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // پاها
    ctx.strokeStyle = skin;
    ctx.lineWidth = 15;
    ctx.beginPath();
    ctx.moveTo(222, 548);
    ctx.lineTo(194, GROUND_Y - 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(226, 548);
    ctx.lineTo(266, GROUND_Y - 2);
    ctx.stroke();

    // کفش‌ها
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#0d131f';
    ctx.beginPath();
    ctx.moveTo(192, GROUND_Y - 3);
    ctx.lineTo(180, GROUND_Y - 3);
    ctx.moveTo(266, GROUND_Y - 3);
    ctx.lineTo(279, GROUND_Y - 3);
    ctx.stroke();

    // تنه
    ctx.strokeStyle = skin;
    ctx.lineWidth = 33;
    ctx.beginPath();
    ctx.moveTo(224, 552);
    ctx.lineTo(213, 488);
    ctx.stroke();

    // کت
    ctx.strokeStyle = '#1b2537';
    ctx.lineWidth = 27;
    ctx.beginPath();
    ctx.moveTo(223, 545);
    ctx.lineTo(214, 494);
    ctx.stroke();

    // سر
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(211, 460, 17, 0, TAU);
    ctx.fill();

    // کلاه
    ctx.fillStyle = '#0f1726';
    ctx.beginPath();
    ctx.arc(211, 454, 17.5, Math.PI * 0.85, Math.PI * 2.12);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(203, 452, 26, 5, -0.16, 0, TAU);
    ctx.fill();

    // نور لبه
    ctx.strokeStyle = rim;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(211, 460, 17, -1.15, 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(226, 500);
    ctx.lineTo(228, 540);
    ctx.stroke();

    // بازوی عقب (به سمت زه)
    const nockX = BOW_X - pull * Math.cos(ang);
    const nockY = BOW_Y - pull * Math.sin(ang);
    ctx.strokeStyle = skin;
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(214, 496);
    ctx.lineTo(nockX, nockY);
    ctx.stroke();

    // بازوی جلو (به سمت دستگیره کمان)
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(212, 492);
    ctx.lineTo(BOW_X - 2, BOW_Y - 2);
    ctx.stroke();

    ctx.restore();

    // کمان + تیر نصب‌شده
    ctx.save();
    ctx.translate(BOW_X, BOW_Y);
    ctx.rotate(ang);
    ctx.lineCap = 'round';

    // چوب کمان
    ctx.strokeStyle = '#7b4f2a';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(-8, -58);
    ctx.quadraticCurveTo(34, -30, 26, 0);
    ctx.quadraticCurveTo(34, 30, -8, 58);
    ctx.stroke();

    ctx.strokeStyle = '#c98f4e';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-8, -58);
    ctx.quadraticCurveTo(34, -30, 26, 0);
    ctx.quadraticCurveTo(34, 30, -8, 58);
    ctx.stroke();

    // دستگیره
    ctx.strokeStyle = '#3a2718';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(24, -12);
    ctx.lineTo(24, 12);
    ctx.stroke();

    // زه
    ctx.strokeStyle = 'rgba(240, 244, 250, 0.92)';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(-8, -58);
    ctx.lineTo(-pull, 0);
    ctx.lineTo(-8, 58);
    ctx.stroke();

    // تیر نصب‌شده
    if (!state.arrow) {
      ctx.save();
      ctx.translate(-pull, 0);
      ctx.strokeStyle = '#f4e8c8';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(aiming ? 66 : 52, 0);
      ctx.stroke();
      ctx.fillStyle = '#dbe6f2';
      ctx.beginPath();
      ctx.moveTo(aiming ? 74 : 60, 0);
      ctx.lineTo(aiming ? 62 : 48, -4.2);
      ctx.lineTo(aiming ? 62 : 48, 4.2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e0554b';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-11, -7);
      ctx.lineTo(8, -1.2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f2efe6';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-11, 7);
      ctx.lineTo(8, 1.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();

    // راهنمای نشانه‌گیری
    if (aiming) drawAimGuide(ang);
    // نشانگر هدف
    drawReticle();
    // سنجه قدرت
    if (aiming) drawPowerMeter();
  }

  function drawAimGuide(ang) {
    const p = state.power;
    const speed = SPEED_MIN + p * (SPEED_MAX - SPEED_MIN);

    // خط نقطه‌چین جهت
    ctx.save();
    ctx.setLineDash([7, 9]);
    ctx.strokeStyle = `rgba(255, 232, 170, ${0.35 + p * 0.4})`;
    ctx.lineWidth = 2;
    const len = 70 + p * 170;
    ctx.beginPath();
    ctx.moveTo(BOW_X + Math.cos(ang) * 52, BOW_Y + Math.sin(ang) * 52);
    ctx.lineTo(BOW_X + Math.cos(ang) * len, BOW_Y + Math.sin(ang) * len);
    ctx.stroke();
    ctx.restore();

    // پیش‌نمایش کوتاه مسیر (کمک به یادگیری)
    let x = BOW_X + Math.cos(ang) * 46;
    let y = BOW_Y + Math.sin(ang) * 46;
    let vx = Math.cos(ang) * speed;
    let vy = Math.sin(ang) * speed;
    const dt = 0.024;
    ctx.save();
    for (let i = 0; i < 13; i++) {
      vx += state.wind * dt;
      vy += GRAVITY * dt;
      x += vx * dt;
      y += vy * dt;
      if (y > GROUND_Y) break;
      ctx.globalAlpha = 0.5 * (1 - i / 13);
      ctx.fillStyle = '#ffe9b0';
      ctx.beginPath();
      ctx.arc(x, y, 2.2 - i * 0.07, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawReticle() {
    const { x, y } = state.pointer;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(state.time * 0.6);
    ctx.strokeStyle = state.aiming ? 'rgba(255, 214, 120, 0.95)' : 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, -19);
      ctx.lineTo(0, -13);
      ctx.stroke();
      ctx.rotate(Math.PI / 2);
    }
    ctx.restore();
  }

  function drawPowerMeter() {
    const p = state.power;
    const x = 118;
    const y = 392;
    const w = 13;
    const h = 158;

    ctx.save();
    ctx.fillStyle = 'rgba(6, 12, 22, 0.6)';
    roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 8);
    ctx.fill();

    const g = ctx.createLinearGradient(0, y + h, 0, y);
    g.addColorStop(0, '#63d68a');
    g.addColorStop(0.55, '#f4c542');
    g.addColorStop(1, '#ea5b4b');
    ctx.fillStyle = g;
    const fh = h * p;
    roundRect(ctx, x, y + h - fh, w, fh, 6);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 8);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = '600 12px Tahoma, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('قدرت', x + w / 2, y - 12);
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    for (const p of state.particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFloats() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '900 32px Tahoma, sans-serif';
    for (const f of state.floats) {
      const a = clamp(f.life / f.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(6, 10, 20, 0.75)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }

  function drawMotes(t) {
    ctx.save();
    const windDir = Math.sign(state.wind) || 1;
    const speed = 18 + Math.abs(state.wind) * 0.32;
    for (const m of motes) {
      m.x += windDir * speed * (1 / 60) * m.sp;
      m.y += Math.sin(t * 0.9 + m.ph) * 0.35;
      if (m.x > W + 20) m.x = -20;
      if (m.x < -20) m.x = W + 20;
      ctx.globalAlpha = 0.18 + 0.25 * Math.abs(Math.sin(t * 1.3 + m.ph));
      ctx.fillStyle = '#ffd9a0';
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.95);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------- رندر اصلی ---------- */
  function render() {
    const t = state.time;
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // پس‌زمینه بیرون از کادر بازی
    const outer = ctx.createLinearGradient(0, 0, 0, ch);
    outer.addColorStop(0, '#070b13');
    outer.addColorStop(1, '#0e1726');
    ctx.fillStyle = outer;
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.s, view.s);

    roundRect(ctx, 0, 0, W, H, 20);
    ctx.clip();

    // لرزش دوربین
    if (state.shake > 0.2) {
      ctx.translate(rand(-state.shake, state.shake), rand(-state.shake, state.shake));
    }

    drawSky();
    drawStars(t);
    drawSun();
    drawClouds(t);
    drawHills();
    drawTrees();
    drawGround(t);
    drawGroundArrows();
    drawTarget(t);
    drawArcher();
    drawFlyingArrow();
    drawParticles();
    drawFloats();
    drawFgGrass(t);
    drawMotes(t);
    drawVignette();

    // قاب ظریف دور صحنه
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    roundRect(ctx, 1, 1, W - 2, H - 2, 20);
    ctx.stroke();

    ctx.restore();
  }

  /* ---------- حلقه بازی ---------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    update(dt);
    render();

    if (state.mode === 'playing' && state.hintTimer > 0.01) el.hint.classList.add('show');
    else if (state.hintTimer <= 0.01) el.hint.classList.remove('show');

    requestAnimationFrame(frame);
  }

  /* ---------- راه‌اندازی ---------- */
  window.addEventListener('resize', () => {
    resize();
  });
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
  });

  if (((window.location && window.location.search) || '').indexOf('debug') !== -1) {
    window.__archery = { state, view, targetCenter };
  }
  applyInputHints();
  resize();
  updateHUD();
  el.soundBtn.classList.toggle('is-muted', !audio.enabled);
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
})();
