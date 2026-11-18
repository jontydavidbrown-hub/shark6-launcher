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
const DRIVE = { 1: 'Normal', 2: 'Eco', 3: 'Sport', 4: 'Snow', 5: 'Mud', 6: 'Sand' };

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
    this.state = { car: {}, boot: 0, slider: null, live: false };
  }
  componentDidMount() {
    window.onCar = (json) => {
      let car;
      try { car = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return; }
      const first = !this.state.live && car.ok;
      this.setState({ car, live: !!car.ok });
      if (first) this.playBoot();
    };
    // Live speedo: Android pushes speed + gear every 100 ms when they change.
    window.onFast = (speed, gear) => {
      if (!this.state.live) return;
      const car = Object.assign({}, this.state.car);
      if (speed >= 0) car.speed = speed;
      if (gear >= 0) car.gear = gear;
      this.setState({ car });
    };
    window.replayBoot = () => this.playBoot();
    window.onCommandResult = (id, r) => this.commandResult(id, r);
    // OTA: Android tells us when a newer build is out, then reports download progress.
    window.onUpdate = (json) => { try { this.setState({ update: JSON.parse(json), updPct: -1, updErr: '' }); } catch (e) {} };
    window.onUpdateProgress = (p) => this.setState({ updPct: p });
    window.onUpdateFailed = (m) => this.setState({ updPct: -1, updErr: 'Update failed. Try again later.' });
    this.playBoot();
  }
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
    Bridge.command(name, JSON.stringify(Object.assign({ id: this.cmdSeq }, args || {})));
  }
  commandResult(id, r) {
    if (r === 'ok') return;
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
    const accent = '#D42A3A';
    const set = (o) => this.setState(o);
    const kRange = this.stage(0), kBars = this.stage(0.1), kClimate = this.stage(0.25), kMusic = this.stage(0.35);
    const count = (v, k) => Math.round(v * k);
    const tempUp = (v, k) => Math.round((16 + (v - 16) * k) * 2) / 2;

    const battPct = num(c.battPct), fuelPct = num(c.fuelPct);
    const evRange = num(c.evRange), fuelRange = num(c.fuelRange);
    const totalRange = num(c.totalRange, evRange + fuelRange);
    const speedNow = Math.max(0, Math.round(num(c.speed)));
    const MAX = 180, b = s.boot;
    // Count straight up from 0 to the current speed (no full-scale sweep).
    const shownSpeed = b >= 1 ? speedNow : Math.round(Math.min(speedNow, MAX) * this.stage(0));

    const gear = GEARS[c.gear] || '';
    const gearColor = (g) => (gear === g ? accent : '#4A4A4A');

    // Power: motor kW (negative = regen) plus engine kW when it is running.
    const motorKw = num(c.motorKw), engineKw = num(c.engineKw);
    const kw = motorKw + Math.max(0, engineKw);
    const hasPower = typeof c.motorKw === 'number' || typeof c.engineKw === 'number';
    const regen = kw < 0;
    const span = Math.min(1, Math.abs(kw) / 150) * 50 * kBars;

    const em = c.energyMode;
    const engineOn = engineKw >= 3;
    const modeLabel = ENERGY[em] || '—';
    const drive = DRIVE[c.opMode];
    const modePower = (drive ? drive + ' · ' : '') + (hasPower
      ? (regen ? Math.round(-kw) + ' kW back to battery' : engineOn ? 'Engine ' + Math.round(engineKw) + ' kW' : Math.round(kw) + ' kW out')
      : 'Power reading unavailable');

    const tyres = Array.isArray(c.tyres) ? c.tyres : [];
    const tyre = (i) => (typeof tyres[i] === 'number' ? (tyres[i] * kBars).toFixed(1) : '—');
    const tyreLow = Array.isArray(c.tyreStates) && c.tyreStates.some((x) => x === 2);
    const tyreColor = (i) => (Array.isArray(c.tyreStates) && c.tyreStates[i] && c.tyreStates[i] !== 0 ? '#FF8A00' : '#F2F2F2');

    const tripKm = num(c.tripKm), tripKwh = num(c.tripKwh);
    const per100 = tripKm >= 1 ? (tripKwh / tripKm) * 100 : 0;

    const m = c.media || {};
    const hasMedia = !!m.title;
    const pos = num(m.pos), dur = num(m.dur);

    this.pending = this.pending || {};
    // Whole degrees only.
    const drvTemp = Math.round(this.pv('drvTemp', num(c.drvTemp, 21))), pasTemp = Math.round(this.pv('pasTemp', num(c.pasTemp, 21)));
    const fan = this.pv('fan', num(c.fan));
    const ac = this.pv('ac', !!c.compressor), auto = this.pv('auto', !!c.auto), demist = this.pv('demist', !!c.demist);
    const st = (on, color) => ({ border: on ? '2px solid ' + color : '1px solid #2A2A2A', bg: on ? '#1A1A1A' : '#161616', icon: on ? color : '#A6A6A6', text: on ? '#F2F2F2' : '#A6A6A6' });
    // SYNC is our own setting: read from the car once, then only the SYNC button changes it.
    if (this.syncMode === undefined && c.dual !== undefined) this.syncMode = c.dual !== 1;
    const synced = this.syncMode === undefined ? true : this.syncMode;
    // When synced, a temp change applies to both sides (the car keeps the zones joined).
    const setTemp = (zone, value) => {
      if (synced) this.pending[zone === 1 ? 'pasTemp' : 'drvTemp'] = { val: value, until: Date.now() + 3000 };
      this.send('temp', { zone, value, both: synced }, zone === 1 ? 'drvTemp' : 'pasTemp', value);
    };
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
      rangeDash: Math.round(641 * Math.min(1, totalRange / 1000) * kRange) + ' 1000',
      battDash: Math.round(518 * battPct / 100 * kBars) + ' 1000',
      gearP: gearColor('P'), gearR: gearColor('R'), gearN: gearColor('N'), gearD: gearColor('D'),
      speed: shownSpeed,
      avgElec: (num(c.avgElec) * kBars).toFixed(1), avgFuel: (num(c.avgFuel) * kBars).toFixed(1),
      driveMode: (drive || '—').toUpperCase(), outside: typeof c.outside === 'number' ? Math.round(c.outside * kBars) : '—',
      replayBoot: () => this.playBoot(),
      speedDash: Math.round(586 * Math.min(shownSpeed, MAX) / MAX) + ' 2000',
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
      tyreNote: tyres.length ? (tyreLow ? 'psi · CHECK' : 'psi · all OK') : 'psi',
      ...(() => {
        // Trip tile: tap switches A/B, hold 1 s resets the trip shown (car's own trip meters).
        const b = s.trip === 'B';
        const km = b ? num(c.trip2Km) : tripKm;
        return {
          tripName: b ? 'B' : 'A', tripAColor: b ? '#555555' : '#F2F2F2', tripBColor: b ? '#F2F2F2' : '#555555',
          tripKm: (km * kBars).toFixed(1), tripKwh: b ? '—' : (per100 * kBars).toFixed(1),
          tripHoldPct: s.tripHold ? 100 : 0, tripHoldAnim: s.tripHold ? 'width 1s linear' : 'none',
          tripTap: () => { if (this.tripDidReset) { this.tripDidReset = false; return; } this.setState({ trip: b ? 'A' : 'B' }); },
          tripHoldStart: () => {
            clearTimeout(this.tripT); this.tripDidReset = false; this.setState({ tripHold: true });
            this.tripT = setTimeout(() => {
              this.tripDidReset = true; this.setState({ tripHold: false }); sfx('off');
              this.send('resetTrip', { trip: b ? 'B' : 'A' });
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
      playing: !!m.playing, paused: !m.playing, playLabel: m.playing ? 'Pause' : 'Play',
      togglePlay: () => Bridge.media(m.playing ? 'pause' : 'play'),
      prevTrack: () => Bridge.media('prev'), nextTrack: () => Bridge.media('next'),
      drvTemp: tempUp(drvTemp, kClimate), pasTemp: tempUp(pasTemp, kClimate),
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
