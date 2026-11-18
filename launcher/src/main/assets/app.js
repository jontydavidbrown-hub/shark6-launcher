// Shark 6 launcher home screen. Ported from the approved design (design/sporty-home.dc.html).
// Live values arrive from Android through window.onCar(json); actions go out through window.Car.
'use strict';
const { html, render, Component } = htmPreact;
const Bridge = window.Car || {
  // Browser preview fallback: no car, so nothing happens.
  command: () => 'no-car', openCarPlay: () => {}, media: () => {}, openApp: () => {}, toast: (m) => console.log(m)
};

const GEARS = { 1: 'P', 2: 'R', 3: 'N', 4: 'D', 5: 'D', 6: 'D' };
const ENERGY = { 0: 'STANDBY', 1: 'EV MODE', 2: 'EV ONLY', 3: 'HYBRID', 4: 'FUEL', 5: 'HOLD' };
const DRIVE = { 1: 'Normal', 2: 'Eco', 3: 'Sport', 4: 'Snow', 5: 'Mud', 6: 'Sand' };

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
    window.replayBoot = () => this.playBoot();
    window.onCommandResult = (id, r) => this.commandResult(id, r);
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
    const accent = '#FF5A5F';
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
    const drvTemp = this.pv('drvTemp', num(c.drvTemp, 21)), pasTemp = this.pv('pasTemp', num(c.pasTemp, 21));
    const fan = this.pv('fan', num(c.fan));
    const ac = this.pv('ac', !!c.compressor), auto = this.pv('auto', !!c.auto), demist = this.pv('demist', !!c.demist);
    const st = (on, color) => ({ border: on ? '2px solid ' + color : '1px solid #2A2A2A', bg: on ? '#1A1A1A' : '#161616', icon: on ? color : '#A6A6A6', text: on ? '#F2F2F2' : '#A6A6A6' });
    const synced = this.pv('synced', c.dual !== 1);
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
      tripKm: (tripKm * kBars).toFixed(1), tripKwh: (per100 * kBars).toFixed(1),
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
      drvUp: () => this.send('temp', { zone: 1, value: clampT(drvTemp + 1) }, 'drvTemp', clampT(drvTemp + 1)),
      drvDown: () => this.send('temp', { zone: 1, value: clampT(drvTemp - 1) }, 'drvTemp', clampT(drvTemp - 1)),
      pasUp: () => this.send('temp', { zone: 2, value: clampT(pasTemp + 1) }, 'pasTemp', clampT(pasTemp + 1)),
      pasDown: () => this.send('temp', { zone: 2, value: clampT(pasTemp - 1) }, 'pasTemp', clampT(pasTemp - 1)),
      fanLabel: auto ? 'AUTO' : String(fan),
      fanSegs: this.segs(Math.round(fan * kClimate), 7, accent),
      ac, auto, demist,
      demistBorder: d.border, demistBg: d.bg, demistIcon: d.icon, demistText: d.text,
      acBorder: a.border, acBg: a.bg, acIcon: a.icon, acText: a.text,
      autoBorder: u.border, autoBg: u.bg, autoIcon: u.icon, autoText: u.text,
      synced, toggleSync: () => this.send('sync', { on: !synced }, 'synced', !synced),
      syncBorder: y.border, syncBg: y.bg, syncIcon: y.icon, syncText: y.text,
      toggleAc: () => this.send('ac', { on: !ac }, 'ac', !ac),
      toggleAuto: () => this.send('auto', { on: !auto }, 'auto', !auto),
      toggleDemist: () => this.send('demist', { on: !demist }, 'demist', !demist),
      drvHeat: this.seat('heat', num(seats.drvHeat), 1, '#FF8A00', 0.3),
      drvVent: this.seat('vent', num(seats.drvVent), 1, '#2FB3FF', 0.3),
      pasHeat: this.seat('heat', num(seats.pasHeat), 2, '#FF8A00', 0.4),
      pasVent: this.seat('vent', num(seats.pasVent), 2, '#2FB3FF', 0.4),
      // Sliders: temperature in whole degrees (the car's setter takes ints), fan 1-7.
      openDrv: () => set({ slider: 'drv' }), openPas: () => set({ slider: 'pas' }), openFan: () => set({ slider: 'fan' }),
      closeSlider: () => set({ slider: null }),
      sliderOpen: !!s.slider,
      sliderTitle: s.slider === 'fan' ? 'FAN SPEED' : s.slider === 'pas' ? 'PASSENGER TEMP' : 'DRIVER TEMP',
      sliderMin: s.slider === 'fan' ? 1 : 17, sliderMax: s.slider === 'fan' ? 7 : 33, sliderStep: 1,
      sliderValue: s.slider === 'fan' ? fan : s.slider === 'pas' ? pasTemp : drvTemp,
      sliderText: s.slider === 'fan' ? String(fan) : (s.slider === 'pas' ? pasTemp : drvTemp) + '°',
      sliderMinLabel: s.slider === 'fan' ? '1 · gentle' : '17° · cool', sliderMaxLabel: s.slider === 'fan' ? 'max · 7' : 'warm · 33°',
      onSlide: (e) => {
        const v = parseInt(e.target.value, 10), which = s.slider;
        const key = which === 'fan' ? 'fan' : which === 'pas' ? 'pasTemp' : 'drvTemp';
        this.pending[key] = { val: v, until: Date.now() + 3000 };
        this.forceUpdate();
        clearTimeout(this.slideTimer);
        this.slideTimer = setTimeout(() => {
          if (which === 'fan') this.send('fan', { level: v }, 'fan', v);
          else this.send('temp', { zone: which === 'pas' ? 2 : 1, value: v }, key, v);
        }, 350);
      }
    };
  }
  render() {
    const v = this.renderVals();
    return html`
<div style="width: 100%; height: 838px; box-sizing: border-box; padding: 20px 28px 28px; background: #050505; color: #F2F2F2; font-family: Barlow, system-ui, sans-serif; position: relative; display: grid; grid-template-columns: minmax(0, 1.14fr) minmax(0, 1.14fr) minmax(0, 1fr) minmax(0, 0.97fr); grid-template-rows: minmax(0, 1fr) 184px; gap: 18px;">

  
  <section aria-label="Range" class="gy-10" style="background: #111111; border: 1px solid #262626; border-radius: 8px; padding: 18px 24px; display: flex; flex-direction: column; align-items: center;  min-height: 0;">
    <div style="align-self: stretch; display: flex; justify-content: space-between; align-items: center;">
      <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 22px; letter-spacing: 0.12em; color: ${v.accent};">RANGE</span>
      <button type="button" onClick=${v.replayBoot} aria-label="Replay startup animation" style="font-size: 12px; color: ${v.liveColor}; background: transparent; border: 1px solid #333; border-radius: 4px; padding: 2px 8px;">${v.liveLabel}</button>
    </div>
    <div style="position: relative; width: 380px; height: 380px; flex-shrink: 0; margin: -10px 0 -24px;">
      <svg width="380" height="380" viewBox="0 0 320 320" aria-hidden="true">
        <circle cx="160" cy="160" r="136" fill="none" stroke="#262626" stroke-width="18" stroke-dasharray="641 1000" transform="rotate(135 160 160)"></circle>
        <circle cx="160" cy="160" r="136" fill="none" stroke=${v.accent} stroke-width="18" stroke-dasharray=${v.rangeDash} transform="rotate(135 160 160)"></circle>
        <circle cx="160" cy="160" r="110" fill="none" stroke="#262626" stroke-width="8" stroke-dasharray="518 1000" transform="rotate(135 160 160)"></circle>
        <circle cx="160" cy="160" r="110" fill="none" stroke="#F2F2F2" stroke-width="8" stroke-dasharray=${v.battDash} transform="rotate(135 160 160)"></circle>
      </svg>
      <div style="position: absolute; top: 0; right: 0; bottom: 0; left: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
        <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 96px; line-height: 1;">${v.totalRange}</span>
        <span style="font-size: 16px; letter-spacing: 0.08em; color: #A6A6A6;">KM TOTAL</span>
      </div>
    </div>
    <div style="align-self: stretch; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;">
      <div style="border-left: 4px solid ${v.accent}; padding-left: 12px;"><div style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 42px; line-height: 1.05;">${v.evRange} KM</div><div style="font-size: 16px; color: #A6A6A6;">Electric · ${v.battPct}%</div></div>
      <div style="border-left: 4px solid #F2F2F2; padding-left: 12px;"><div style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 42px; line-height: 1.05;">${v.fuelRange} KM</div><div style="font-size: 16px; color: #A6A6A6;">Fuel · ${v.fuelPct}%</div></div>
    </div>
    <div style="align-self: stretch; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; border-top: 1px solid #262626; padding-top: 12px;"><div><div style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 38px; line-height: 1.05;">${v.avgElec} <span style="font-family: Barlow, sans-serif; font-weight: 400; font-size: 16px; color: #A6A6A6;">kWh/100</span></div><div style="font-size: 15px; color: #A6A6A6;">Average electric</div></div><div><div style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 38px; line-height: 1.05;">${v.avgFuel} <span style="font-family: Barlow, sans-serif; font-weight: 400; font-size: 16px; color: #A6A6A6;">L/100</span></div><div style="font-size: 15px; color: #A6A6A6;">Average fuel</div></div></div>
  </section>

  
  <section aria-label="Speed" class="gy-10" style="background: #111111; border: 1px solid #262626; border-radius: 8px; padding: 18px 24px; display: flex; flex-direction: column; align-items: center;  min-height: 0;">
    <div style="align-self: stretch; position: relative; height: 36px; display: flex; align-items: center;">
      <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 22px; letter-spacing: 0.12em; color: ${v.accent};">SPEED</span>
      <div class="gx-22" style="position: absolute; top: 0; left: 0; right: 0; height: 36px; display: flex; justify-content: center; align-items: center;  font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 34px; line-height: 1; pointer-events: none;">
        <span style="color: ${v.gearP};">P</span><span style="color: ${v.gearR};">R</span><span style="color: ${v.gearN};">N</span><span style="color: ${v.gearD};">D</span>
      </div>
    </div>
    <div style="position: relative; width: 400px; height: 375px; flex-shrink: 0; margin-bottom: -8px;">
      <svg width="400" height="375" viewBox="0 0 320 300" aria-hidden="true" style="position: absolute; top: 0; right: 0; bottom: 0; left: 0;">
        <circle cx="160" cy="165" r="140" fill="none" stroke="#1C1C1C" stroke-width="10" stroke-dasharray="586 2000" transform="rotate(150 160 165)"></circle>
        <circle cx="160" cy="165" r="140" fill="none" stroke=${v.accent} stroke-width="10" stroke-dasharray=${v.speedDash} transform="rotate(150 160 165)"></circle>
        <circle cx="160" cy="165" r="125" fill="none" stroke="#2A2A2A" stroke-width="6" stroke-dasharray="1.4 11.69" transform="rotate(150 160 165)"></circle>
        <circle cx="160" cy="165" r="125" fill="none" stroke="#111111" stroke-width="8" stroke-dasharray="0 523.6 261.8 2000" transform="rotate(150 160 165)"></circle>
      </svg>
      <div style="position: absolute; top: 0; right: 0; bottom: 0; left: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding-top: 20px;">
        <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 112px; line-height: 0.95;">${v.speed}</span>
        <span style="font-size: 16px; letter-spacing: 0.14em; color: #A6A6A6;">KM/H</span>
      </div>
      <div style="position: absolute; left: 0; right: 0; bottom: 4px; display: flex; justify-content: space-between; padding: 0 34px; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 14px; letter-spacing: 0.08em; color: #6B6B6B;"><span>0</span><span>180</span></div>
    </div>
    <div class="gy-6" style="align-self: stretch; display: flex; flex-direction: column;">
      <div style="position: relative; height: 8px; background: #1C1C1C;">
        <div style="position: absolute; top: 0; bottom: 0; left: ${v.powerLeft}%; width: ${v.powerWidth}%; background: ${v.powerColor};"></div>
        <div style="position: absolute; top: -4px; bottom: -4px; left: 50%; width: 2px; background: #4A4A4A;"></div>
      </div>
      <div style="display: flex; justify-content: space-between; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 19px; letter-spacing: 0.08em; color: #A6A6A6;"><span>REGEN</span><span style="color: #F2F2F2;">${v.powerLabel}</span><span>POWER</span></div>
    </div>
    <div style="align-self: stretch; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; border-top: 1px solid #262626; padding-top: 12px;"><div><div style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 38px; line-height: 1.05;">${v.driveMode} <span style="font-family: Barlow, sans-serif; font-weight: 400; font-size: 16px; color: #A6A6A6;"></span></div><div style="font-size: 15px; color: #A6A6A6;">Drive mode</div></div><div><div style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 38px; line-height: 1.05;">${v.outside}° <span style="font-family: Barlow, sans-serif; font-weight: 400; font-size: 16px; color: #A6A6A6;">C</span></div><div style="font-size: 15px; color: #A6A6A6;">Outside</div></div></div>
  </section>

  
  <section aria-label="Car" style="display: grid; grid-template-rows: 64px minmax(0, 1.75fr) minmax(0, 1fr) minmax(0, 1fr); gap: 14px; min-height: 0;">

    <div aria-label="Drive system: ${v.modeShort}" style="background: #111111; border: 1px solid #262626; border-radius: 8px; padding: 0 16px; display: flex; align-items: center; justify-content: space-between; min-height: 0;">
      <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 17px; letter-spacing: 0.12em; color: ${v.accent};">POWERTRAIN</span>
      <div class="gx-10" style="display: flex; align-items: baseline;">
        <span style="font-size: 13px; color: #A6A6A6;">${v.modeSub}</span>
        <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 30px; line-height: 1; color: ${v.modeColor};">${v.modeShort}</span>
      </div>
    </div>

    <div aria-label="Tyre pressures" style="background: #111111; border: 1px solid #262626; border-radius: 8px; padding: 12px 16px; display: flex; flex-direction: column; min-height: 0;">
      <div style="display: flex; justify-content: space-between; align-items: baseline;">
        <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 17px; letter-spacing: 0.12em; color: ${v.accent};">TYRES</span>
        <span style="font-size: 13px; color: #A6A6A6;">${v.tyreNote}</span>
      </div>
      <div class="gx-14" style="flex: 1; display: flex; align-items: center; justify-content: center;">
        <div style="position: relative; width: 96px; height: 150px;"><div style="position: absolute; top: 14px; left: 0; right: 0; text-align: right;"><div style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 30px; line-height: 1; color: ${v.tyreFLc};">${v.tyreFL}</div><div style="font-size: 11px; letter-spacing: 0.08em; color: #6B6B6B;">FRONT L</div></div><div style="position: absolute; top: 100px; left: 0; right: 0; text-align: right;"><div style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 30px; line-height: 1; color: ${v.tyreRLc};">${v.tyreRL}</div><div style="font-size: 11px; letter-spacing: 0.08em; color: #6B6B6B;">REAR L</div></div></div>
        <svg width="80" height="150" viewBox="0 0 80 170" fill="none" aria-hidden="true" style="flex-shrink: 0;">
          <rect x="3" y="24" width="10" height="26" rx="3" fill=${v.tyreFLc} opacity="0.85"></rect>
          <rect x="67" y="24" width="10" height="26" rx="3" fill=${v.tyreFRc} opacity="0.85"></rect>
          <rect x="3" y="122" width="10" height="26" rx="3" fill=${v.tyreRLc} opacity="0.85"></rect>
          <rect x="67" y="122" width="10" height="26" rx="3" fill=${v.tyreRRc} opacity="0.85"></rect>
          <path d="M8 52 L14 49 L14 57 Z" fill="#5A5A5A"></path>
          <path d="M72 52 L66 49 L66 57 Z" fill="#5A5A5A"></path>
          <path d="M14 30 C14 12 24 5 40 4 C56 5 66 12 66 30 L66 160 C66 164 63 167 59 167 L21 167 C17 167 14 164 14 160 Z" fill="#1A1A1A" stroke="#6B6B6B" stroke-width="2"></path>
          <path d="M22 18 C30 13 50 13 58 18" stroke="#3A3A3A" stroke-width="1.5"></path>
          <path d="M19 47 C30 40 50 40 61 47 L58 61 C47 57 33 57 22 61 Z" fill="#333333"></path>
          <rect x="22" y="63" width="36" height="28" rx="4" fill="#242424"></rect>
          <path d="M22 93 L58 93 L56 99 L24 99 Z" fill="#333333"></path>
          <rect x="19" y="104" width="42" height="58" rx="2" fill="#121212" stroke="#4A4A4A" stroke-width="1.5"></rect>
          <path d="M26 112 L26 154 M33 112 L33 154 M40 112 L40 154 M47 112 L47 154 M54 112 L54 154" stroke="#262626" stroke-width="1.5"></path>
        </svg>
        <div style="position: relative; width: 96px; height: 150px;"><div style="position: absolute; top: 14px; left: 0; right: 0; text-align: left;"><div style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 30px; line-height: 1; color: ${v.tyreFRc};">${v.tyreFR}</div><div style="font-size: 11px; letter-spacing: 0.08em; color: #6B6B6B;">FRONT R</div></div><div style="position: absolute; top: 100px; left: 0; right: 0; text-align: left;"><div style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 30px; line-height: 1; color: ${v.tyreRRc};">${v.tyreRR}</div><div style="font-size: 11px; letter-spacing: 0.08em; color: #6B6B6B;">REAR R</div></div></div>
      </div>
    </div>

    <div aria-label="Trip" style="background: #111111; border: 1px solid #262626; border-radius: 8px; padding: 12px 16px; display: flex; flex-direction: column; justify-content: space-between; min-height: 0;">
      <div style="display: flex; justify-content: space-between; align-items: baseline;">
        <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 17px; letter-spacing: 0.12em; color: ${v.accent};">TRIP</span>
        <span style="font-size: 13px; color: #A6A6A6;">${v.tripFuel}</span>
      </div>
      <div class="gx-22" style="display: flex;">
        <div><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 26px;">${v.tripKm}</span> <span style="font-size: 13px; color: #A6A6A6;">km</span></div>
        <div><span style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 26px;">${v.tripKwh}</span> <span style="font-size: 13px; color: #A6A6A6;">kWh/100</span></div>
      </div>
      <div style="font-size: 13px; color: #A6A6A6;">ODO ${v.odo} km</div>
    </div>

    <a href="#" onClick=${v.openCarPlay} class="gx-14" style="text-decoration: none; background: #111111; border: 1px solid #262626; border-radius: 8px; color: #F2F2F2; padding: 0 16px 0 0; display: flex; align-items: center;  overflow: hidden; min-height: 0;">
      <div style="width: 12px; align-self: stretch; background: ${v.accent}; transform: skewX(-12deg); margin-left: -5px;"></div>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#F2F2F2" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="13" rx="3"></rect><path d="M8 21h8"></path><path d="M9 11.5l2 2 4-4"></path></svg>
      <div style="flex: 1; display: flex; flex-direction: column;">
        <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 26px; line-height: 1;">CARPLAY</span>
      </div>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke=${v.accent} stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
    </a>
  </section>

  
  <section aria-label="Now playing" class="gy-14" style="background: #111111; border: 1px solid #262626; border-radius: 8px; padding: 22px 24px; display: flex; flex-direction: column;  min-height: 0;">
    <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 22px; letter-spacing: 0.12em; color: ${v.accent};">NOW PLAYING</span>
    <div style="flex: 1; min-height: 0; background: #1E1E1E center / contain no-repeat; background-image: ${v.artBg}; border-radius: 6px; display: flex; align-items: center; justify-content: center;">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke=${v.noteColor} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
    </div>
    <div><div style="font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 30px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${v.trackTitle}</div><div style="font-size: 16px; color: #A6A6A6;">${v.trackSub}</div></div>
    <div class="gy-6" style="display: flex; flex-direction: column;">
      <div style="height: 4px; background: #262626;"><div style="width: ${v.musicPct}%; height: 4px; background: ${v.accent};"></div></div>
      <div style="display: flex; justify-content: space-between; font-size: 13px; color: #A6A6A6;"><span>${v.posText}</span><span>${v.durText}</span></div>
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

  
  <section aria-label="Climate and seats" style="grid-column: 1 / -1; background: #111111; border: 1px solid #262626; border-radius: 8px; padding: 18px 24px; display: grid; grid-template-columns: 1.1fr 1fr 2.1fr 1fr 1.1fr; gap: 18px; align-items: stretch;">

    <div class="gy-8" style="display: flex; flex-direction: column;">
      <span style="font-size: 14px; letter-spacing: 0.06em; color: #A6A6A6;">PASSENGER SEAT</span>
      <div style="flex: 1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;">
        <button type="button" onClick=${v.pasHeat.cycle} aria-label="Passenger seat heating, ${v.pasHeat.label}" class="gy-6" style="border: 0; background: ${v.pasHeat.bg}; color: #F2F2F2; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <svg width="32" height="32" viewBox="0 -960 960 960" fill=${v.pasHeat.icon} aria-hidden="true"><path d="M765-490q-11-7-14-19t5-22l8-11q8-11 12-24t4-27q0-18-6.5-34.5T754-658q-21-23-32.5-50.5T710-767q0-22 6.5-43t19.5-39l8-12q7-11 19-12.5t23 5.5q11 7 13 19t-6 22l-8 11q-8 11-12 23.5t-4 26.5q0 19 7 35.5t20 30.5q21 23 32.5 50.5T840-591q0 22-6.5 43T814-509l-8 11q-8 10-19 12.5t-22-4.5Zm-173 0q-11-7-14-19t5-22l8-11q8-11 12-23.5t4-26.5q0-19-7-35.5T580-658q-21-23-32.5-50.5T536-767q0-22 6.5-43t19.5-39l8-12q7-11 18.5-13t22.5 5q10 7 12.5 19t-4.5 23l-7 11q-8 11-12 23.5t-4 26.5q0 19 7 35.5t20 30.5q21 23 32.5 50.5T667-591q0 22-6.5 43T641-509l-8 11q-8 10-19 12.5t-22-4.5Zm-173 0q-11-7-14-19t5-22l8-11q8-11 12-23.5t4-26.5q0-19-7-35.5T407-658q-21-23-33-50.5T362-767q0-22 6.5-43t20.5-39l9-12q8-10 20-12t22 5q11 7 13 19t-6 22l-8 11q-8 11-12 23.5t-4 26.5q0 19 7 35.5t20 30.5q21 23 32.5 50.5T494-591q0 22-6.5 43T468-509l-8 11q-8 10-19 12.5t-22-4.5ZM297-120q-25 0-44-14.5T228-172l-99-386q-5-14-6.5-29t-1.5-30q0-28 6.5-54.5T146-723q8-16 22.5-25.5T200-758q20 0 33.5 14t13.5 34q0 9-2.5 17T234-678q-22 23-26 53.5t9 59.5l17 43q28 65 49 132.5T304-250v54q8-11 24.5-18.5T365-222h260q21 0 36 15t15 36q0 21-15 36t-36 15H297Z"></path></svg>
          <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 20px; line-height: 1;">${v.pasHeat.label}</span>
          <div class="gx-4" style="display: flex;">${v.pasHeat.segs.map((s) => html`<div style="width: 14px; height: 5px; transform: skewX(-24deg); background: ${s.c};"></div>`)}</div>
        </button>
        <button type="button" onClick=${v.pasVent.cycle} aria-label="Passenger seat ventilation, ${v.pasVent.label}" class="gy-6" style="border: 0; background: ${v.pasVent.bg}; color: #F2F2F2; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <svg width="32" height="32" viewBox="0 -960 960 960" fill=${v.pasVent.icon} aria-hidden="true"><path d="M629.12-478q-22.8 0-34.96-14.25T582-523q0-13 5.31-23.62 5.3-10.61 16.67-18.19 8.34-5.31 14.79-14.03 6.44-8.72 10.23-26.16-2.86-1.56-5.36-3.11-2.5-1.56-4.64-3.89-29 11-42 16t-27.21 5q-28.42 0-50.1-25Q478-641 478-688.88q0-22.8 14.25-34.96T523-736q13 0 23.62 5.31 10.61 5.3 18.19 16.67 5.31 8.34 14.03 14.79 8.72 6.44 26.16 10.23 1.56-2.86 3.11-5.36 1.56-2.5 3.89-4.64-11-29-16-42t-5-27.21q0-28.42 25-50.1Q641-840 688.88-840q22.8 0 34.96 14.25T736-795q0 13-5.31 23.62-5.3 10.61-16.67 18.19-8.34 5.31-14.79 14.03-6.44 8.72-10.23 26.16 2.86 1.56 5.36 3.11 2.5 1.56 4.64 3.89 29-11 42-16t27.21-5q28.42 0 50.1 25Q840-677 840-629.12q0 22.8-14.25 34.96T795-582q-13 0-23.62-5.31-10.61-5.3-18.19-16.67-5.31-8.34-14.03-14.79-8.72-6.44-26.16-10.23-1.56 2.86-3.11 5.36-1.56 2.5-3.89 4.64 11 29 16 42t5 27.21q0 28.42-25 50.1Q677-478 629.12-478Zm51.38-159.68q8.5-8.67 8.5-21.5 0-12.82-8.68-21.32-8.67-8.5-21.5-8.5-12.82 0-21.32 8.68-8.5 8.67-8.5 21.5 0 12.82 8.68 21.32 8.67 8.5 21.5 8.5 12.82 0 21.32-8.68ZM297-120q-24.65 0-43.83-14.5Q234-149 228-172l-99-386q-5-14-6.5-28.84T121-617q0-27.66 6.5-54.33Q134-698 146-723q7.84-16.15 22.2-25.58 14.36-9.42 31.78-9.42 20.02 0 33.52 14.25Q247-729.5 247-710.22q0 9.22-2.5 17.22-2.5 8-10.5 15-21.92 23.01-25.96 53.51Q204-594 217-565l17 43q28 65 49 132.5T304-250v54q8-11 24.5-18.5T365-222h239q30.22 0 51.11 21.15T676-150v30H297Z"></path></svg>
          <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 20px; line-height: 1;">${v.pasVent.label}</span>
          <div class="gx-4" style="display: flex;">${v.pasVent.segs.map((s) => html`<div style="width: 14px; height: 5px; transform: skewX(-24deg); background: ${s.c};"></div>`)}</div>
        </button>
      </div>
    </div>

    <div class="gy-8" style="display: flex; flex-direction: column;">
      <span style="font-size: 14px; letter-spacing: 0.06em; color: #A6A6A6;">PASSENGER</span>
      <div style="flex: 1; display: flex; align-items: center; justify-content: space-between; border: 0; background: #161616; border-radius: 6px; padding: 0 8px;">
        <button type="button" onClick=${v.pasDown} aria-label="Passenger temperature down" style="width: 54px; height: 54px; border: 0; background: #1E1E1E; color: #F2F2F2; border-radius: 4px; font-size: 26px;">–</button>
        <button type="button" onClick=${v.openPas} aria-label="Passenger temperature ${v.pasTemp} degrees, tap for slider" style="border: 0; background: transparent; color: #F2F2F2; padding: 0 6px; font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 54px; line-height: 1.1;">${v.pasTemp}°</button>
        <button type="button" onClick=${v.pasUp} aria-label="Passenger temperature up" style="width: 54px; height: 54px; border: 0; background: #1E1E1E; color: #F2F2F2; border-radius: 4px; font-size: 26px;">+</button>
      </div>
    </div>

    <div class="gy-8" style="display: flex; flex-direction: column;">
      <span style="font-size: 14px; letter-spacing: 0.06em; color: #A6A6A6;">CLIMATE</span>
      <div style="flex: 1; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px;">
        <button type="button" onClick=${v.toggleDemist} aria-pressed=${v.demist} aria-label="Demist" class="gy-8" style="border: ${v.demistBorder}; background: ${v.demistBg}; color: #F2F2F2; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <svg width="36" height="36" viewBox="0 -960 960 960" fill=${v.demistIcon} aria-hidden="true"><path d="M152-300q-12 2-22.5-5T117-324L42-739q-2-13 5-23.5T67-777q118-32 219.5-47.5T481-840q93 0 193.5 15.5T894-777q13 4 20 14.5t5 23.5l-75 416q-2 12-12 18.5t-22 4.5q-12-2-19-12t-5-22l69-392q-114-28-203.5-41T481-780q-81 0-171.5 13T106-726l70 392q2 12-5 22t-19 12Zm508 65q0-18-6.5-34.5T634-300q-21-23-32.5-50.5T590-409q0-22 6.5-43t19.5-39l8-12q7-11 19-13t23 5q11 7 12.5 19t-5.5 23l-8 11q-8 11-12 23.5t-4 26.5q0 19 7 35.5t20 30.5q21 23 32.5 50.5T720-233q0 22-6.5 43T694-151l-8 11q-7 11-19 13t-23-5q-11-7-13-18.5t5-22.5l8-11q8-11 12-24t4-27Zm-173 1q0-19-7-35.5T460-300q-21-23-32.5-50.5T416-409q0-22 6.5-43t19.5-39l8-12q7-11 19-13t23 5q11 7 12.5 19t-5.5 23l-7 11q-8 11-12 23.5t-4 26.5q0 19 7 35.5t20 30.5q21 23 32.5 50.5T547-233q0 22-6.5 43T521-151l-8 11q-7 11-19 13t-23-5q-11-7-13-18.5t5-22.5l8-11q8-11 12-23.5t4-26.5Zm-173 0q0-19-7-35.5T287-300q-21-23-33-50.5T242-409q0-22 6.5-43t20.5-39l9-12q7-11 19-13t23 5q11 7 12.5 19t-5.5 23l-8 11q-8 11-12 23.5t-4 26.5q0 19 7 35.5t20 30.5q21 23 32.5 50.5T374-233q0 22-6.5 43T348-151l-8 11q-7 11-19 13t-23-5q-11-7-13-18.5t5-22.5l8-11q8-11 12-23.5t4-26.5Z"></path></svg>
          <span style="font-size: 12px; font-weight: 600; letter-spacing: 0.12em; color: ${v.demistText};">DEMIST</span>
        </button>
        <button type="button" onClick=${v.toggleAc} aria-pressed=${v.ac} aria-label="A/C" class="gy-8" style="border: ${v.acBorder}; background: ${v.acBg}; color: #F2F2F2; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <svg width="34" height="34" viewBox="0 -960 960 960" fill=${v.acIcon} aria-hidden="true"><path d="M450-275 321-146q-8 8-20.5 8t-21.5-8q-9-9-9-21.5t9-21.5l171-171v-90h-90L192-282q-8 8-20.5 8.5T150-281q-9-9-9.5-21.5T150-325l125-125H109q-12 0-20.5-8.5T80-480q0-12 8.5-21t21.5-9h165L146-638q-9-9-9-21.5t9-21.5q9-9 21.5-9t21.5 9l171 171h90v-91L282-768q-8-8-8-20.5t8-21.5q9-9 21.5-9t22.5 9l124 124v-164q0-12 8.5-21t21.5-9q12 0 21 9t9 21v164l128-128q9-9 21.5-9t21.5 9q8 9 8 21.5t-9 21.5L510-601v91h91l168-168q8-8 20.5-8t21.5 8q9 9 9 21.5t-9 21.5L686-510h164q12 0 21 9t9 21q0 13-9 21.5t-21 8.5H686l127 129q9 8 9 20.5t-9 20.5q-8 10-20.5 10t-21.5-9L601-450h-91v90l171 173q9 8 9 20.5t-9 20.5q-8 10-20.5 10t-21.5-9L510-275v166q0 12-9 20.5T480-80q-13 0-21.5-8.5T450-110v-165Z"></path></svg>
          <span style="font-size: 12px; font-weight: 600; letter-spacing: 0.12em; color: ${v.acText};">A/C</span>
        </button>
        <button type="button" onClick=${v.toggleAuto} aria-pressed=${v.auto} aria-label="Auto" class="gy-8" style="border: ${v.autoBorder}; background: ${v.autoBg}; color: #F2F2F2; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <svg width="34" height="34" viewBox="0 -960 960 960" fill=${v.autoIcon} aria-hidden="true"><path d="m626-546-37 95q-3 8-9.5 12.5T565-434q-14 0-21.5-11.5T541-470l130-333q3-7 9-11.5t14-4.5h19q8 0 14 4.5t9 11.5l130 334q5 13-2.5 24T842-434q-8 0-14.5-4.5T818-451l-37-95H626Zm16-47h123l-54-148h-15l-54 148ZM167-174q-53-53-53-129 0-48 24-90.5t66-68.5v-286q0-38 27-65t65-27q38 0 65 27t27 65v286q42 26 66 68.5t24 90.5q0 76-53 129t-129 53q-76 0-129-53Zm7-129h244q0-40-19-71.5T348-420l-20-9v-319q0-14-9-23t-23-9q-14 0-23 9t-9 23v319l-20 9q-32 14-51 46t-19 71Z"></path></svg>
          <span style="font-size: 12px; font-weight: 600; letter-spacing: 0.12em; color: ${v.autoText};">AUTO</span>
        </button>
        <button type="button" onClick=${v.toggleSync} aria-pressed=${v.synced} aria-label="Sync driver and passenger temperatures" class="gy-8" style="border: ${v.syncBorder}; background: ${v.syncBg}; color: #F2F2F2; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <svg width="32" height="32" viewBox="0 -960 960 960" fill=${v.syncIcon} aria-hidden="true"><path d="M220-477q0 63 23.5 109.5T307-287l30 21v-94q0-13 8.5-21.5T367-390q13 0 21.5 8.5T397-360v170q0 13-8.5 21.5T367-160H197q-13 0-21.5-8.5T167-190q0-13 8.5-21.5T197-220h100l-15-12q-64-51-93-111t-29-134q0-94 49.5-171.5T342-766q11-5 21 0t14 16q5 11 0 22.5T361-710q-64 34-102.5 96.5T220-477Zm520-6q0-48-23.5-97.5T655-668l-29-26v94q0 13-8.5 21.5T596-570q-13 0-21.5-8.5T566-600v-170q0-13 8.5-21.5T596-800h170q13 0 21.5 8.5T796-770q0 13-8.5 21.5T766-740H665l15 14q60 56 90 120t30 123q0 93-48 169.5T623-195q-11 6-22.5 1.5T584-210q-5-11 0-22.5t16-17.5q65-33 102.5-96T740-483Z"
></path></svg>
          <span style="font-size: 12px; font-weight: 600; letter-spacing: 0.12em; color: ${v.syncText};">SYNC</span>
        </button>
        <button type="button" onClick=${v.openFan} aria-label="Fan speed ${v.fanLabel}, tap for slider" class="gy-6" style="border: 1px solid #2A2A2A; background: #161616; color: #F2F2F2; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <div class="gx-6" style="display: flex; align-items: center;">
            <svg width="30" height="30" viewBox="0 -960 960 960" fill="#F2F2F2" aria-hidden="true"><path d="M424-80q-51 0-77.5-30.5T320-180q0-26 11.5-50.5T367-271q22-14 36.5-37.5T425-373q-1 0-1-.5t-2-1.5l-116 41q-17 6-33 10t-33 4q-63 0-111.5-55T80-536q0-51 30.5-77.5T179-640q26 0 51 11.5t41 35.5q14 22 39.5 37.5T373-535q.67-1 1.33-2 .67-1 .67-2l-41-115q-6-17-10-33t-4-32q0-64 55-112.5T536-880q51 0 77.5 30.5T640-781q0 26-11.5 51T593-689q-26 17-40.5 45T536-586q1 1 1.5.5t1.5 1.5l115-43q17-6 32.5-9.5T719-640q81 0 121 67t40 149q0 51-32 77.5T777-320q-25 0-48.5-11.5T689-367q-14-22-37.5-36.5T587-426q-1 2-1.6 3.06-.6 1.06-1.4 1.94l42 115q6 16 10 30.5t4 30.5q1 65-54 115T424-80Zm56-340q25 0 42.5-17.5T540-480q0-25-17.5-42.5T480-540q-25 0-42.5 17.5T420-480q0 25 17.5 42.5T480-420Zm-58-165q12-5 26-9t28-6q8-45 29.5-81t54.5-58q10-7 15-17.5t5-24.5q0-16.42-10.5-27.71T536-820q-43 0-98.5 20.55-55.5 20.54-57.5 80.32 0 11.21 2.5 21.17T388-680l34 95ZM240-380q14 0 40-8l95-34q-8-14-11.5-28t-3.5-26q-45-8-81-29.5T221-560q-7-10-19-15t-23-5q-19 0-29 10.5T140-536q0 61.94 25.63 108.97Q191.25-380 240-380Zm184 240q53.13 0 104.57-23Q580-186 580-242q0-11-2-19t-6-19l-34-95q-13 6-26.5 10t-27.5 5q-8 45-29.5 81T400-221q-9 6-14.5 18.5T380-179q1 15 11 27t33 12Zm353-240q16.83 0 29.91-9.17Q820-398.33 820-424q0-44-20.5-99t-81.33-57q-11.17 0-20.67 2-9.5 2-17.5 5l-95 35q5 8 10 25.5t5 28.5q45 8 81 29.5t58 54.5q6 8 16.67 14 10.66 6 21.33 6ZM600-484ZM476-600ZM360-476Zm124 116Z"></path></svg>
            <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 28px; line-height: 1;">${v.fanLabel}</span>
          </div>
          <div class="gx-3" style="display: flex;">${v.fanSegs.map((f) => html`<div style="width: 6px; height: 5px; background: ${f.c};"></div>`)}</div>
        </button>
      </div>
    </div>

    <div class="gy-8" style="display: flex; flex-direction: column;">
      <span style="font-size: 14px; letter-spacing: 0.06em; color: #A6A6A6;">DRIVER</span>
      <div style="flex: 1; display: flex; align-items: center; justify-content: space-between; border: 0; background: #161616; border-radius: 6px; padding: 0 8px;">
        <button type="button" onClick=${v.drvDown} aria-label="Driver temperature down" style="width: 54px; height: 54px; border: 0; background: #1E1E1E; color: #F2F2F2; border-radius: 4px; font-size: 26px;">–</button>
        <button type="button" onClick=${v.openDrv} aria-label="Driver temperature ${v.drvTemp} degrees, tap for slider" style="border: 0; background: transparent; color: #F2F2F2; padding: 0 6px; font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 54px; line-height: 1.1;">${v.drvTemp}°</button>
        <button type="button" onClick=${v.drvUp} aria-label="Driver temperature up" style="width: 54px; height: 54px; border: 0; background: #1E1E1E; color: #F2F2F2; border-radius: 4px; font-size: 26px;">+</button>
      </div>
    </div>

    <div class="gy-8" style="display: flex; flex-direction: column;">
      <span style="font-size: 14px; letter-spacing: 0.06em; color: #A6A6A6;">DRIVER SEAT</span>
      <div style="flex: 1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;">
        <button type="button" onClick=${v.drvHeat.cycle} aria-label="Driver seat heating, ${v.drvHeat.label}" class="gy-6" style="border: 0; background: ${v.drvHeat.bg}; color: #F2F2F2; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <svg width="32" height="32" viewBox="0 -960 960 960" fill=${v.drvHeat.icon} aria-hidden="true"><path d="M523-490q-11-7-13.5-19t5.5-22l8-11q8-11 12-24t4-27q0-18-6.5-34.5T513-658q-21-23-33-50.5T468-767q0-22 7-43t20-39l8-12q7-11 18.5-12.5T544-868q11 7 13.5 19t-5.5 22l-8 11q-8 11-12 23.5t-4 26.5q0 19 7 35.5t20 30.5q21 23 32.5 50.5T599-591q0 22-6.5 43T573-509l-8 11q-8 10-19.5 12.5T523-490Zm-173 0q-11-7-13.5-19t5.5-22l8-11q8-11 12-23.5t4-26.5q0-19-7-35.5T339-658q-21-23-33-50.5T294-767q0-22 7-43t20-39l8-12q7-11 18.5-13t22.5 5q10 7 12.5 19t-4.5 23l-7 11q-8 11-12 23.5t-4 26.5q0 19 7 35.5t20 30.5q21 23 32.5 50.5T426-591q0 22-6.5 43T400-509l-8 11q-8 10-19.5 12.5T350-490Zm-173 0q-11-7-13.5-19t5.5-22l8-11q8-11 12-23.5t4-26.5q0-19-7-35.5T166-658q-21-23-33-50.5T121-767q0-22 6.5-43t20.5-39l9-12q8-10 19.5-12t21.5 5q11 7 13.5 19t-5.5 22l-8 11q-8 11-12 23.5t-4 26.5q0 19 7 35.5t20 30.5q21 23 32.5 50.5T253-591q0 22-6.5 43T227-509l-8 11q-8 10-19.5 12.5T177-490Zm159 370q-21 0-36-15t-15-36q0-21 15-36t36-15h260q20 0 36.5 7.5T657-196v-54q0-72 21-139.5T727-522l17-43q13-29 9-59.5T727-678q-8-7-10.5-15t-2.5-17q0-20 13.5-34t33.5-14q17 0 31.5 9.5T815-723q12 25 18.5 51.5T840-617q0 15-1.5 30t-6.5 29l-99 386q-6 23-25 37.5T664-120H336Z"></path></svg>
          <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 20px; line-height: 1;">${v.drvHeat.label}</span>
          <div class="gx-4" style="display: flex;">${v.drvHeat.segs.map((s) => html`<div style="width: 14px; height: 5px; transform: skewX(-24deg); background: ${s.c};"></div>`)}</div>
        </button>
        <button type="button" onClick=${v.drvVent.cycle} aria-label="Driver seat ventilation, ${v.drvVent.label}" class="gy-6" style="border: 0; background: ${v.drvVent.bg}; color: #F2F2F2; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <svg width="32" height="32" viewBox="0 -960 960 960" fill=${v.drvVent.icon} aria-hidden="true"><path d="M272.12-478q-22.8 0-34.96-14.25T225-523q0-12.84 5.5-23.42 5.5-10.58 16.66-18.33 8.19-5.42 14.51-14.34Q268-588 272-605q-3.08-1.56-5.38-3.11-2.31-1.56-4.62-3.89-29 11-42 16t-27.21 5q-28.42 0-50.1-25Q121-641 121-688.88q0-22.8 14.25-34.96T166-736q13.22 0 23.72 5.31 10.5 5.31 18.28 16.69 5.19 8.33 14.07 14.77 8.89 6.44 25.93 10.23 1.56-2.86 3.11-5.36 1.56-2.5 3.89-4.64-11-29-16-42t-5-27.21q0-28.42 25.11-50.1Q284.23-840 332.17-840 355-840 367-825.75T379-795q0 13-5.31 23.62-5.3 10.61-16.67 18.19-8.34 5.31-14.79 14.03-6.44 8.72-10.23 26.16 3.08 1.56 5.38 3.11 2.31 1.56 4.62 3.89 29-11 42-16t27.21-5q28.42 0 50.1 25Q483-677 483-629.12q0 22.8-14.25 34.96T438-582q-13 0-23.62-5.31-10.61-5.3-18.19-16.67-5.31-8.34-14.03-14.79-8.72-6.44-26.16-10.23-2 3-3.56 5.45T349-619q11 29 16 42t5 27.21q0 28.42-25 50.1Q320-478 272.12-478Zm51.38-159.68q8.5-8.67 8.5-21.5 0-12.82-8.68-21.32-8.67-8.5-21.5-8.5-12.82 0-21.32 8.68-8.5 8.67-8.5 21.5 0 12.82 8.68 21.32 8.67 8.5 21.5 8.5 12.82 0 21.32-8.68ZM285-120v-30q0-29.7 20.89-50.85Q326.78-222 357-222h239q20 0 36.5 7.5T657-196v-54q0-72 21-139.5T727-522l17-43q13-29 8.96-59.49-4.04-30.5-25.96-53.51-8-7-10.5-15t-2.5-17.22q0-19.28 13.5-33.53T760.79-758q17.21 0 31.84 9.42Q807.26-739.15 815-723q12 25 18.5 51.67T840-617q0 15.32-1.5 30.16T832-558l-99 386q-6 23-25.17 37.5Q688.65-120 664-120H285Z"></path></svg>
          <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 20px; line-height: 1;">${v.drvVent.label}</span>
          <div class="gx-4" style="display: flex;">${v.drvVent.segs.map((s) => html`<div style="width: 14px; height: 5px; transform: skewX(-24deg); background: ${s.c};"></div>`)}</div>
        </button>
      </div>
    </div>

  </section>
  
  ${v.sliderOpen ? html`
    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 838px; z-index: 10;">
      <div onClick=${v.closeSlider} aria-hidden="true" style="position: absolute; top: 0; left: 0; width: 100%; height: 838px; background: rgba(0,0,0,0.65);"></div>
      <div role="dialog" aria-label=${v.sliderTitle} style="position: absolute; left: 50%; margin-left: -360px; top: 250px; width: 720px; box-sizing: border-box; background: #111111; border: 1px solid #333; border-top: 4px solid ${v.accent}; border-radius: 8px; padding: 22px 28px 26px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 22px; letter-spacing: 0.12em; color: ${v.accent};">${v.sliderTitle}</span>
          <span style="font-family: 'Barlow Condensed', sans-serif; font-style: italic; font-weight: 700; font-size: 64px; line-height: 1;">${v.sliderText}</span>
        </div>
        <input type="range" class="s6-range" aria-label=${v.sliderTitle} min=${v.sliderMin} max=${v.sliderMax} step=${v.sliderStep} value=${v.sliderValue} onInput=${v.onSlide} style="display: block; margin: 18px 0;" />
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 15px; color: #A6A6A6; width: 140px;">${v.sliderMinLabel}</span>
          <button type="button" onClick=${v.closeSlider} style="border: 0; background: ${v.accent}; color: #0A0A0A; border-radius: 6px; height: 64px; width: 220px; font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 24px; letter-spacing: 0.08em;">DONE</button>
          <span style="font-size: 15px; color: #A6A6A6; width: 140px; text-align: right;">${v.sliderMaxLabel}</span>
        </div>
      </div>
    </div>
  ` : null}
</div>
`;
  }
}

render(html`<${Home} />`, document.getElementById('stage'));
