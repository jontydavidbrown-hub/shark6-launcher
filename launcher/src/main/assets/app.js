// Shark 6 launcher home screen. Ported from the approved design (design/sporty-home.dc.html).
// Live values arrive from Android through window.onCar(json); actions go out through window.Car.
'use strict';
const { html, render, Component } = htmPreact;
const Bridge = window.Car || {
  // Browser preview fallback: no car, so nothing happens.
  command: () => 'no-car', sfx: () => {}, openCarPlay: () => {}, media: () => {}, openApp: () => {}, installUpdate: () => { setTimeout(() => window.onUpdateProgress(40), 300); }, toast: (m) => console.log(m)
};

const GEARS = { 1: 'P', 2: 'R', 3: 'N', 4: 'D', 5: 'D', 6: 'D' };
const ENERGY = { 0: 'STANDBY', 1: 'EV MODE', 2: 'EV ONLY', 3: 'HYBRID', 4: 'FUEL', 5: 'HOLD' };
// Shark 6 order (Jonty, 0.37): 5 is Sand and 6 is Mud. 7 is assumed to be Mountain until checked.
const DRIVE = { 1: 'Normal', 2: 'Eco', 3: 'Sport', 4: 'Snow', 5: 'Sand', 6: 'Mud', 7: 'Mountain' };
const driveName = (m) => DRIVE[m] || (typeof m === 'number' ? 'Mode ' + m : '');
// The accent colour follows the drive mode.
const MODE_ACCENT = { 1: '#D42A3A', 2: '#2FBF71', 3: '#FF2D2D', 4: '#5AC8FA', 5: '#E8B04A', 6: '#FF8A00', 7: '#C08A5A' };
const TERRAIN_SUB = { 4: 'GRIP ON SNOW AND ICE', 5: 'FLOAT ON SAND', 6: 'TRACTION IN MUD', 7: 'HILL CLIMB AND DESCENT' };
const CAM_NAMES = ['FRONT', 'RIGHT', 'REAR', 'LEFT'], CAM_ORDER = [0, 2, 3, 1];
const KWH_PRICE = 0.30, FUEL_PRICE = 2.00, BATT_KWH = 29.6, TANK_L = 60;
const call = (name, ...a) => { try { return Bridge[name] ? Bridge[name](...a) : undefined; } catch (e) { return undefined; } };
function readJson(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function writeJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

// Button sounds. Commands pick on/off/tap; any other button or link gets a tap.
let lastSfx = 0;
// Only the on/off sounds play; the plain tap sound is switched off (Jonty, 0.22).
function sfx(name) { lastSfx = Date.now(); if (name === 'tap') return; try { Bridge.sfx(name); } catch (e) {} }
document.addEventListener('click', (e) => {
  const t = e.target && e.target.closest ? e.target.closest('button, a, input') : null;
  if (t && Date.now() - lastSfx > 80 && t.type !== 'range') sfx('tap');
});

function mmss(ms) {
  if (!(ms > 0)) return '0:00';
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

class Home extends Component {
  constructor(props) {
    super(props);
    this.state = { car: {}, boot: 0, slider: null, live: false, welcome: false };
    this.hasTilt = call('hasTilt');
    this.lastTrip = readJson('s6-last-trip');
  }
  // ---- Drive tracking: trip card when you shift to P, low-speed front camera, right indicator ----
  track(car) {
    const now = Date.now(), gear = car.gear, sp = num(car.speed);
    const t = this.trip;
    if (gear >= 2 && gear <= 6) {
      if (!t) {
        this.trip = { t0: now, last: now, km: 0, engKm: 0, kwh0: car.tripKwh, fuel0: car.tripFuel, batt0: car.battPct, fuelPct0: car.fuelPct };
        if (this.state.tripCard) this.setState({ tripCard: null });
      } else {
        const dt = Math.min(5, (now - t.last) / 1000);
        t.last = now;
        const d = sp * dt / 3600;
        t.km += d;
        if (num(car.engineKw) >= 3) t.engKm += d;
      }
    } else if (gear === 1 && t) {
      this.trip = null;
      if (t.km >= 0.5) this.showTripCard(t, car);
    }
  }
  showTripCard(t, car) {
    const delta = (a, b) => (typeof a === 'number' && typeof b === 'number' && b - a >= 0 ? b - a : null);
    let kwh = delta(t.kwh0, car.tripKwh);
    if (kwh == null) kwh = Math.max(0, (num(t.batt0) - num(car.battPct)) / 100 * BATT_KWH);
    let fuel = delta(t.fuel0, car.tripFuel);
    if (fuel == null) fuel = Math.max(0, (num(t.fuelPct0) - num(car.fuelPct)) / 100 * TANK_L);
    const mins = Math.max(1, Math.round((t.last - t.t0) / 60000));
    const ev = Math.round(Math.max(0, Math.min(1, (t.km - t.engKm) / t.km)) * 100);
    const hm = (ms) => { const d = new Date(ms), h = d.getHours(); return ((h % 12) || 12) + ':' + ('0' + d.getMinutes()).slice(-2) + (h < 12 ? ' AM' : ' PM'); };
    const card = {
      when: 'TODAY · ' + hm(t.t0) + ' – ' + hm(t.last),
      km: t.km.toFixed(1), min: mins, avg: Math.round(t.km / (mins / 60)),
      kwh: kwh.toFixed(1), fuel: fuel.toFixed(1), cost: '$' + (kwh * KWH_PRICE + fuel * FUEL_PRICE).toFixed(2),
      ev, at: Date.now()
    };
    writeJson('s6-last-trip', card);
    this.lastTrip = card;
    this.setState({ tripCard: card });
    clearTimeout(this.tripCardT);
    this.tripCardT = setTimeout(() => this.setState({ tripCard: null }), 60000);
  }
  // Front camera takes over the dials in drive under 8 km/h; off above 12, out of drive, or after 5 s stopped.
  evalLow() {
    const c = this.state.car || {}, sp = num(c.speed), drive = c.gear >= 4 && c.gear <= 6, now = Date.now();
    if (sp > 0) this.stoppedAt = 0; else if (!this.stoppedAt) this.stoppedAt = now;
    const stoppedLong = this.stoppedAt && now - this.stoppedAt > 5000;
    let on = !!this.state.lowCam;
    if (!drive || sp > 12 || stoppedLong) on = false;
    else if (sp > 0 && sp < 8) on = true;
    if (on !== !!this.state.lowCam) this.setState({ lowCam: on });
  }
  componentDidMount() {
    window.onCar = (json) => {
      let car;
      try { car = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return; }
      const first = !this.state.live && car.ok;
      if (this.state.car && typeof this.state.car.gear === 'number' && !(car.gear >= 0)) car.gear = this.state.car.gear;
      this.setState({ car, live: !!car.ok });
      if (first && !this.state.welcome) this.playBoot();
      if (car.ok) this.track(car);
      this.evalLow();
    };
    // Live speedo: Android pushes speed + gear every 100 ms when they change.
    window.onFast = (speed, gear, turn) => {
      if (!this.state.live) return;
      const car = Object.assign({}, this.state.car);
      if (speed >= 0) { car.speed = speed; this.speedSample(speed); }
      if (gear >= 0) car.gear = gear;
      // Right indicator: hold the right camera up for 1.5 s after it stops, so it doesn't flicker.
      if (turn === 2) { clearTimeout(this.turnT); if (!this.state.rightCam) this.setState({ rightCam: true }); }
      else if (this.state.rightCam && !this.turnT) this.turnT = setTimeout(() => { this.turnT = null; this.setState({ rightCam: false }); }, 1500);
      if (turn === 2 && this.turnT) { clearTimeout(this.turnT); this.turnT = null; }
      this.setState({ car }, () => this.evalLow());
    };
    window.replayBoot = () => this.playBoot();
    // Smooth dials: readings arrive in steps, so ease the shown values toward them ~30 times a second.
    this.sm = {}; this.smAt = performance.now();
    this.smTimer = setInterval(() => this.smoothStep(), 33);
    // Live camera: Android draws the picture over #s6-cam, so tell it where that box is on screen.
    window.onCamStatus = (t) => this.setState({ camStatus: t || '' });
    this.camTimer = setInterval(() => {
      const k = window.devicePixelRatio || 1;
      // Cameras start once the welcome and the start-up animation are done, so they don't slow it down.
      const covered = this.state.welcome || this.state.tripCard || this.state.diag || this.state.boot < 1;
      const key = ['s6-cam', 's6-cam2', 's6-cam3'].map((id) => {
        const el = covered ? null : document.getElementById(id);
        if (!el) return '0,0,0,0';
        const r = el.getBoundingClientRect();
        return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * k)).join(',');
      }).join(';');
      if (key !== this.camKey) { this.camKey = key; try { Bridge.camRects(key); } catch (e) {} }
      // Which camera each view shows: the top tile turns into the right camera while indicating right.
      const s = this.state, want = [s.rightCam && s.car.gear !== 2 ? 1 : (s.camA == null ? 0 : s.camA), 3, 0].join(',');
      if (want !== this.camWant) { this.camWant = want; want.split(',').forEach((slot, view) => { try { Bridge.camShow(view, +slot); } catch (e) {} }); }
    }, 250);
    window.onCommandResult = (id, r) => this.commandResult(id, r);
    // OTA: Android tells us when a newer build is out, then reports download progress.
    window.onUpdate = (json) => { try { this.setState({ update: JSON.parse(json), updPct: -1, updErr: '', updChecking: false }); } catch (e) {} };
    window.onNoUpdate = () => { this.setState({ updChecking: false }); Bridge.toast('Up to date (' + (call('version') || 'latest') + ')'); };
    window.onUpdateProgress = (p) => this.setState({ updPct: p });
    window.onUpdateFailed = (m) => this.setState({ updPct: -1, updErr: 'Update failed. Try again later.' });
    // Welcome screen once per car start; the dials sweep in after it.
    if (call('firstStart')) {
      this.setState({ welcome: true });
      this.welcomeT = setTimeout(() => this.endWelcome(), 3600);
    } else this.playBoot();
  }
  endWelcome() { clearTimeout(this.welcomeT); if (this.state.welcome) { this.setState({ welcome: false }); this.playBoot(); } }
  playBoot() {
    if (this.raf) cancelAnimationFrame(this.raf);
    const dur = 1800, delay = 250;
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.max(0, Math.min(1, (now - t0 - delay) / dur));
      this.setState({ boot: t });
      if (t < 1) this.raf = requestAnimationFrame(tick);
    };
    this.setState({ boot: 0 });
    this.raf = requestAnimationFrame(tick);
  }
  // Speed history for the power estimate (the car reports whole km/h, so use about a 1.2 s window).
  speedSample(kmh) {
    const now = performance.now(), h = this.spHist = this.spHist || [];
    h.push([now, kmh]);
    while (h.length > 2 && now - h[1][0] > 1200) h.shift();
  }
  // Power in kW, negative while regenerating. The Shark doesn't share motor power with Android,
  // so when it's missing estimate it from how fast the car speeds up or slows down.
  kwTarget(c) {
    if (typeof c.motorKw === 'number') return c.motorKw + Math.max(0, num(c.engineKw));
    const h = this.spHist || [], now = performance.now(), sp = num(c.speed);
    if (!(c.gear >= 2 && c.gear <= 6) || sp < 3 || h.length < 2) return Math.max(0, num(c.engineKw));
    // Speed is a step function of the samples: compare with what it was ~1.2 s ago
    // (so a speed that has held steady reads as no acceleration).
    let ref = h[0];
    for (const x of h) if (x[0] <= now - 1200) ref = x;
    const span = (now - ref[0]) / 1000;
    const a = span > 0.4 ? ((sp - ref[1]) / 3.6) / span : 0;
    const v = sp / 3.6, MASS = 2710;
    const drag = 0.12 + 0.5 * 1.2 * 1.25 * v * v / MASS; // rolling + air, m/s²
    const wheelKw = MASS * (a + drag) * v / 1000;
    // Regen recovers most of the slowing (hard stops also use the brakes); the Shark tops out near 80 kW back.
    const kw = wheelKw < 0 ? Math.max(-80, wheelKw * 0.75) : Math.min(300, wheelKw / 0.9);
    return Math.abs(kw) < 1.5 ? 0 : kw;
  }
  smoothStep() {
    const c = this.state.car || {}, now = performance.now();
    const dt = Math.min(0.2, (now - this.smAt) / 1000); this.smAt = now;
    if (!this.state.live) return;
    // Time constants in seconds: speed stays close to real time, range glides.
    const T = { speed: 0.18, kw: 0.35, totalRange: 0.6, evRange: 0.6, fuelRange: 0.6, battPct: 0.6, fuelPct: 0.6 };
    const tgt = { speed: Math.max(0, num(c.speed)), kw: this.kwTarget(c),
      evRange: num(c.evRange), fuelRange: num(c.fuelRange), battPct: num(c.battPct), fuelPct: num(c.fuelPct) };
    tgt.totalRange = num(c.totalRange, tgt.evRange + tgt.fuelRange);
    let moved = false;
    for (const k in tgt) {
      const t = tgt[k], cur = this.sm[k];
      if (cur === undefined || !isFinite(cur)) { this.sm[k] = t; moved = true; continue; }
      let nv = cur + (t - cur) * (1 - Math.exp(-dt / T[k]));
      if (Math.abs(t - nv) < 0.05) nv = t;
      if (nv !== cur) { this.sm[k] = nv; moved = true; }
    }
    if (moved) this.setState({ smTick: now });
  }
  smv(k, raw) { const v = (this.sm || {})[k]; return typeof v === 'number' && isFinite(v) ? v : raw; }
  ease(t) { return 1 - Math.pow(1 - t, 3); }
  stage(start) {
    const t = Math.max(0, Math.min(1, (this.state.boot - start) / (1 - start)));
    return this.ease(t);
  }
  segs(level, n, color) {
    const out = [];
    for (let i = 1; i <= n; i++) out.push({ c: level >= i ? color : '#333333' });
    return out;
  }
  // Show a tapped value straight away; the car's own reading takes over again after a moment.
  pv(key, real) {
    const p = (this.pending || {})[key];
    return p && p.until > Date.now() ? p.val : real;
  }
  // Commands run in the background on the Android side; the result comes back through
  // window.onCommandResult, so the tap shows instantly and never waits on the car.
  send(name, args, key, val) {
    this.pending = this.pending || {};
    sfx(typeof val === 'boolean' ? (val ? 'on' : 'off') : (name.startsWith('seat') ? (val > 0 ? 'on' : 'off') : 'tap'));
    if (key) { this.pending[key] = { val, until: Date.now() + 3000 }; this.forceUpdate(); }
    this.cmdSeq = (this.cmdSeq || 0) + 1;
    this.cmdKeys = this.cmdKeys || {};
    this.cmdKeys[this.cmdSeq] = key;
    if (args && args.quiet) (this.cmdQuiet = this.cmdQuiet || {})[this.cmdSeq] = true;
    Bridge.command(name, JSON.stringify(Object.assign({ id: this.cmdSeq }, args || {})));
  }
  commandResult(id, r) {
    if (r === 'ok' || (this.cmdQuiet || {})[id]) return;
    const key = (this.cmdKeys || {})[id];
    if (key && this.pending) { delete this.pending[key]; this.forceUpdate(); }
    if (r === 'disabled') Bridge.toast('Climate and seat controls are switched off in this build');
    else Bridge.toast('The car didn\'t accept that (' + r + ')');
  }
  seat(kind, level, zone, color, start) {
    const shown = Math.round(level * this.stage(start));
    const on = level > 0;
    return {
      label: (kind === 'heat' ? 'HEAT ' : 'VENT ') + (on ? level : 'OFF'),
      border: 'none', bg: on ? 'rgba(255,255,255,0.07)' : '#161616',
      icon: on ? color : '#A6A6A6',
      anim: on ? (kind === 'heat' ? 's6-heat' : 's6-spin') + (level > 1 ? ' s6-fast' : '') : '',
      segs: this.segs(shown, 2, color),
      cycle: () => {
        const next = (level + 1) % 3, mine = (zone === 1 ? 'drv' : 'pas') + (kind === 'heat' ? 'Heat' : 'Vent');
        const other = (zone === 1 ? 'drv' : 'pas') + (kind === 'heat' ? 'Vent' : 'Heat');
        if (next > 0) this.pending[other] = { val: 0, until: Date.now() + 3000 };
        this.send(kind === 'heat' ? 'seatHeat' : 'seatVent', { zone, level: next }, mine, next);
      }
    };
  }
  renderVals() {
    const s = this.state, c = s.car || {};
    const accent = MODE_ACCENT[c.opMode] || '#D42A3A';
    if (accent !== this.lastAccent) {
      // The soft glow behind the dials and on the live arcs follows the drive-mode accent.
      this.lastAccent = accent;
      const n = parseInt(accent.slice(1), 16), rgb = (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
      document.documentElement.style.setProperty('--acc-glow', 'rgba(' + rgb + ',0.65)');
      document.documentElement.style.setProperty('--acc-wash', 'rgba(' + rgb + ',0.10)');
    }
    const set = (o) => this.setState(o);
    const kRange = this.stage(0), kBars = this.stage(0.1), kClimate = this.stage(0.25), kMusic = this.stage(0.35);
    const count = (v, k) => Math.round(v * k);
    const tempUp = (v, k) => Math.round((16 + (v - 16) * k) * 2) / 2;

    // Smoothed values (see smoothStep) so the dials glide between the car's readings.
    const battPct = this.smv('battPct', num(c.battPct)), fuelPct = this.smv('fuelPct', num(c.fuelPct));
    const evRange = this.smv('evRange', num(c.evRange)), fuelRange = this.smv('fuelRange', num(c.fuelRange));
    const totalRange = this.smv('totalRange', num(c.totalRange, evRange + fuelRange));
    const speedF = Math.max(0, this.smv('speed', num(c.speed)));
    const MAX = 180, b = s.boot;
    // Count straight up from 0 to the current speed (no full-scale sweep).
    const speedArc = b >= 1 ? speedF : Math.min(speedF, MAX) * this.stage(0);
    const shownSpeed = Math.round(speedArc);

    const gear = GEARS[c.gear] || '';
    const gearColor = (g) => (gear === g ? accent : '#4A4A4A');

    // Power: motor kW (negative = regen) plus engine kW when it is running.
    const engineKw = num(c.engineKw);
    const kw = this.smv('kw', this.kwTarget(c));
    const hasPower = !!s.live;
    const regen = kw <= -1;
    const span = Math.min(1, Math.abs(kw) / 150) * 50 * kBars;

    const em = c.energyMode;
    const engineOn = engineKw >= 3;
    const modeLabel = ENERGY[em] || '—';
    const drive = driveName(c.opMode);
    const modePower = (drive ? drive + ' · ' : '') + (hasPower
      ? (regen ? Math.round(-kw) + ' kW back to battery' : engineOn ? 'Engine ' + Math.round(engineKw) + ' kW' : Math.round(kw) + ' kW out')
      : 'Power reading unavailable');

    const tyres = Array.isArray(c.tyres) ? c.tyres : [];
    const tyre = (i) => (typeof tyres[i] === 'number' ? (tyres[i] * kBars).toFixed(1) : '—');
    const tyreLow = Array.isArray(c.tyreStates) && c.tyreStates.some((x) => x === 2);
    const tyreColor = (i) => (Array.isArray(c.tyreStates) && c.tyreStates[i] && c.tyreStates[i] !== 0 ? '#FF8A00' : '#F2F2F2');

    const tripKm = num(c.tripKm), tripKwh = num(c.tripKwh);
    const offA = ((this.tripOff || {}).A) || 0, kmA = Math.max(0, tripKm - offA);
    // After a local reset the car's per-drive kWh no longer matches the trip, so use the car's average.
    const per100 = offA ? num(c.avgElec) : kmA >= 1 ? (tripKwh / kmA) * 100 : 0;

    const m = c.media || {};
    const hasMedia = !!m.title;
    const pos = num(m.pos), dur = num(m.dur);

    this.pending = this.pending || {};
    // Whole degrees only.
    const drvTemp = Math.round(this.pv('drvTemp', num(c.drvTemp, 21))), pasTemp = Math.round(this.pv('pasTemp', num(c.pasTemp, 21)));
    const fan = this.pv('fan', num(c.fan));
    const ac = this.pv('ac', !!c.compressor), auto = this.pv('auto', !!c.auto), demist = this.pv('demist', !!c.demist), recirc = this.pv('recirc', !!c.recirc);
    const st = (on, color) => ({ border: on ? '2px solid ' + color : '1px solid #2A2A2A', bg: on ? '#1A1A1A' : '#161616', icon: on ? color : '#A6A6A6', text: on ? '#F2F2F2' : '#A6A6A6' });
    // SYNC is our own setting: read from the car once, then only the SYNC button changes it.
    // Sync always starts on: on the first car reading after launch, join the zones if the car has them split.
    if (this.syncMode === undefined && c.dual !== undefined) {
      this.syncMode = true; (this.cmdQuiet = this.cmdQuiet || {})[0] = true;
      if (c.dual === 1 && typeof c.drvTemp === 'number') Bridge.command('sync', JSON.stringify({ id: 0, on: true, value: c.drvTemp }));
    }
    const synced = this.syncMode === undefined ? true : this.syncMode;
    // When synced, a temp change applies to both sides (the car keeps the zones joined).
    const setTemp = (zone, value) => {
      if (synced) this.pending[zone === 1 ? 'pasTemp' : 'drvTemp'] = { val: value, until: Date.now() + 3000 };
      this.send('temp', { zone, value, both: synced }, zone === 1 ? 'drvTemp' : 'pasTemp', value);
    };
    const rc = st(recirc, '#5AC8FA');
    const d = st(demist, '#FF8A00'), a = st(ac, '#2FB3FF'), u = st(auto, accent), y = st(synced, '#F2F2F2');
    const cs = c.seats || {};
    const seats = { drvHeat: this.pv('drvHeat', cs.drvHeat), drvVent: this.pv('drvVent', cs.drvVent),
      pasHeat: this.pv('pasHeat', cs.pasHeat), pasVent: this.pv('pasVent', cs.pasVent) };
    const clampT = (v) => Math.max(17, Math.min(33, Math.round(v)));

    return {
      accent,
      liveLabel: s.live ? 'LIVE' : 'NO CAR DATA', liveColor: s.live ? '#4ADE80' : '#A6A6A6',
      battPct: count(battPct, kBars), fuelPct: count(fuelPct, kBars),
      evRange: count(evRange, kBars), fuelRange: count(fuelRange, kBars), totalRange: count(totalRange, kRange),
      rangeDash: (641 * Math.min(1, totalRange / 1000) * kRange).toFixed(1) + ' 1000',
      battDash: (518 * battPct / 100 * kBars).toFixed(1) + ' 1000',
      gearP: gearColor('P'), gearR: gearColor('R'), gearN: gearColor('N'), gearD: gearColor('D'),
      speed: shownSpeed,
      avgElec: (num(c.avgElec) * kBars).toFixed(1), avgFuel: (num(c.avgFuel) * kBars).toFixed(1),
      driveMode: (drive || '—').toUpperCase(), outside: typeof c.outside === 'number' ? Math.round(c.outside * kBars) : '—',
      replayBoot: () => this.playBoot(),
      speedDash: (586 * Math.min(speedArc, MAX) / MAX).toFixed(1) + ' 2000',
      powerLeft: regen ? 50 - span : 50, powerWidth: span,
      powerColor: regen ? '#4ADE80' : accent,
      powerLabel: hasPower ? Math.round(kw * kBars) + ' kW' : '— kW',
      modeLabel, modePower,
      battLine: em === 4 ? '#262626' : (regen ? '#4ADE80' : accent),
      engLine: engineOn ? '#F2F2F2' : '#262626', engText: engineOn ? '#F2F2F2' : '#A6A6A6',
      openEnergy: () => Bridge.openApp('energy'),
      tyreFL: tyre(0), tyreFR: tyre(1), tyreRL: tyre(2), tyreRR: tyre(3),
      tyreFLc: tyreColor(0), tyreFRc: tyreColor(1), tyreRLc: tyreColor(2), tyreRRc: tyreColor(3),
      modeShort: em === 3 ? 'HEV' : em === 4 ? 'FUEL' : (em === 1 || em === 2) ? 'EV' : '—',
      modeSub: hasPower ? (regen ? 'Regen ' + Math.round(-kw) + ' kW' : engineOn ? 'Engine running' : 'Electric drive') : (em === 3 ? 'Hybrid' : em === 1 || em === 2 ? 'Electric' : ''),
      modeColor: em === 1 || em === 2 ? '#4ADE80' : '#F2F2F2',
      diagOpen: !!s.diag, diagClose: () => this.setState({ diag: null }), diagStop: (e) => { if (e) e.stopPropagation(); },
      ...(() => {
        // First line of the Android diagnostics carries "SIDELOAD|address|pin"; the rest is shown as text.
        const d = s.diag || '', nl = d.indexOf('\n'), head = d.startsWith('SIDELOAD|') ? d.slice(0, nl < 0 ? d.length : nl).split('|') : null;
        return { diagText: head ? d.slice(nl + 1) : d, sideAddr: head ? head[1] : 'update the app', sidePin: head ? head[2] : '----' };
      })(),
      diagHoldStart: () => {
        clearTimeout(this.diagT); this.diagAt = Date.now();
        this.diagT = setTimeout(() => {
          const raw = { opMode: c.opMode, gear: c.gear, speed: c.speed, tilt: c.tilt, rightCam: !!s.rightCam, lowCam: !!s.lowCam };
          this.setState({ diag: (call('diag') || 'no Android bridge') + '\npage: ' + JSON.stringify(raw) });
        }, 2000);
      },
      // A quick tap on the clock opens BYD's own home screen (this app is the car's home now).
      diagHoldEnd: (e) => {
        clearTimeout(this.diagT);
        const tap = this.diagAt && Date.now() - this.diagAt < 600;
        this.diagAt = 0;
        if (tap && e && e.type === 'pointerup') { sfx('tap'); Bridge.openApp('byd'); }
      },
      tyreNote: tyres.length ? (tyreLow ? 'psi · CHECK' : 'psi · all OK') : 'psi',
      tyreState: tyres.length ? (tyreLow ? 'CHECK TYRES' : 'ALL OK') : '',
      tyreStateColor: tyreLow ? '#FF8A00' : '#5A5A62',
      ...(() => {
        // Right indicator camera, low-speed front camera, off-road view.
        const rightBig = !!s.rightCam && c.gear !== 2;
        const off = c.opMode >= 4;
        const tl = c.tilt, has = tl && typeof tl.p === 'number';
        const deg = (v) => (has ? Math.round(Math.abs(v)) + '°' : '—');
        return {
          lowCam: !!s.lowCam,
          offroad: off, terrainName: driveName(c.opMode).toUpperCase(), terrainSub: TERRAIN_SUB[c.opMode] || 'TERRAIN MODE',
          pitchText: deg(has ? tl.p : 0), rollText: deg(has ? tl.r : 0),
          pitchRot: 'rotate(' + (has ? Math.max(-45, Math.min(45, -tl.p)) : 0) + ' 150 150)',
          rollRot: 'rotate(' + (has ? Math.max(-45, Math.min(45, tl.r)) : 0) + ' 150 150)',
          tiltNote: this.hasTilt === false ? 'NO TILT SENSOR' : 'HOLD TO ZERO',
          tiltHoldPct: s.tiltHold ? 100 : 0, tiltHoldAnim: s.tiltHold ? 'width 1s linear' : 'none',
          tiltHoldStart: () => {
            clearTimeout(this.tiltT); this.setState({ tiltHold: true });
            this.tiltT = setTimeout(() => { this.setState({ tiltHold: false }); sfx('on'); call('zeroTilt'); call('toast', 'Tilt zeroed. Do this on flat ground.'); }, 1000);
          },
          tiltHoldEnd: () => { clearTimeout(this.tiltT); if (this.state.tiltHold) this.setState({ tiltHold: false }); }
        };
      })(),
      ...(() => {
        // Trip complete card and the welcome screen.
        const tc = s.tripCard;
        const hr = new Date().getHours();
        const last = this.lastTrip;
        const tyreOk = tyres.length ? (tyreLow ? 'CHECK' : 'OK') : '—';
        const dual = c.dual === 1;
        const cabin = typeof c.drvTemp === 'number' ? 'Cabin ' + Math.round(c.drvTemp) + '°' + (dual && typeof c.pasTemp === 'number' ? ' / ' + Math.round(c.pasTemp) + '°' : '') + (c.compressor ? ', A/C on' : '') : '';
        const lastTxt = last && last.km ? 'Last trip ' + last.km + ' km, about ' + last.cost : '';
        return {
          tripCard: !!tc, tcWhen: tc ? tc.when : '', tcKm: tc ? tc.km : '', tcMin: tc ? tc.min : '', tcAvg: tc ? tc.avg : '',
          tcKwh: tc ? tc.kwh : '', tcFuel: tc ? tc.fuel : '', tcCost: tc ? tc.cost : '', tcEv: tc ? tc.ev : 0, tcEng: tc ? 100 - tc.ev : 0,
          tripDone: () => { clearTimeout(this.tripCardT); this.setState({ tripCard: null }); },
          welcome: !!s.welcome, skipWelcome: () => this.endWelcome(),
          welcomeGreet: hr < 12 ? 'GOOD MORNING' : hr < 17 ? 'GOOD AFTERNOON' : 'GOOD EVENING',
          wRange: s.live ? Math.round(totalRange) : '—', wBatt: s.live ? Math.round(battPct) : '—', wFuel: s.live ? Math.round(fuelPct) : '—',
          wOut: typeof c.outside === 'number' ? Math.round(c.outside) : '—', wTyres: tyreOk,
          wNote: [cabin, lastTxt].filter(Boolean).join(' · ')
        };
      })(),
      ...(() => {
        // One camera tile: tap cycles front, rear, left, right. While indicating right it shows the right camera.
        const a = s.camA == null ? 0 : s.camA, at = CAM_ORDER.indexOf(a), st = s.camStatus || '';
        const ind = !!s.rightCam && c.gear !== 2, shown = ind ? 1 : a;
        const dot = (i) => (CAM_ORDER[i] === shown ? '#F2F2F2' : '#333333');
        return { camName: ind ? 'RIGHT ›' : CAM_NAMES[a], camImage: 'none', camStatus: st,
          camNext: () => this.setState({ camA: CAM_ORDER[(at + 1) % 4] }),
          camBorder: ind ? '#FFB020' : '#262626', camGlow: ind ? '0 0 0 2px rgba(255,176,32,0.35)' : 'none',
          camNameColor: ind ? '#FFB020' : '#F2F2F2', camDot0: dot(0), camDot1: dot(1), camDot2: dot(2), camDot3: dot(3) };
      })(),
      ...(() => {
        // Clock (BYD's header is hidden). The car poll re-renders every second, so it stays current.
        const d = new Date(), hr = d.getHours();
        return { clockTime: ((hr % 12) || 12) + ':' + ('0' + d.getMinutes()).slice(-2), clockAmPm: hr < 12 ? 'AM' : 'PM' };
      })(),
      ...(() => {
        // Trip tile: tap switches A/B, hold 1 s resets the trip shown (car's own trip meters).
        // A reset also zeroes a local offset, so the tile reads 0 even if the car ignores the reset.
        // If the car's meter does reset (drops below the offset), the offset is dropped.
        const b = s.trip === 'B', which = b ? 'B' : 'A';
        const raw = b ? num(c.trip2Km) : tripKm;
        const off = this.tripOff || (this.tripOff = readJson('s6-trip-off') || {});
        if (off[which] != null && raw < off[which] - 0.05) { delete off[which]; writeJson('s6-trip-off', off); }
        const km = Math.max(0, raw - (off[which] || 0));
        return {
          tripName: b ? 'B' : 'A', tripAColor: b ? '#555555' : '#F2F2F2', tripBColor: b ? '#F2F2F2' : '#555555',
          tripKm: (km * kBars).toFixed(1), tripKwh: b ? '—' : (per100 * kBars).toFixed(1),
          tripHoldPct: s.tripHold ? 100 : 0, tripHoldAnim: s.tripHold ? 'width 1s linear' : 'none',
          tripTap: () => { if (this.tripDidReset) { this.tripDidReset = false; return; } this.setState({ trip: b ? 'A' : 'B' }); },
          tripHoldStart: () => {
            clearTimeout(this.tripT); this.tripDidReset = false; this.setState({ tripHold: true });
            this.tripT = setTimeout(() => {
              this.tripDidReset = true; this.setState({ tripHold: false }); sfx('off');
              off[which] = raw; writeJson('s6-trip-off', off);
              this.send('resetTrip', { trip: which, quiet: true });
            }, 1000);
          },
          tripHoldEnd: () => { clearTimeout(this.tripT); if (this.state.tripHold) this.setState({ tripHold: false }); }
        };
      })(),
      tripFuel: num(c.tripFuel) > 0 ? num(c.tripFuel).toFixed(1) + ' L fuel' : 'no fuel used',
      odo: Math.round(num(c.odo)).toLocaleString('en-AU'),
      openCarPlay: (e) => { if (e) e.preventDefault(); Bridge.openCarPlay(); },
      trackTitle: hasMedia ? m.title : 'Nothing playing',
      trackSub: hasMedia ? [m.artist, m.app].filter(Boolean).join(' · ') : 'Start music in CarPlay',
      artBg: m.art ? 'url(' + m.art + ')' : 'none', noteColor: m.art ? 'transparent' : '#4A4A4A',
      musicPct: dur > 0 ? Math.round(Math.min(1, pos / dur) * 100 * kMusic) : 0,
      posText: mmss(pos), durText: mmss(dur),
      ...(() => {
        // Flip the button straight away; the car's state takes over again after 3 s.
        const on = !!this.pv('mediaPlaying', !!m.playing);
        return { playing: on, paused: !on, playLabel: on ? 'Pause' : 'Play',
          togglePlay: () => { this.pending = this.pending || {}; this.pending.mediaPlaying = { val: !on, until: Date.now() + 3000 }; this.forceUpdate(); Bridge.media(on ? 'pause' : 'play'); } };
      })(),
      prevTrack: () => Bridge.media('prev'), nextTrack: () => Bridge.media('next'),
      drvTemp, pasTemp, // shown straight away, no count-up at launch
      drvUp: () => setTemp(1, clampT(drvTemp + 1)), drvDown: () => setTemp(1, clampT(drvTemp - 1)),
      pasUp: () => setTemp(2, clampT(pasTemp + 1)), pasDown: () => setTemp(2, clampT(pasTemp - 1)),
      fanLabel: auto ? 'AUTO' : String(fan),
      fanAnim: fan > 0 ? 's6-spin s6-slow' : '', fanSegs: this.segs(Math.round(fan * kClimate), 7, accent),
      ac, auto, demist,
      demistBorder: d.border, demistBg: d.bg, demistIcon: d.icon, demistText: d.text,
      acBorder: a.border, acBg: a.bg, acIcon: a.icon, acText: a.text,
      autoBorder: u.border, autoBg: u.bg, autoIcon: u.icon, autoText: u.text,
      synced, toggleSync: () => { this.syncMode = !synced; if (this.syncMode) this.pending.pasTemp = { val: drvTemp, until: Date.now() + 3000 }; this.send('sync', { on: !synced, value: drvTemp }); this.forceUpdate(); },
      syncBorder: y.border, syncBg: y.bg, syncIcon: y.icon, syncText: y.text,
      toggleAc: () => this.send('ac', { on: !ac }, 'ac', !ac),
      toggleAuto: () => this.send('auto', { on: !auto }, 'auto', !auto),
      toggleDemist: () => this.send('demist', { on: !demist }, 'demist', !demist),
      recirc, recircBorder: rc.border, recircBg: rc.bg, recircIcon: rc.icon, recircLabel: recirc ? 'RECIRC' : 'FRESH AIR',
      recircPath: recirc ? 'M572-546.94q0-45.06-31.17-76.56T465-655H316q-8.23 0-13.62 5.34-5.38 5.33-5.38 13.5 0 8.16 5.38 14.16 5.39 6 13.62 6h149q28.02 0 47.51 20.07Q532-575.85 532-547q0 28.44-19.49 48.22Q493.02-479 465-479H357l25-26q6-6 6-14t-6-14q-6-6-14-6t-14 6l-52 53q-9 8.8-9 20.9 0 12.1 9 21.1l52 53q5 5 13.5 5.5t14.5-5q6-5.5 6-13.86 0-8.37-6-14.64l-25-26h108q44.66 0 75.83-31.44Q572-501.89 572-546.94ZM255-160q-40 0-72.5-23.5T133-243H30q-12.75 0-21.37-8.63Q0-260.25 0-273v-219q0-24 18-42t42-18h60l64-181q7.93-21.28 26.01-34.14Q228.08-780 251-780h306q19 0 35 9t26 26l102 172 180 15q24 2 42 21.5t18 43.5v220q0 12.75-8.62 21.37Q942.75-243 930-243H827q-17 37-49.5 60T705-160q-40 0-72.5-23.5T583-243H377q-17 37-49.5 60T255-160Zm.71-60Q286-220 307-241.58q21-21.59 21-52.42 0-3.6 2-6.3 2-2.7 6-2.7h288q3.6 0 6.3 2.7 2.7 2.7 2.7 6.3 0 30.83 21.29 52.42Q675.58-220 706-220q30 0 51-21.58 21-21.59 21-52.42 0-3.6 2-6.3 2-2.7 6-2.7h115v-194l-202-18q-8-1-13.71-4.61-5.72-3.61-9.29-9.39L563-720H243.74L169-512q-3 9-10.58 14.5-7.57 5.5-17.42 5.5H60v189h114q3.6 0 6.3 2.7 2.7 2.7 2.7 6.3 0 30.83 21.21 52.42 21.2 21.58 51.5 21.58ZM480-470Z' : 'M461-160q-38 0-69-22t-41-59q-3-13 6.5-23t23.5-10q11 0 19 7.5t13 18.5q6 14 19.5 21t28.5 7q23 0 38.5-15.5T515-274q0-23-15.5-38.5T461-328H110q-13 0-21.5-8.5T80-358q0-13 8.5-21.5T110-388h351q48 0 81 33t33 81q0 48-33 81t-81 33ZM110-568q-13 0-21.5-8.5T80-598q0-13 8.5-21.5T110-628h513q32 0 54-22t22-54q0-32-22-54t-54-22q-23 0-42 12t-26 33q-4 11-12.5 19t-19.5 8q-14 0-22.5-9.5T495-740q11-45 46.5-72.5T623-840q57 0 96.5 39.5T759-704q0 57-39.5 96.5T623-568H110Zm670 321q-13 2-22.5-6.5T748-276q0-11 8-19.5t19-12.5q22-7 33.5-26t11.5-42q0-30-21-51t-51-21H110q-13 0-21.5-8.5T80-478q0-13 8.5-21.5T110-508h638q55 0 93.5 38.5T880-376q0 47-27.5 83T780-247Z',
      toggleRecirc: () => this.send('recirc', { on: !recirc }, 'recirc', !recirc),
      drvHeat: this.seat('heat', num(seats.drvHeat), 1, '#FF8A00', 0.3),
      drvVent: this.seat('vent', num(seats.drvVent), 1, '#2FB3FF', 0.3),
      pasHeat: this.seat('heat', num(seats.pasHeat), 2, '#FF8A00', 0.4),
      pasVent: this.seat('vent', num(seats.pasVent), 2, '#2FB3FF', 0.4),
      // Temperature / fan bar: slides over the climate strip, closes after 5 s idle or a tap outside.
      openDrv: () => { set({ slider: 'drv' }); this.armClose(); }, openPas: () => { set({ slider: 'pas' }); this.armClose(); },
      openFan: () => { set({ slider: 'fan' }); this.armClose(); },
      closeSlider: () => { clearTimeout(this.closeT); set({ slider: null }); },
      sliderOpen: !!s.slider, sliderIsTemp: !!s.slider && s.slider !== 'fan', sliderIsFan: s.slider === 'fan',
      sliderTitle: s.slider === 'fan' ? 'FAN' : s.slider === 'pas' ? 'PASSENGER' : 'DRIVER',
      sliderMin: s.slider === 'fan' ? 1 : 17, sliderMax: s.slider === 'fan' ? 7 : 33, sliderStep: 1,
      sliderValue: s.slider === 'fan' ? fan : (s.slider === 'pas' ? pasTemp : drvTemp),
      sliderText: s.slider === 'fan' ? String(fan) : (s.slider === 'pas' ? pasTemp : drvTemp) + '°',
      sliderTextColor: s.slider === 'fan' || !s.slider ? '#F2F2F2' : (s.slider === 'pas' ? pasTemp : drvTemp) < 22 ? '#2FB3FF' : (s.slider === 'pas' ? pasTemp : drvTemp) > 22 ? '#D42A3A' : '#F2F2F2',
      thumbClass: s.slider === 'fan' || !s.slider ? 's6-fan' : (s.slider === 'pas' ? pasTemp : drvTemp) < 22 ? 's6-cool' : (s.slider === 'pas' ? pasTemp : drvTemp) > 22 ? 's6-warm' : '',
      fanPct: Math.round((Math.max(1, fan) - 1) / 6 * 100),
      sliderStepDown: () => { this.armClose(); if (s.slider === 'fan') (l => this.send('fan', { level: l }, 'fan', l))(Math.max(1, fan - 1)); else setTemp(s.slider === 'pas' ? 2 : 1, Math.max(17, (s.slider === 'pas' ? pasTemp : drvTemp) - 1)); },
      sliderStepUp: () => { this.armClose(); if (s.slider === 'fan') (l => this.send('fan', { level: l }, 'fan', l))(Math.min(7, fan + 1)); else setTemp(s.slider === 'pas' ? 2 : 1, Math.min(33, (s.slider === 'pas' ? pasTemp : drvTemp) + 1)); },
      openCameras: (e) => { if (e) e.preventDefault(); Bridge.openApp('cameras'); },
      checkUpdates: () => {
        if (s.updChecking) return;
        sfx('tap'); this.setState({ updChecking: true });
        try { Bridge.checkUpdate(); } catch (e) { this.setState({ updChecking: false }); }
        setTimeout(() => { if (this.state.updChecking) { this.setState({ updChecking: false }); Bridge.toast('Couldn\'t check for updates. Is the car online?'); } }, 20000);
      },
      updIconColor: s.updChecking ? accent : '#A6A6A6', updSpin: s.updChecking ? 's6-spin 1s linear infinite' : 'none',
      updateOpen: !!s.update, updateName: s.update ? s.update.name : '',
      updateBusy: s.updPct >= 0, updateIdle: !(s.updPct >= 0), updatePct: Math.max(0, s.updPct || 0), updateBarOpacity: s.updPct >= 0 ? 1 : 0,
      updateNote: s.updErr || (s.updPct >= 100 ? 'Confirm on the screen that opens' : s.updPct >= 0 ? 'Downloading ' + s.updPct + '%' : 'A new version of the home screen is ready'),
      updateLater: () => this.setState({ update: null }),
      updateInstall: () => { sfx('on'); this.setState({ updPct: 0, updErr: '' }); try { Bridge.installUpdate(s.update.url); } catch (e) { this.setState({ updPct: -1, updErr: 'Update failed. Try again later.' }); } },
      onSlide: (e) => {
        this.armClose();
        const v = parseInt(e.target.value, 10), which = s.slider;
        const key = which === 'fan' ? 'fan' : which === 'pas' ? 'pasTemp' : 'drvTemp';
        this.pending[key] = { val: v, until: Date.now() + 3000 };
        if (synced && key !== 'fan') this.pending[key === 'drvTemp' ? 'pasTemp' : 'drvTemp'] = { val: v, until: Date.now() + 3000 };
        this.forceUpdate();
        clearTimeout(this.slideTimer);
        this.slideTimer = setTimeout(() => {
          if (which === 'fan') this.send('fan', { level: v }, 'fan', v);
          else setTemp(which === 'pas' ? 2 : 1, v);
        }, 350);
      }
    };
  }
  armClose() { clearTimeout(this.closeT); this.closeT = setTimeout(() => this.setState({ slider: null }), 5000); }
  render() {
    const v = this.renderVals();
    return html`
<div style="width: 100%; height: 900px; box-sizing: border-box; padding: 20px 28px 28px; background: #050505; color: #F2F2F2; font-family: Barlow, system-ui, sans-serif; position: relative; display: grid; grid-template-columns: minmax(0, 0.97fr) minmax(0, 1.14fr) minmax(0, 1.14fr) minmax(0, 1fr); grid-template-rows: 44px minmax(0, 1fr) 140px; gap: 18px;">

  
  <div aria-label="Status" style="grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; min-height: 0;">
    <div style="display: flex; align-items: baseline; padding-left: 4px;"><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 28px; line-height: 1; white-space: nowrap;">${v.avgElec}</span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 17px; color: #A6A6A6; letter-spacing: 0.06em; margin-left: 5px;">KWH/100 AVG</span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 28px; line-height: 1; white-space: nowrap; margin-left: 28px;">${v.avgFuel}</span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 17px; color: #A6A6A6; letter-spacing: 0.06em; margin-left: 5px;">L/100 AVG</span></div>
    <div aria-label="Time" onPointerDown=${v.diagHoldStart} onPointerUp=${v.diagHoldEnd} onPointerLeave=${v.diagHoldEnd} style="display: flex; align-items: baseline; padding: 0 24px;"><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 36px; line-height: 1; letter-spacing: 0.02em;">${v.clockTime}</span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 20px; color: #A6A6A6; letter-spacing: 0.06em; margin-left: 6px;">${v.clockAmPm}</span></div>
    <div style="display: flex; align-items: baseline; justify-content: flex-end; padding-right: 4px;"><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 28px; line-height: 1; white-space: nowrap;">${v.driveMode}</span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 17px; color: #A6A6A6; letter-spacing: 0.06em; margin-left: 5px;">MODE</span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 28px; line-height: 1; white-space: nowrap; margin-left: 28px;">${v.outside}°</span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 17px; color: #A6A6A6; letter-spacing: 0.06em; margin-left: 5px;">OUTSIDE</span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 28px; line-height: 1; white-space: nowrap; margin-left: 28px;">${v.odo}</span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 17px; color: #A6A6A6; letter-spacing: 0.06em; margin-left: 5px;">KM ODO</span><button type="button" onClick=${v.checkUpdates} aria-label="Check for updates" style="margin-left: 24px; width: 40px; height: 40px; align-self: center; background: #111111; border: 1px solid #262626; border-radius: 8px; display: flex; align-items: center; justify-content: center; padding: 0; cursor: pointer;"><svg width="24" height="24" viewBox="0 -960 960 960" aria-hidden="true" style="animation: ${v.updSpin};"><path fill=${v.updIconColor} d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/></svg></button></div>
  </div>

  
  <section aria-label="Media and shortcuts" style="display: grid; grid-template-rows: 256px minmax(0, 1fr); gap: 14px; min-height: 0; min-width: 0; overflow: hidden;">

    <div aria-label="Tyre pressures" style="background: #111111; border: 1px solid #262626; border-radius: 8px; position: relative; min-height: 0; min-width: 0; overflow: hidden;">
      <svg width="84" height="176" viewBox="0 0 84 176" aria-hidden="true" style="position: absolute; left: 50%; top: 50%; margin: -88px 0 0 -42px;">
        <rect x="8" y="6" width="68" height="164" rx="22" fill="rgba(255,255,255,0.05)" stroke="#3A3A40" stroke-width="2"></rect>
        <path d="M16 52 Q42 40 68 52 L64 76 Q42 70 20 76 Z" fill="rgba(255,255,255,0.08)"></path>
        <rect x="16" y="92" width="52" height="66" rx="8" fill="none" stroke="#2C2C32" stroke-width="2"></rect>
        <rect x="0" y="26" width="9" height="30" rx="4" fill=${v.tyreFLc}></rect><rect x="75" y="26" width="9" height="30" rx="4" fill=${v.tyreFRc}></rect>
        <rect x="0" y="118" width="9" height="30" rx="4" fill=${v.tyreRLc}></rect><rect x="75" y="118" width="9" height="30" rx="4" fill=${v.tyreRRc}></rect>
      </svg>
      <span style="position: absolute; left: 24px; top: 40px; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 40px; color: ${v.tyreFLc};">${v.tyreFL}</span>
      <span style="position: absolute; right: 24px; top: 40px; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 40px; color: ${v.tyreFRc};">${v.tyreFR}</span>
      <span style="position: absolute; left: 24px; bottom: 50px; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 40px; color: ${v.tyreRLc};">${v.tyreRL}</span>
      <span style="position: absolute; right: 24px; bottom: 50px; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 40px; color: ${v.tyreRRc};">${v.tyreRR}</span>
      <span style="position: absolute; left: 24px; top: 16px; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.18em; color: #6B6B72;">PSI</span>
      <span style="position: absolute; left: 0; right: 0; bottom: 16px; text-align: center; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 14px; letter-spacing: 0.18em; color: ${v.tyreStateColor};">${v.tyreState}</span>
    </div>

    <section aria-label="Now playing" class="gy-12" style="background: #111111; border: 1px solid #262626; border-radius: 8px; padding: 18px 22px; display: flex; flex-direction: column; justify-content: space-between;  min-height: 0; min-width: 0; overflow: hidden;">
      <div class="gx-16" style="display: flex; align-items: center;  min-width: 0;">
        <a href="#" onClick=${v.openCarPlay} aria-label="Open CarPlay" style="text-decoration: none; position: relative; display: block; width: 116px; height: 116px; flex-shrink: 0;"><div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: #1E1E1E center / cover no-repeat; background-image: ${v.artBg}; border-radius: 6px; display: flex; align-items: center; justify-content: center;">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke=${v.noteColor} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
      </div><span style="position: absolute; right: -6px; bottom: -6px; width: 40px; height: 40px; border-radius: 12px; background: rgba(12,12,14,0.85); display: flex; align-items: center; justify-content: center;"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5" stroke="#F2F2F2" stroke-width="2"></rect><path d="M9.2 8.3v7.4c0 .6.6.9 1.1.6l5.6-3.7c.4-.3.4-.9 0-1.2l-5.6-3.7c-.5-.3-1.1 0-1.1.6z" fill="#F2F2F2"></path></svg></span></a>
        <div style="flex: 1 1 0; min-width: 0;"><div style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 28px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${v.trackTitle}</div><div style="font-size: 16px; color: #A6A6A6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${v.trackSub}</div></div>
      </div>
      <div class="gy-6" style="display: flex; flex-direction: column;">
        <div style="height: 4px; background: #262626;"><div style="width: ${v.musicPct}%; height: 4px; background: ${v.accent};"></div></div>
        <div style="display: flex; justify-content: space-between; font-size: 17px; color: #A6A6A6;"><span>${v.posText}</span><span>${v.durText}</span></div>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <button type="button" onClick=${v.prevTrack} aria-label="Previous track" style="width: 60px; height: 60px; border: 1px solid #333; background: transparent; border-radius: 6px;"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F2F2F2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 20L9 12l10-8v16z"></path><path d="M5 19V5"></path></svg></button>
        <button type="button" onClick=${v.togglePlay} aria-label=${v.playLabel} style="width: 128px; height: 64px; border: 0; background: ${v.accent}; border-radius: 6px; transform: skewX(-8deg);">
          ${v.playing ? html`<svg width="26" height="26" viewBox="0 0 24 24" fill="#0A0A0A" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>` : null}
          ${v.paused ? html`<svg width="26" height="26" viewBox="0 0 24 24" fill="#0A0A0A" aria-hidden="true"><path d="M7 4l13 8-13 8z"></path></svg>` : null}
        </button>
        <button type="button" onClick=${v.nextTrack} aria-label="Next track" style="width: 60px; height: 60px; border: 1px solid #333; background: transparent; border-radius: 6px;"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F2F2F2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4l10 8-10 8V4z"></path><path d="M19 5v14"></path></svg></button>
      </div>
    </section>
  </section>

  
  <section aria-label="Drive" style="grid-column: span 2; position: relative; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: 104px minmax(0, 1fr); column-gap: 18px; row-gap: 14px; min-height: 0; min-width: 0;">

    <div aria-label="Trip ${v.tripName}. Tap to switch trip, hold to reset" onClick=${v.tripTap} onPointerDown=${v.tripHoldStart} onPointerUp=${v.tripHoldEnd} onPointerLeave=${v.tripHoldEnd} onPointerCancel=${v.tripHoldEnd} style="grid-column: 1 / -1; background: #111111; border: 1px solid #262626; border-radius: 8px; padding: 12px 16px; display: flex; flex-direction: column; justify-content: space-between; min-height: 0; min-width: 0; overflow: hidden; position: relative; cursor: pointer;">
      <div style="display: flex; justify-content: space-between; align-items: baseline;">
        <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 17px; letter-spacing: 0.12em; color: ${v.accent};">TRIP ${v.tripName}</span>
        <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 17px; letter-spacing: 0.12em;"><span style="color: ${v.tripAColor};">A</span><span style="color: #333333;"> · </span><span style="color: ${v.tripBColor};">B</span></span>
      </div>
      <div class="gx-28" style="display: flex; justify-content: center; align-items: baseline;">
        <div><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 40px;">${v.tripKm}</span> <span style="font-size: 17px; color: #A6A6A6; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; letter-spacing: 0.04em;">KM</span></div>
        <div><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 40px;">${v.tripKwh}</span> <span style="font-size: 17px; color: #A6A6A6; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; letter-spacing: 0.04em;">KWH/100</span></div>
      </div>
      <div style="position: absolute; left: 0; bottom: 0; height: 4px; width: ${v.tripHoldPct}%; background: ${v.accent}; transition: ${v.tripHoldAnim};"></div>
    </div>

    
    <section aria-label="Range" class="gy-10" style="padding: 4px 24px 18px; display: flex; flex-direction: column; align-items: center;  min-height: 0; min-width: 0; overflow: hidden;">
      <div style="align-self: stretch; height: 36px; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 22px; letter-spacing: 0.12em; color: ${v.accent};">RANGE</span>
      </div>
      <div style="position: relative; width: 380px; height: 380px; flex-shrink: 0; margin: 6px 0 -54px;">
        <svg width="380" height="380" viewBox="0 0 320 320" aria-hidden="true">
          <circle cx="160" cy="160" r="136" fill="none" stroke="#262626" stroke-width="18" stroke-dasharray="641 1000" transform="rotate(135 160 160)"></circle>
          <circle cx="160" cy="160" r="136" fill="none" class="s6-acc" stroke=${v.accent} stroke-width="18" stroke-dasharray=${v.rangeDash} transform="rotate(135 160 160)"></circle>
          <circle cx="160" cy="160" r="110" fill="none" stroke="#262626" stroke-width="8" stroke-dasharray="518 1000" transform="rotate(135 160 160)"></circle>
          <circle cx="160" cy="160" r="110" fill="none" stroke="#F2F2F2" stroke-width="8" stroke-dasharray=${v.battDash} transform="rotate(135 160 160)"></circle>
        </svg>
        <div style="position: absolute; top: 0; right: 0; bottom: 0; left: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 104px; line-height: 1;">${v.totalRange}</span>
          <span style="font-size: 24px; color: #A6A6A6; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; letter-spacing: 0.04em;">KM</span>
        </div>
      </div>
      <div style="align-self: stretch; height: 84px; flex-shrink: 0; margin-top: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;">
        <div style="border-left: 4px solid ${v.accent}; padding-left: 12px;"><div style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 36px; line-height: 1.1; white-space: nowrap;">${v.evRange} KM</div><div style="font-size: 20px; color: #A6A6A6; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; letter-spacing: 0.04em;">BATTERY ${v.battPct}%</div></div>
        <div style="border-left: 4px solid #F2F2F2; padding-left: 12px;"><div style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 36px; line-height: 1.1; white-space: nowrap;">${v.fuelRange} KM</div><div style="font-size: 20px; color: #A6A6A6; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; letter-spacing: 0.04em;">FUEL ${v.fuelPct}%</div></div>
      </div>
    </section>

    
    <section aria-label="Speed" class="gy-10" style="padding: 4px 24px 18px; display: flex; flex-direction: column; align-items: center;  min-height: 0; min-width: 0; overflow: hidden;">
      <div style="align-self: stretch; position: relative; height: 36px; display: flex; align-items: center;">
        <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 22px; letter-spacing: 0.12em; color: ${v.accent};">SPEED</span>
        <div class="gx-22" style="position: absolute; top: 0; left: 0; right: 0; height: 36px; display: flex; justify-content: center; align-items: center;  font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 34px; line-height: 1; pointer-events: none;">
          <span style="color: ${v.gearP};">P</span><span style="color: ${v.gearR};">R</span><span style="color: ${v.gearN};">N</span><span style="color: ${v.gearD};">D</span>
        </div>
      </div>
      <div style="position: relative; width: 400px; height: 375px; flex-shrink: 0; margin: 10px 0 -53px;">
        <svg width="400" height="375" viewBox="0 0 320 300" aria-hidden="true" style="position: absolute; top: 0; right: 0; bottom: 0; left: 0;">
          <circle cx="160" cy="165" r="140" fill="none" stroke="#1C1C1C" stroke-width="10" stroke-dasharray="586 2000" transform="rotate(150 160 165)"></circle>
          <circle cx="160" cy="165" r="140" fill="none" class="s6-acc" stroke=${v.accent} stroke-width="10" stroke-dasharray=${v.speedDash} transform="rotate(150 160 165)"></circle>
          <circle cx="160" cy="165" r="125" fill="none" stroke="#2A2A2A" stroke-width="6" stroke-dasharray="1.4 11.69" transform="rotate(150 160 165)"></circle>
          <circle cx="160" cy="165" r="125" fill="none" stroke="#050505" stroke-width="8" stroke-dasharray="0 523.6 261.8 2000" transform="rotate(150 160 165)"></circle>
        </svg>
        <div style="position: absolute; top: 0; right: 0; bottom: 0; left: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 104px; line-height: 1;">${v.speed}</span>
          <span style="font-size: 24px; color: #A6A6A6; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; letter-spacing: 0.04em;">KM/H</span>
        </div>
      </div>
      <div class="gy-16" style="align-self: stretch; height: 84px; flex-shrink: 0; margin-top: auto; display: flex; flex-direction: column; justify-content: center;">
        <div style="position: relative; height: 12px; background: #1C1C1C;">
          <div style="position: absolute; top: 0; bottom: 0; left: ${v.powerLeft}%; width: ${v.powerWidth}%; background: ${v.powerColor};"></div>
          <div style="position: absolute; top: -4px; bottom: -4px; left: 50%; width: 2px; background: #4A4A4A;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 20px; letter-spacing: 0.04em; color: #A6A6A6;"><span>REGEN</span><span style="color: #F2F2F2; font-size: 36px; line-height: 1;">${v.powerLabel}</span><span>POWER</span></div>
      </div>
    </section>

    
    ${v.offroad ? html`
      <div aria-label="Off-road view" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 5; background: #050505; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: 104px minmax(0, 1fr); column-gap: 18px; row-gap: 14px;">
        <div aria-label="Terrain. Hold to zero the tilt on flat ground" onPointerDown=${v.tiltHoldStart} onPointerUp=${v.tiltHoldEnd} onPointerLeave=${v.tiltHoldEnd} onPointerCancel=${v.tiltHoldEnd} style="background: #111111; border: 1px solid #262626; border-radius: 8px; box-sizing: border-box; padding: 12px 16px; display: flex; flex-direction: column; justify-content: space-between; position: relative; overflow: hidden;">
          <div style="display: flex; justify-content: space-between;"><span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 17px; letter-spacing: 0.12em; color: ${v.accent};">TERRAIN</span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 15px; letter-spacing: 0.12em; color: #A6A6A6;">${v.tiltNote}</span></div>
          <div class="gx-14" style="display: flex; align-items: baseline;"><span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 48px; line-height: 1; color: ${v.accent};">${v.terrainName}</span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 18px; color: #A6A6A6; letter-spacing: 0.08em;">${v.terrainSub}</span></div>
          <div style="position: absolute; left: 0; bottom: 0; height: 4px; width: ${v.tiltHoldPct}%; background: ${v.accent}; transition: ${v.tiltHoldAnim};"></div>
        </div>
        <div style="background: #111111; border: 1px solid #262626; border-radius: 8px; box-sizing: border-box; padding: 12px 16px; display: flex; flex-direction: column; justify-content: space-between;">
          <div style="display: flex; justify-content: space-between;"><span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 17px; letter-spacing: 0.12em; color: ${v.accent};">TYRES</span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 15px; letter-spacing: 0.12em; color: #A6A6A6; text-transform: uppercase;">${v.tyreNote}</span></div>
          <div style="display: flex; justify-content: space-around; align-items: flex-end;"><div class="gy-4" style="display: flex; flex-direction: column; align-items: center;"><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.14em; color: #6B6B6B;">FL</span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 34px; color: ${v.tyreFLc};">${v.tyreFL}</span></div><div class="gy-4" style="display: flex; flex-direction: column; align-items: center;"><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.14em; color: #6B6B6B;">FR</span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 34px; color: ${v.tyreFRc};">${v.tyreFR}</span></div><div style="width: 1px; align-self: stretch; background: #262626;"></div><div class="gy-4" style="display: flex; flex-direction: column; align-items: center;"><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.14em; color: #6B6B6B;">RL</span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 34px; color: ${v.tyreRLc};">${v.tyreRL}</span></div><div class="gy-4" style="display: flex; flex-direction: column; align-items: center;"><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.14em; color: #6B6B6B;">RR</span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 34px; color: ${v.tyreRRc};">${v.tyreRR}</span></div></div>
        </div>
        <div style="grid-column: 1 / span 2; display: flex; padding: 46px 20px 0;">
        <div class="gy-6" style="flex: 1; display: flex; flex-direction: column; align-items: center;">
          <svg width="300" height="300" viewBox="0 0 300 300" aria-hidden="true">
            <circle cx="150" cy="150" r="132" fill="none" stroke="#1C1C1C" stroke-width="2"></circle><path d="M150 18 L150 30" stroke="#3A3A3A" stroke-width="3" transform="rotate(-60 150 150)"></path><path d="M150 18 L150 30" stroke="#3A3A3A" stroke-width="3" transform="rotate(-45 150 150)"></path><path d="M150 18 L150 30" stroke="#3A3A3A" stroke-width="3" transform="rotate(-30 150 150)"></path><path d="M150 18 L150 30" stroke="#3A3A3A" stroke-width="3" transform="rotate(-15 150 150)"></path><path d="M150 18 L150 30" stroke="#3A3A3A" stroke-width="3" transform="rotate(0 150 150)"></path><path d="M150 18 L150 30" stroke="#3A3A3A" stroke-width="3" transform="rotate(15 150 150)"></path><path d="M150 18 L150 30" stroke="#3A3A3A" stroke-width="3" transform="rotate(30 150 150)"></path><path d="M150 18 L150 30" stroke="#3A3A3A" stroke-width="3" transform="rotate(45 150 150)"></path><path d="M150 18 L150 30" stroke="#3A3A3A" stroke-width="3" transform="rotate(60 150 150)"></path>
            <path d="M30 150 L270 150" stroke="#262626" stroke-width="2" stroke-dasharray="6 8"></path>
            <g transform=${v.pitchRot}><path d="M150 18 L150 36" stroke=${v.accent} stroke-width="5"></path><path d="M30 150 L270 150" stroke=${v.accent} stroke-width="2" opacity="0.6"></path><path d="M72 148 L72 122 L118 120 L136 98 L178 98 L186 120 L230 122 L230 148 Z" fill="#2A2A2A" stroke="#BDBDBD" stroke-width="3" stroke-linejoin="round"></path><circle cx="100" cy="150" r="16" fill="#111" stroke="#BDBDBD" stroke-width="3"></circle><circle cx="204" cy="150" r="16" fill="#111" stroke="#BDBDBD" stroke-width="3"></circle></g>
          </svg>
          <div class="gx-10" style="display: flex; align-items: baseline;  margin-top: -18px;"><span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 20px; letter-spacing: 0.12em; color: #A6A6A6;">PITCH</span><span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 56px; line-height: 1;">${v.pitchText}</span></div>
        </div>
        <div class="gy-6" style="flex: 1; display: flex; flex-direction: column; align-items: center;">
          <svg width="300" height="300" viewBox="0 0 300 300" aria-hidden="true">
            <circle cx="150" cy="150" r="132" fill="none" stroke="#1C1C1C" stroke-width="2"></circle><path d="M150 18 L150 30" stroke="#3A3A3A" stroke-width="3" transform="rotate(-60 150 150)"></path><path d="M150 18 L150 30" stroke="#3A3A3A" stroke-width="3" transform="rotate(-45 150 150)"></path><path d="M150 18 L150 30" stroke="#3A3A3A" stroke-width="3" transform="rotate(-30 150 150)"></path><path d="M150 18 L150 30" stroke="#3A3A3A" stroke-width="3" transform="rotate(-15 150 150)"></path><path d="M150 18 L150 30" stroke="#3A3A3A" stroke-width="3" transform="rotate(0 150 150)"></path><path d="M150 18 L150 30" stroke="#3A3A3A" stroke-width="3" transform="rotate(15 150 150)"></path><path d="M150 18 L150 30" stroke="#3A3A3A" stroke-width="3" transform="rotate(30 150 150)"></path><path d="M150 18 L150 30" stroke="#3A3A3A" stroke-width="3" transform="rotate(45 150 150)"></path><path d="M150 18 L150 30" stroke="#3A3A3A" stroke-width="3" transform="rotate(60 150 150)"></path>
            <path d="M30 150 L270 150" stroke="#262626" stroke-width="2" stroke-dasharray="6 8"></path>
            <g transform=${v.rollRot}><path d="M150 18 L150 36" stroke=${v.accent} stroke-width="5"></path><path d="M30 150 L270 150" stroke=${v.accent} stroke-width="2" opacity="0.6"></path><path d="M100 150 L100 112 L114 86 L186 86 L200 112 L200 150 Z" fill="#2A2A2A" stroke="#BDBDBD" stroke-width="3" stroke-linejoin="round"></path><rect x="94" y="140" width="22" height="34" rx="5" fill="#111" stroke="#BDBDBD" stroke-width="3"></rect><rect x="184" y="140" width="22" height="34" rx="5" fill="#111" stroke="#BDBDBD" stroke-width="3"></rect><path d="M122 100 L178 100" stroke="#555" stroke-width="3"></path></g>
          </svg>
          <div class="gx-10" style="display: flex; align-items: baseline;  margin-top: -18px;"><span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 20px; letter-spacing: 0.12em; color: #A6A6A6;">ROLL</span><span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 56px; line-height: 1;">${v.rollText}</span></div>
        </div>
        </div>
      </div>
    ` : null}
    
    ${v.lowCam ? html`
      <div aria-label="Front camera, shown at low speed" class="gy-10" style="position: absolute; top: 118px; left: 0; right: 0; bottom: 0; z-index: 6; background: #111111; border: 1px solid #262626; border-radius: 8px; box-sizing: border-box; padding: 14px 16px 16px; display: flex; flex-direction: column;">
        <div style="display: flex; justify-content: space-between; align-items: baseline;">
          <span class="gx-18" style="display: flex; align-items: baseline;"><span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 17px; letter-spacing: 0.12em; color: ${v.accent};">FRONT CAMERA</span><span><span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 30px; line-height: 1;">${v.speed}</span> <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 15px; color: #A6A6A6;">KM/H</span></span></span>
          <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 15px; letter-spacing: 0.12em; color: #A6A6A6;">AUTO · UNDER 10 KM/H</span>
        </div>
        <div id="s6-cam3" style="flex: 1; min-height: 0; position: relative; background: #000; border-radius: 6px; overflow: hidden;">
          <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; font-size: 17px; color: #A6A6A6;">${v.camStatus}</div>
        </div>
      </div>
    ` : null}
  </section>

  
  <section aria-label="Cameras" style="display: grid; grid-template-rows: minmax(0, 1fr); min-height: 0; min-width: 0; overflow: hidden;">
    <div aria-label="Camera: ${v.camName}. Tap to switch camera" onClick=${v.camNext} class="gy-10" style="background: #111111; border: 1px solid ${v.camBorder}; box-shadow: ${v.camGlow}; border-radius: 8px; padding: 12px 14px 14px; display: flex; flex-direction: column;  min-height: 0; min-width: 0; overflow: hidden; cursor: pointer;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 17px; letter-spacing: 0.12em; color: ${v.accent};">CAMERA</span>
        <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 17px; letter-spacing: 0.12em; color: ${v.camNameColor};">${v.camName}</span>
      </div>
      <div id="s6-cam" style="flex: 1; min-height: 0; position: relative; background: #000; border-radius: 6px; overflow: hidden;">
        <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; padding: 0 16px; text-align: center; font-size: 17px; color: #A6A6A6;">${v.camStatus}</div>
      </div>
      <div class="gx-8" style="display: flex; justify-content: center;">
        <span style="width: 8px; height: 8px; border-radius: 4px; background: ${v.camDot0};"></span><span style="width: 8px; height: 8px; border-radius: 4px; background: ${v.camDot1};"></span><span style="width: 8px; height: 8px; border-radius: 4px; background: ${v.camDot2};"></span><span style="width: 8px; height: 8px; border-radius: 4px; background: ${v.camDot3};"></span>
      </div>
    </div>
  </section>

  
  <section aria-label="Climate and seats" class="gx-14" style="grid-column: 1 / -1; background: #111111; border: 1px solid #262626; border-radius: 8px; padding: 0 24px; display: flex; align-items: center;  min-height: 0; min-width: 0; overflow: hidden;">

    <div style="display: flex; flex-shrink: 0;">
      <div class="gx-8" style="display: flex;">
        <button type="button" onClick=${v.pasHeat.cycle} aria-label="Passenger seat heating, ${v.pasHeat.label}" class="gy-6" style="width: 108px; height: 108px; flex-shrink: 0; padding: 0; border: 0; background: ${v.pasHeat.bg}; color: #F2F2F2; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <svg width="38" height="38" viewBox="0 -960 960 960" fill=${v.pasHeat.icon} aria-hidden="true"><path d="M297-120q-25 0-44-14.5T228-172l-99-386q-5-14-6.5-29t-1.5-30q0-28 6.5-54.5T146-723q8-16 22.5-25.5T200-758q20 0 33.5 14t13.5 34q0 9-2.5 17T234-678q-22 23-26 53.5t9 59.5l17 43q28 65 49 132.5T304-250v54q8-11 24.5-18.5T365-222h260q21 0 36 15t15 36q0 21-15 36t-36 15H297Z"></path><path class="${v.pasHeat.anim} s6-w0" d="M765 -490q-11-7-14-19t5-22l8-11q8-11 12-24t4-27q0-18-6.5-34.5T754-658q-21-23-32.5-50.5T710-767q0-22 6.5-43t19.5-39l8-12q7-11 19-12.5t23 5.5q11 7 13 19t-6 22l-8 11q-8 11-12 23.5t-4 26.5q0 19 7 35.5t20 30.5q21 23 32.5 50.5T840-591q0 22-6.5 43T814-509l-8 11q-8 10-19 12.5t-22-4.5Z"></path><path class="${v.pasHeat.anim} s6-w1" d="M592 -490q-11-7-14-19t5-22l8-11q8-11 12-23.5t4-26.5q0-19-7-35.5T580-658q-21-23-32.5-50.5T536-767q0-22 6.5-43t19.5-39l8-12q7-11 18.5-13t22.5 5q10 7 12.5 19t-4.5 23l-7 11q-8 11-12 23.5t-4 26.5q0 19 7 35.5t20 30.5q21 23 32.5 50.5T667-591q0 22-6.5 43T641-509l-8 11q-8 10-19 12.5t-22-4.5Z"></path><path class="${v.pasHeat.anim} s6-w2" d="M419 -490q-11-7-14-19t5-22l8-11q8-11 12-23.5t4-26.5q0-19-7-35.5T407-658q-21-23-33-50.5T362-767q0-22 6.5-43t20.5-39l9-12q8-10 20-12t22 5q11 7 13 19t-6 22l-8 11q-8 11-12 23.5t-4 26.5q0 19 7 35.5t20 30.5q21 23 32.5 50.5T494-591q0 22-6.5 43T468-509l-8 11q-8 10-19 12.5t-22-4.5Z"></path></svg>
          <div class="gx-4" style="display: flex;">${v.pasHeat.segs.map((s) => html`<div style="width: 14px; height: 5px; transform: skewX(-24deg); background: ${s.c};"></div>`)}</div>
        <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 19px; line-height: 1; letter-spacing: 0.08em; color: ${v.pasHeat.icon};">HEAT</span></button>
        <button type="button" onClick=${v.pasVent.cycle} aria-label="Passenger seat ventilation, ${v.pasVent.label}" class="gy-6" style="width: 108px; height: 108px; flex-shrink: 0; padding: 0; border: 0; background: ${v.pasVent.bg}; color: #F2F2F2; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <svg width="38" height="38" viewBox="0 -960 960 960" fill=${v.pasVent.icon} aria-hidden="true"><path d="M297-120q-24.65 0-43.83-14.5Q234-149 228-172l-99-386q-5-14-6.5-28.84T121-617q0-27.66 6.5-54.33Q134-698 146-723q7.84-16.15 22.2-25.58 14.36-9.42 31.78-9.42 20.02 0 33.52 14.25Q247-729.5 247-710.22q0 9.22-2.5 17.22-2.5 8-10.5 15-21.92 23.01-25.96 53.51Q204-594 217-565l17 43q28 65 49 132.5T304-250v54q8-11 24.5-18.5T365-222h239q30.22 0 51.11 21.15T676-150v30H297Z"></path><g class=${v.pasVent.anim}><path d="M629.12-478q-22.8 0-34.96-14.25T582-523q0-13 5.31-23.62 5.3-10.61 16.67-18.19 8.34-5.31 14.79-14.03 6.44-8.72 10.23-26.16-2.86-1.56-5.36-3.11-2.5-1.56-4.64-3.89-29 11-42 16t-27.21 5q-28.42 0-50.1-25Q478-641 478-688.88q0-22.8 14.25-34.96T523-736q13 0 23.62 5.31 10.61 5.3 18.19 16.67 5.31 8.34 14.03 14.79 8.72 6.44 26.16 10.23 1.56-2.86 3.11-5.36 1.56-2.5 3.89-4.64-11-29-16-42t-5-27.21q0-28.42 25-50.1Q641-840 688.88-840q22.8 0 34.96 14.25T736-795q0 13-5.31 23.62-5.3 10.61-16.67 18.19-8.34 5.31-14.79 14.03-6.44 8.72-10.23 26.16 2.86 1.56 5.36 3.11 2.5 1.56 4.64 3.89 29-11 42-16t27.21-5q28.42 0 50.1 25Q840-677 840-629.12q0 22.8-14.25 34.96T795-582q-13 0-23.62-5.31-10.61-5.3-18.19-16.67-5.31-8.34-14.03-14.79-8.72-6.44-26.16-10.23-1.56 2.86-3.11 5.36-1.56 2.5-3.89 4.64 11 29 16 42t5 27.21q0 28.42-25 50.1Q677-478 629.12-478Zm51.38-159.68q8.5-8.67 8.5-21.5 0-12.82-8.68-21.32-8.67-8.5-21.5-8.5-12.82 0-21.32 8.68-8.5 8.67-8.5 21.5 0 12.82 8.68 21.32 8.67 8.5 21.5 8.5 12.82 0 21.32-8.68Z"></path></g></svg>
          <div class="gx-4" style="display: flex;">${v.pasVent.segs.map((s) => html`<div style="width: 14px; height: 5px; transform: skewX(-24deg); background: ${s.c};"></div>`)}</div>
        <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 19px; line-height: 1; letter-spacing: 0.08em; color: ${v.pasVent.icon};">VENT</span></button>
      </div>
    </div>

    <div style="flex: 1 1 0; min-width: 0; display: flex;">
      <div style="flex: 1 1 0; height: 108px; display: flex; align-items: center; justify-content: space-between; border: 0; background: #161616; border-radius: 6px; padding: 0 6px; min-width: 0; overflow: hidden;">
        <button type="button" onClick=${v.pasDown} aria-label="Passenger temperature down" style="width: 44px; height: 84px; border: 0; background: #1E1E1E; color: #F2F2F2; border-radius: 4px; font-size: 26px; flex-shrink: 0;">–</button>
        <button type="button" onClick=${v.openPas} aria-label="Passenger temperature ${v.pasTemp} degrees, tap for slider" style="border: 0; background: transparent; color: #F2F2F2; flex: 0 0 100px; width: 100px; padding: 0; text-align: center; white-space: nowrap; overflow: hidden; font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 48px; line-height: 1.1;">${v.pasTemp}°</button>
        <button type="button" onClick=${v.pasUp} aria-label="Passenger temperature up" style="width: 44px; height: 84px; border: 0; background: #1E1E1E; color: #F2F2F2; border-radius: 4px; font-size: 26px; flex-shrink: 0;">+</button>
      </div>
    </div>

    <div style="display: flex; flex-shrink: 0;">
      <div class="gx-8" style="display: flex;">
        <button type="button" onClick=${v.toggleRecirc} aria-pressed=${v.recirc} aria-label="Air intake: ${v.recircLabel}. Tap to switch" class="gy-7" style="width: 108px; height: 108px; flex-shrink: 0; padding: 0; border: ${v.recircBorder}; background: ${v.recircBg}; color: #F2F2F2; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <svg width="38" height="38" viewBox="0 -960 960 960" fill=${v.recircIcon} aria-hidden="true"><path d=${v.recircPath}></path></svg>
        <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 19px; line-height: 1; letter-spacing: 0.08em; color: ${v.recircIcon};">${v.recircLabel}</span></button>
        <button type="button" onClick=${v.toggleAc} aria-pressed=${v.ac} aria-label="A/C" class="gy-7" style="width: 108px; height: 108px; flex-shrink: 0; padding: 0; border: ${v.acBorder}; background: ${v.acBg}; color: #F2F2F2; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <svg width="38" height="38" viewBox="0 -960 960 960" fill=${v.acIcon} aria-hidden="true"><path d="M450-275 321-146q-8 8-20.5 8t-21.5-8q-9-9-9-21.5t9-21.5l171-171v-90h-90L192-282q-8 8-20.5 8.5T150-281q-9-9-9.5-21.5T150-325l125-125H109q-12 0-20.5-8.5T80-480q0-12 8.5-21t21.5-9h165L146-638q-9-9-9-21.5t9-21.5q9-9 21.5-9t21.5 9l171 171h90v-91L282-768q-8-8-8-20.5t8-21.5q9-9 21.5-9t22.5 9l124 124v-164q0-12 8.5-21t21.5-9q12 0 21 9t9 21v164l128-128q9-9 21.5-9t21.5 9q8 9 8 21.5t-9 21.5L510-601v91h91l168-168q8-8 20.5-8t21.5 8q9 9 9 21.5t-9 21.5L686-510h164q12 0 21 9t9 21q0 13-9 21.5t-21 8.5H686l127 129q9 8 9 20.5t-9 20.5q-8 10-20.5 10t-21.5-9L601-450h-91v90l171 173q9 8 9 20.5t-9 20.5q-8 10-20.5 10t-21.5-9L510-275v166q0 12-9 20.5T480-80q-13 0-21.5-8.5T450-110v-165Z"></path></svg>
        <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 19px; line-height: 1; letter-spacing: 0.08em; color: ${v.acIcon};">A/C</span></button>
        <button type="button" onClick=${v.toggleAuto} aria-pressed=${v.auto} aria-label="Auto" class="gy-7" style="width: 108px; height: 108px; flex-shrink: 0; padding: 0; border: ${v.autoBorder}; background: ${v.autoBg}; color: #F2F2F2; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <svg width="38" height="38" viewBox="0 -960 960 960" fill=${v.autoIcon} aria-hidden="true"><path d="m626-546-37 95q-3 8-9.5 12.5T565-434q-14 0-21.5-11.5T541-470l130-333q3-7 9-11.5t14-4.5h19q8 0 14 4.5t9 11.5l130 334q5 13-2.5 24T842-434q-8 0-14.5-4.5T818-451l-37-95H626Zm16-47h123l-54-148h-15l-54 148ZM167-174q-53-53-53-129 0-48 24-90.5t66-68.5v-286q0-38 27-65t65-27q38 0 65 27t27 65v286q42 26 66 68.5t24 90.5q0 76-53 129t-129 53q-76 0-129-53Zm7-129h244q0-40-19-71.5T348-420l-20-9v-319q0-14-9-23t-23-9q-14 0-23 9t-9 23v319l-20 9q-32 14-51 46t-19 71Z"></path></svg>
        <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 19px; line-height: 1; letter-spacing: 0.08em; color: ${v.autoIcon};">AUTO</span></button>
        <button type="button" onClick=${v.toggleSync} aria-pressed=${v.synced} aria-label="Sync driver and passenger temperatures" class="gy-7" style="width: 108px; height: 108px; flex-shrink: 0; padding: 0; border: ${v.syncBorder}; background: ${v.syncBg}; color: #F2F2F2; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <svg width="38" height="38" viewBox="0 -960 960 960" fill=${v.syncIcon} aria-hidden="true"><path d="M220-477q0 63 23.5 109.5T307-287l30 21v-94q0-13 8.5-21.5T367-390q13 0 21.5 8.5T397-360v170q0 13-8.5 21.5T367-160H197q-13 0-21.5-8.5T167-190q0-13 8.5-21.5T197-220h100l-15-12q-64-51-93-111t-29-134q0-94 49.5-171.5T342-766q11-5 21 0t14 16q5 11 0 22.5T361-710q-64 34-102.5 96.5T220-477Zm520-6q0-48-23.5-97.5T655-668l-29-26v94q0 13-8.5 21.5T596-570q-13 0-21.5-8.5T566-600v-170q0-13 8.5-21.5T596-800h170q13 0 21.5 8.5T796-770q0 13-8.5 21.5T766-740H665l15 14q60 56 90 120t30 123q0 93-48 169.5T623-195q-11 6-22.5 1.5T584-210q-5-11 0-22.5t16-17.5q65-33 102.5-96T740-483Z"
></path></svg>
        <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 19px; line-height: 1; letter-spacing: 0.08em; color: ${v.syncIcon};">SYNC</span></button>
        <button type="button" onClick=${v.openFan} aria-label="Fan speed ${v.fanLabel}, tap for slider" class="gy-6" style="width: 108px; height: 108px; flex-shrink: 0; padding: 0; border: 1px solid #2A2A2A; background: #161616; color: #F2F2F2; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <svg width="38" height="38" viewBox="0 -960 960 960" fill="#F2F2F2" aria-hidden="true"><path class=${v.fanAnim} d="M424-80q-51 0-77.5-30.5T320-180q0-26 11.5-50.5T367-271q22-14 36.5-37.5T425-373q-1 0-1-.5t-2-1.5l-116 41q-17 6-33 10t-33 4q-63 0-111.5-55T80-536q0-51 30.5-77.5T179-640q26 0 51 11.5t41 35.5q14 22 39.5 37.5T373-535q.67-1 1.33-2 .67-1 .67-2l-41-115q-6-17-10-33t-4-32q0-64 55-112.5T536-880q51 0 77.5 30.5T640-781q0 26-11.5 51T593-689q-26 17-40.5 45T536-586q1 1 1.5.5t1.5 1.5l115-43q17-6 32.5-9.5T719-640q81 0 121 67t40 149q0 51-32 77.5T777-320q-25 0-48.5-11.5T689-367q-14-22-37.5-36.5T587-426q-1 2-1.6 3.06-.6 1.06-1.4 1.94l42 115q6 16 10 30.5t4 30.5q1 65-54 115T424-80Zm56-340q25 0 42.5-17.5T540-480q0-25-17.5-42.5T480-540q-25 0-42.5 17.5T420-480q0 25 17.5 42.5T480-420Zm-58-165q12-5 26-9t28-6q8-45 29.5-81t54.5-58q10-7 15-17.5t5-24.5q0-16.42-10.5-27.71T536-820q-43 0-98.5 20.55-55.5 20.54-57.5 80.32 0 11.21 2.5 21.17T388-680l34 95ZM240-380q14 0 40-8l95-34q-8-14-11.5-28t-3.5-26q-45-8-81-29.5T221-560q-7-10-19-15t-23-5q-19 0-29 10.5T140-536q0 61.94 25.63 108.97Q191.25-380 240-380Zm184 240q53.13 0 104.57-23Q580-186 580-242q0-11-2-19t-6-19l-34-95q-13 6-26.5 10t-27.5 5q-8 45-29.5 81T400-221q-9 6-14.5 18.5T380-179q1 15 11 27t33 12Zm353-240q16.83 0 29.91-9.17Q820-398.33 820-424q0-44-20.5-99t-81.33-57q-11.17 0-20.67 2-9.5 2-17.5 5l-95 35q5 8 10 25.5t5 28.5q45 8 81 29.5t58 54.5q6 8 16.67 14 10.66 6 21.33 6ZM600-484ZM476-600ZM360-476Zm124 116Z"></path></svg>
          <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 19px; line-height: 1; letter-spacing: 0.08em; color: #A6A6A6;">FAN <span style="color: #F2F2F2;">${v.fanLabel}</span></span>
        </button>
      </div>
    </div>

    <div style="flex: 1 1 0; min-width: 0; display: flex;">
      <div style="flex: 1 1 0; height: 108px; display: flex; align-items: center; justify-content: space-between; border: 0; background: #161616; border-radius: 6px; padding: 0 6px; min-width: 0; overflow: hidden;">
        <button type="button" onClick=${v.drvDown} aria-label="Driver temperature down" style="width: 44px; height: 84px; border: 0; background: #1E1E1E; color: #F2F2F2; border-radius: 4px; font-size: 26px; flex-shrink: 0;">–</button>
        <button type="button" onClick=${v.openDrv} aria-label="Driver temperature ${v.drvTemp} degrees, tap for slider" style="border: 0; background: transparent; color: #F2F2F2; flex: 0 0 100px; width: 100px; padding: 0; text-align: center; white-space: nowrap; overflow: hidden; font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 48px; line-height: 1.1;">${v.drvTemp}°</button>
        <button type="button" onClick=${v.drvUp} aria-label="Driver temperature up" style="width: 44px; height: 84px; border: 0; background: #1E1E1E; color: #F2F2F2; border-radius: 4px; font-size: 26px; flex-shrink: 0;">+</button>
      </div>
    </div>

    <div style="display: flex; flex-shrink: 0;">
      <div class="gx-8" style="display: flex;">
        <button type="button" onClick=${v.drvHeat.cycle} aria-label="Driver seat heating, ${v.drvHeat.label}" class="gy-6" style="width: 108px; height: 108px; flex-shrink: 0; padding: 0; border: 0; background: ${v.drvHeat.bg}; color: #F2F2F2; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <svg width="38" height="38" viewBox="0 -960 960 960" fill=${v.drvHeat.icon} aria-hidden="true"><path d="M336 -120q-21 0-36-15t-15-36q0-21 15-36t36-15h260q20 0 36.5 7.5T657-196v-54q0-72 21-139.5T727-522l17-43q13-29 9-59.5T727-678q-8-7-10.5-15t-2.5-17q0-20 13.5-34t33.5-14q17 0 31.5 9.5T815-723q12 25 18.5 51.5T840-617q0 15-1.5 30t-6.5 29l-99 386q-6 23-25 37.5T664-120H336Z"></path><path class="${v.drvHeat.anim} s6-w0" d="M523 -490q-11-7-13.5-19t5.5-22l8-11q8-11 12-24t4-27q0-18-6.5-34.5T513-658q-21-23-33-50.5T468-767q0-22 7-43t20-39l8-12q7-11 18.5-12.5T544-868q11 7 13.5 19t-5.5 22l-8 11q-8 11-12 23.5t-4 26.5q0 19 7 35.5t20 30.5q21 23 32.5 50.5T599-591q0 22-6.5 43T573-509l-8 11q-8 10-19.5 12.5T523-490Z"></path><path class="${v.drvHeat.anim} s6-w1" d="M350 -490q-11-7-13.5-19t5.5-22l8-11q8-11 12-23.5t4-26.5q0-19-7-35.5T339-658q-21-23-33-50.5T294-767q0-22 7-43t20-39l8-12q7-11 18.5-13t22.5 5q10 7 12.5 19t-4.5 23l-7 11q-8 11-12 23.5t-4 26.5q0 19 7 35.5t20 30.5q21 23 32.5 50.5T426-591q0 22-6.5 43T400-509l-8 11q-8 10-19.5 12.5T350-490Z"></path><path class="${v.drvHeat.anim} s6-w2" d="M177 -490q-11-7-13.5-19t5.5-22l8-11q8-11 12-23.5t4-26.5q0-19-7-35.5T166-658q-21-23-33-50.5T121-767q0-22 6.5-43t20.5-39l9-12q8-10 19.5-12t21.5 5q11 7 13.5 19t-5.5 22l-8 11q-8 11-12 23.5t-4 26.5q0 19 7 35.5t20 30.5q21 23 32.5 50.5T253-591q0 22-6.5 43T227-509l-8 11q-8 10-19.5 12.5T177-490Z"></path></svg>
          <div class="gx-4" style="display: flex;">${v.drvHeat.segs.map((s) => html`<div style="width: 14px; height: 5px; transform: skewX(-24deg); background: ${s.c};"></div>`)}</div>
        <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 19px; line-height: 1; letter-spacing: 0.08em; color: ${v.drvHeat.icon};">HEAT</span></button>
        <button type="button" onClick=${v.drvVent.cycle} aria-label="Driver seat ventilation, ${v.drvVent.label}" class="gy-6" style="width: 108px; height: 108px; flex-shrink: 0; padding: 0; border: 0; background: ${v.drvVent.bg}; color: #F2F2F2; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <svg width="38" height="38" viewBox="0 -960 960 960" fill=${v.drvVent.icon} aria-hidden="true"><path d="M285-120v-30q0-29.7 20.89-50.85Q326.78-222 357-222h239q20 0 36.5 7.5T657-196v-54q0-72 21-139.5T727-522l17-43q13-29 8.96-59.49-4.04-30.5-25.96-53.51-8-7-10.5-15t-2.5-17.22q0-19.28 13.5-33.53T760.79-758q17.21 0 31.84 9.42Q807.26-739.15 815-723q12 25 18.5 51.67T840-617q0 15.32-1.5 30.16T832-558l-99 386q-6 23-25.17 37.5Q688.65-120 664-120H285Z"></path><g class=${v.drvVent.anim}><path d="M272.12-478q-22.8 0-34.96-14.25T225-523q0-12.84 5.5-23.42 5.5-10.58 16.66-18.33 8.19-5.42 14.51-14.34Q268-588 272-605q-3.08-1.56-5.38-3.11-2.31-1.56-4.62-3.89-29 11-42 16t-27.21 5q-28.42 0-50.1-25Q121-641 121-688.88q0-22.8 14.25-34.96T166-736q13.22 0 23.72 5.31 10.5 5.31 18.28 16.69 5.19 8.33 14.07 14.77 8.89 6.44 25.93 10.23 1.56-2.86 3.11-5.36 1.56-2.5 3.89-4.64-11-29-16-42t-5-27.21q0-28.42 25.11-50.1Q284.23-840 332.17-840 355-840 367-825.75T379-795q0 13-5.31 23.62-5.3 10.61-16.67 18.19-8.34 5.31-14.79 14.03-6.44 8.72-10.23 26.16 3.08 1.56 5.38 3.11 2.31 1.56 4.62 3.89 29-11 42-16t27.21-5q28.42 0 50.1 25Q483-677 483-629.12q0 22.8-14.25 34.96T438-582q-13 0-23.62-5.31-10.61-5.3-18.19-16.67-5.31-8.34-14.03-14.79-8.72-6.44-26.16-10.23-2 3-3.56 5.45T349-619q11 29 16 42t5 27.21q0 28.42-25 50.1Q320-478 272.12-478Zm51.38-159.68q8.5-8.67 8.5-21.5 0-12.82-8.68-21.32-8.67-8.5-21.5-8.5-12.82 0-21.32 8.68-8.5 8.67-8.5 21.5 0 12.82 8.68 21.32 8.67 8.5 21.5 8.5 12.82 0 21.32-8.68Z"></path></g></svg>
          <div class="gx-4" style="display: flex;">${v.drvVent.segs.map((s) => html`<div style="width: 14px; height: 5px; transform: skewX(-24deg); background: ${s.c};"></div>`)}</div>
        <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 19px; line-height: 1; letter-spacing: 0.08em; color: ${v.drvVent.icon};">VENT</span></button>
      </div>
    </div>

  </section>
  
  
  ${v.tripCard ? html`
    <div role="dialog" aria-label="Trip complete" onClick=${v.tripDone} style="position: absolute; top: 0; left: 0; width: 1600px; height: 900px; z-index: 70; background: rgba(0,0,0,0.72); display: flex; align-items: center; justify-content: center;">
      <div class="gy-26" style="width: 760px; background: #111111; border: 1px solid #262626; border-radius: 8px; box-sizing: border-box; border-radius: 14px; padding: 28px 34px 30px; display: flex; flex-direction: column;  box-shadow: 0 30px 80px rgba(0,0,0,0.6);">
        <div style="display: flex; justify-content: space-between; align-items: baseline;"><span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 26px; letter-spacing: 0.12em; color: ${v.accent};">TRIP COMPLETE</span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 18px; letter-spacing: 0.08em; color: #A6A6A6;">${v.tcWhen}</span></div>
        <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); row-gap: 26px;"><div class="gy-6" style="display: flex; flex-direction: column;"><span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 52px;">${v.tcKm}</span> <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 17px; letter-spacing: 0.1em; color: #A6A6A6;">KM</span></span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 15px; letter-spacing: 0.14em; color: #6B6B6B;">DISTANCE</span></div><div class="gy-6" style="display: flex; flex-direction: column;"><span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 52px;">${v.tcMin}</span> <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 17px; letter-spacing: 0.1em; color: #A6A6A6;">MIN</span></span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 15px; letter-spacing: 0.14em; color: #6B6B6B;">DRIVE TIME</span></div><div class="gy-6" style="display: flex; flex-direction: column;"><span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 52px;">${v.tcAvg}</span> <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 17px; letter-spacing: 0.1em; color: #A6A6A6;">KM/H</span></span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 15px; letter-spacing: 0.14em; color: #6B6B6B;">AVERAGE</span></div><div class="gy-6" style="display: flex; flex-direction: column;"><span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 52px;">${v.tcKwh}</span> <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 17px; letter-spacing: 0.1em; color: #A6A6A6;">KWH</span></span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 15px; letter-spacing: 0.14em; color: #6B6B6B;">ELECTRICITY</span></div><div class="gy-6" style="display: flex; flex-direction: column;"><span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 52px;">${v.tcFuel}</span> <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 17px; letter-spacing: 0.1em; color: #A6A6A6;">L</span></span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 15px; letter-spacing: 0.14em; color: #6B6B6B;">FUEL</span></div><div class="gy-6" style="display: flex; flex-direction: column;"><span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 52px;">${v.tcCost}</span> <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 17px; letter-spacing: 0.1em; color: #A6A6A6;"></span></span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 15px; letter-spacing: 0.14em; color: #6B6B6B;">APPROX. COST</span></div></div>
        <div class="gy-10" style="display: flex; flex-direction: column;">
          <div style="display: flex; justify-content: space-between;"><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 16px; letter-spacing: 0.14em; color: #4ADE80;">ELECTRIC ${v.tcEv}%</span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 16px; letter-spacing: 0.14em; color: #A6A6A6;">ENGINE ${v.tcEng}%</span></div>
          <div style="height: 10px; border-radius: 5px; background: #2A2A2A; overflow: hidden;"><div style="width: ${v.tcEv}%; height: 10px; background: #4ADE80;"></div></div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;"><span style="font-size: 15px; color: #6B6B6B;">Cost uses $0.30/kWh and $2.00/L.</span><button type="button" onClick=${v.tripDone} style="height: 52px; padding: 0 34px; border: 0; border-radius: 8px; background: ${v.accent}; color: #F2F2F2; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 20px; letter-spacing: 0.12em;">DONE</button></div>
      </div>
    </div>
  ` : null}
  
  ${v.welcome ? html`
    <div role="dialog" aria-label="Welcome" onClick=${v.skipWelcome} class="s6-welcome" class="gy-30" style="position: absolute; top: 0; left: 0; width: 1600px; height: 900px; z-index: 80; background: radial-gradient(ellipse at 50% 42%, #1a0709 0%, #050505 60%); display: flex; flex-direction: column; align-items: center; justify-content: center;">
      <svg width="120" height="80" viewBox="0 0 120 80" aria-hidden="true"><path d="M10 74 C40 70 62 52 74 6 C80 34 96 60 112 74 Z" fill=${v.accent}></path></svg>
      <div style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 84px; line-height: 1; letter-spacing: 0.02em;">${v.welcomeGreet}</div>
      <div style="display: flex; align-items: center;"><div class="gy-6" style="display: flex; flex-direction: column; align-items: center;  padding: 0 34px;"><span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 46px;">${v.wRange}</span> <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 17px; letter-spacing: 0.1em; color: #A6A6A6;">KM</span></span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 15px; letter-spacing: 0.16em; color: #6B6B6B;">RANGE</span></div><div style="width: 1px; height: 64px; background: #262626;"></div><div class="gy-6" style="display: flex; flex-direction: column; align-items: center;  padding: 0 34px;"><span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 46px;">${v.wBatt}</span> <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 17px; letter-spacing: 0.1em; color: #A6A6A6;">%</span></span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 15px; letter-spacing: 0.16em; color: #6B6B6B;">BATTERY</span></div><div style="width: 1px; height: 64px; background: #262626;"></div><div class="gy-6" style="display: flex; flex-direction: column; align-items: center;  padding: 0 34px;"><span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 46px;">${v.wFuel}</span> <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 17px; letter-spacing: 0.1em; color: #A6A6A6;">%</span></span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 15px; letter-spacing: 0.16em; color: #6B6B6B;">FUEL</span></div><div style="width: 1px; height: 64px; background: #262626;"></div><div class="gy-6" style="display: flex; flex-direction: column; align-items: center;  padding: 0 34px;"><span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 46px;">${v.wOut}</span> <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 17px; letter-spacing: 0.1em; color: #A6A6A6;">°</span></span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 15px; letter-spacing: 0.16em; color: #6B6B6B;">OUTSIDE</span></div><div style="width: 1px; height: 64px; background: #262626;"></div><div class="gy-6" style="display: flex; flex-direction: column; align-items: center;  padding: 0 34px;"><span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; line-height: 1; font-size: 46px;">${v.wTyres}</span> <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 17px; letter-spacing: 0.1em; color: #A6A6A6;"></span></span><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 15px; letter-spacing: 0.16em; color: #6B6B6B;">TYRES</span></div></div>
      <div style="font-size: 18px; color: #A6A6A6;">${v.wNote}</div>
      <div style="width: 360px; height: 4px; border-radius: 2px; background: #1C1C1C; overflow: hidden; margin-top: 16px;"><div class="s6-wbar" style="width: 100%; height: 4px; background: ${v.accent};"></div></div>
    </div>
  ` : null}
  
  ${v.diagOpen ? html`
    <div role="dialog" aria-label="Diagnostics" onClick=${v.diagClose} style="position: absolute; top: 0; left: 0; width: 1600px; height: 900px; z-index: 90; background: rgba(0,0,0,0.88); display: flex; align-items: center; justify-content: center;">
      <div onClick=${v.diagStop} style="width: 1500px; max-height: 840px; box-sizing: border-box; overflow-y: auto; touch-action: pan-y; -webkit-overflow-scrolling: touch; background: #111111; border: 1px solid #333; border-radius: 12px; padding: 20px 28px; font-family: monospace; font-size: 17px; line-height: 1.45; color: #F2F2F2; white-space: pre-wrap; word-break: break-word;"><div style="font-family: 'Barlow Condensed', sans-serif; font-size: 30px; font-weight: 600; color: ${v.accent}; white-space: normal; margin-bottom: 4px;">SEND AN APP TO THE CAR</div><div style="font-family: 'Barlow Condensed', sans-serif; font-size: 26px; white-space: normal; margin-bottom: 18px;">On your phone (same Wi-Fi or hotspot), open <b>${v.sideAddr}</b> · PIN <b>${v.sidePin}</b></div>${v.diagText}<div style="font-family: 'Barlow Condensed', sans-serif; font-size: 22px; color: #A6A6A6; margin-top: 16px; white-space: normal;">Tap outside this box to close</div></div>
    </div>
  ` : null}
  
  ${v.updateOpen ? html`
    <div role="dialog" aria-label="Update available" class="s6-sheet" class="gx-24" style="position: absolute; left: 28px; right: 28px; bottom: 28px; height: 140px; z-index: 12; box-sizing: border-box; background: #111111; border: 1px solid #333333; border-radius: 8px; padding: 0 20px 0 28px; display: flex; align-items: center;  overflow: hidden;">
      <div style="position: absolute; top: -10px; bottom: -10px; left: -5px; width: 10px; background: ${v.accent}; transform: skewX(-12deg);"></div>
      <div class="gy-12" style="flex: 1 1 0; min-width: 0; display: flex; flex-direction: column;">
        <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 20px; letter-spacing: 0.12em; color: ${v.accent};">UPDATE · ${v.updateName}</span>
        <span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 30px; line-height: 1; color: #F2F2F2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${v.updateNote}</span>
        <div style="height: 6px; border-radius: 3px; background: #262626; opacity: ${v.updateBarOpacity};"><div style="width: ${v.updatePct}%; height: 6px; border-radius: 3px; background: ${v.accent};"></div></div>
      </div>
      ${v.updateIdle ? html`
        <button type="button" onClick=${v.updateLater} style="width: 160px; height: 72px; flex-shrink: 0; border: 0; border-radius: 6px; background: #1E1E1E; color: #A6A6A6; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 22px; letter-spacing: 0.08em;">LATER</button>
        <button type="button" onClick=${v.updateInstall} style="width: 200px; height: 72px; flex-shrink: 0; border: 0; border-radius: 6px; background: ${v.accent}; color: #F2F2F2; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 22px; letter-spacing: 0.08em; transform: skewX(-8deg); margin-left: 14px;">INSTALL</button>
      ` : null}
    </div>
  ` : null}
  
  ${v.sliderOpen ? html`
    <div onClick=${v.closeSlider} aria-hidden="true" style="position: absolute; top: 0; left: 0; width: 100%; height: 900px; z-index: 10; background: rgba(0,0,0,0.35);"></div>
    <div role="dialog" aria-label=${v.sliderTitle} class="s6-sheet" class="gx-20" style="position: absolute; left: 28px; right: 28px; bottom: 28px; height: 140px; z-index: 11; box-sizing: border-box; background: #111111; border: 1px solid #333333; border-radius: 8px; padding: 0 16px 0 28px; display: flex; align-items: center;">
      <div class="gy-4" style="width: 170px; flex-shrink: 0; display: flex; flex-direction: column;">
        <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 20px; letter-spacing: 0.12em; color: ${v.accent};">${v.sliderTitle}</span>
        <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 64px; line-height: 0.95; color: ${v.sliderTextColor};">${v.sliderText}</span>
      </div>
      <button type="button" onClick=${v.sliderStepDown} aria-label="Down" style="width: 72px; height: 72px; flex-shrink: 0; border: 0; border-radius: 50%; background: #1E1E1E; color: #F2F2F2; font-size: 34px; line-height: 1;">–</button>
      <div style="flex: 1 1 0; min-width: 0; position: relative; height: 96px;">
        ${v.sliderIsTemp ? html`
          <div style="position: absolute; top: 28px; left: 28px; right: 28px; height: 8px; border-radius: 4px; background: linear-gradient(90deg, #2FB3FF 0%, rgba(47,179,255,0.18) 31.25%, rgba(212,42,58,0.18) 31.25%, #D42A3A 100%);"></div>
          <div style="position: absolute; top: 18px; left: 28px; right: 28px; height: 28px;"><div style="position: absolute; top: 0; left: 31.25%; width: 2px; height: 28px; margin-left: -1px; background: #F2F2F2; opacity: 0.7;"></div></div>
          <div style="position: absolute; top: 62px; left: 28px; right: 28px; height: 24px; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 20px; letter-spacing: 0.06em; color: #6B6B6B;">
            <span style="position: absolute; left: 0; color: #2FB3FF;">17°</span>
            <span style="position: absolute; left: 31.25%; width: 60px; margin-left: -30px; text-align: center;">22°</span>
            <span style="position: absolute; right: 0; color: #D42A3A;">33°</span>
          </div>
        ` : null}
        ${v.sliderIsFan ? html`
          <div style="position: absolute; top: 28px; left: 28px; right: 28px; height: 8px; border-radius: 4px; background: #262626;"><div style="width: ${v.fanPct}%; height: 8px; border-radius: 4px; background: ${v.accent};"></div></div>
          <div style="position: absolute; top: 62px; left: 28px; right: 28px; height: 24px; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 20px; color: #6B6B6B;">
            <span style="position: absolute; left: 0;">1</span><span style="position: absolute; right: 0;">7</span>
          </div>
        ` : null}
        <input type="range" class="s6-range ${v.thumbClass}" aria-label=${v.sliderTitle} min=${v.sliderMin} max=${v.sliderMax} step=${v.sliderStep} value=${v.sliderValue} onInput=${v.onSlide} style="position: absolute; top: 4px; left: 0; width: 100%;" />
      </div>
      <button type="button" onClick=${v.sliderStepUp} aria-label="Up" style="width: 72px; height: 72px; flex-shrink: 0; border: 0; border-radius: 50%; background: #1E1E1E; color: #F2F2F2; font-size: 34px; line-height: 1;">+</button>
      <button type="button" onClick=${v.closeSlider} aria-label="Close" style="width: 72px; height: 108px; flex-shrink: 0; border: 0; border-left: 1px solid #262626; background: transparent; margin-left: 4px;">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#A6A6A6" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
      </button>
    </div>
  ` : null}
</div>
`;
  }
}

render(html`<${Home} />`, document.getElementById('stage'));
