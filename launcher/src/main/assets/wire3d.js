// Vehicle page: a 3D wireframe of the Shark 6 you can spin with a finger.
// Model (metres, X forward, Y left, Z up) comes from wire-model.js, traced from the side photo by tools/wire_model.py.
(function () {
  var M = window.S6_MODEL;
  if (!M || !M.f) return;
  var meta = M.meta;
  var XF = meta.len[0], XB = meta.len[1];
  var REST_YAW = 0.72, REST_PITCH = 0.2, REST_D = 15;
  var st = { accent: '#D42A3A', tyres: [], labels: ['FL', 'FR', 'RL', 'RR'] };
  var cv = null, ctx = null, raf = 0, last = 0;
  var yaw = REST_YAW, pitch = REST_PITCH, dist = REST_D, vy = 0, vp = 0;
  var drag = null, touched = false, lastTouch = 0, intro = null, lastDraw = 0, SPIN = 0.16;

  // ---- mesh, prepared once: per-face normal + centre, decal lines split into short pieces
  var V = M.v, NV = V.length / 3, FACES = M.f, NF = FACES.length;
  var fn = new Float32Array(NF * 3), fc = new Float32Array(NF * 3), fx = new Float32Array(NF);
  for (var f = 0; f < NF; f++) {
    var F0 = FACES[f], n = F0[4] < 0 ? 3 : F0.length - 1, nx = 0, ny = 0, nz = 0, sx = 0, sy = 0, sz = 0;
    for (var k = 0; k < n; k++) {
      var ia = F0[1 + k] * 3, ib = F0[1 + (k + 1) % n] * 3;
      nx += (V[ia + 1] - V[ib + 1]) * (V[ia + 2] + V[ib + 2]);
      ny += (V[ia + 2] - V[ib + 2]) * (V[ia] + V[ib]);
      nz += (V[ia] - V[ib]) * (V[ia + 1] + V[ib + 1]);
      sx += V[ia]; sy += V[ia + 1]; sz += V[ia + 2];
    }
    var nl = Math.hypot(nx, ny, nz) || 1;
    fn[f * 3] = nx / nl; fn[f * 3 + 1] = ny / nl; fn[f * 3 + 2] = nz / nl;
    fc[f * 3] = sx / n; fc[f * 3 + 1] = sy / n; fc[f * 3 + 2] = sz / n; fx[f] = sx / n;
  }
  var DCL = [], DN = [], DP = [];
  M.d.forEach(function (d) {
    for (var i = 4; i + 5 < d.length; i += 3) { DCL.push(d[0]); DN.push(d[1], d[2], d[3]); DP.push(d[i], d[i + 1], d[i + 2], d[i + 3], d[i + 4], d[i + 5]); }
  });
  var ND = DCL.length;
  var PX = new Float32Array(NV), PY = new Float32Array(NV), PZ = new Float32Array(NV);
  var order = new Int32Array(NF + ND), depth = new Float32Array(NF + ND), A3 = [0, 0, 0], B3 = [0, 0, 0];
  // materials: 0 body 1 black 2 glass 3 tyre 4 rim 5 silver 6 light 7 tail 8 bed
  // [fill tint, edge strength, use accent?]
  var MATS = [[0.15, 1.0, 1], [0.07, 0.40, 0], [0.04, 0.6, 2], [0.06, 0.30, 0], [0.12, 0.75, 2], [0.22, 0.9, 0], [0.4, 1, 0], [0.35, 1, 3], [0.08, 0.5, 1]];
  var DSTY = { detail: [1.2, 0.75], glass: [1.1, 0.7], silver: [1.6, 1], light: [1.8, 1], tail: [2.4, 1], rim: [1.2, 0.8] };

  // colour strings are cached per (colour, level): building thousands of strings a frame is slow on the car
  var rgbCache = {};
  function rgb(c, t, steps) {
    var lv = Math.round(Math.max(0, Math.min(1, t)) * steps), key = c.k * 2 + (steps > 50 ? 1 : 0) + lv * 16, v = rgbCache[key];
    if (!v) { var tt = lv / steps; v = rgbCache[key] = 'rgb(' + Math.round(8 + c[0] * tt) + ',' + Math.round(8 + c[1] * tt) + ',' + Math.round(10 + c[2] * tt) + ')'; }
    return v;
  }
  function hexRgb(h) {
    var m = /^#?([0-9a-f]{6})$/i.exec(h || '');
    if (!m) { var r = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(h || ''); return r ? [+r[1], +r[2], +r[3]] : [212, 42, 58]; }
    var n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255];
  }
  function col(cls) {
    var a = hexRgb(st.accent);
    if (cls === 'light') return [242, 242, 242];
    if (cls === 'tail') return [255, 45, 61];
    if (cls === 'glass' || cls === 'rim') return [Math.round(a[0] + (255 - a[0]) * 0.45), Math.round(a[1] + (255 - a[1]) * 0.45), Math.round(a[2] + (255 - a[2]) * 0.45)];
    return a;
  }
  function ease(t) { t = Math.max(0, Math.min(1, t)); return 1 - Math.pow(1 - t, 3); }

  function camera(w, h) {
    var cp = Math.cos(pitch), T = [0, 0, 0.85];
    var c = [T[0] + dist * cp * Math.cos(yaw), T[1] + dist * cp * Math.sin(yaw), T[2] + dist * Math.sin(pitch)];
    var f = [T[0] - c[0], T[1] - c[1], T[2] - c[2]], fl = Math.hypot(f[0], f[1], f[2]); f = [f[0] / fl, f[1] / fl, f[2] / fl];
    var r = [f[1], -f[0], 0], rl = Math.hypot(r[0], r[1]); r = [r[0] / rl, r[1] / rl, 0];
    var u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    var F = Math.min((h > w ? 1.0 : 0.88) * w * REST_D / 5.6, 0.52 * h * REST_D / 2.4);
    return { c: c, f: f, r: r, u: u, F: F, ox: w / 2, oy: h * 0.6 };
  }
  function proj(C, x, y, z, out) {
    var dx = x - C.c[0], dy = y - C.c[1], dz = z - C.c[2];
    var zc = dx * C.f[0] + dy * C.f[1] + dz * C.f[2];
    if (zc < 0.1) zc = 0.1;
    out[0] = C.ox + C.F * (dx * C.r[0] + dy * C.r[1] + dz * C.r[2]) / zc;
    out[1] = C.oy - C.F * (dx * C.u[0] + dy * C.u[1] + dz * C.u[2]) / zc;
    out[2] = zc;
    return out;
  }

  function frame(now) {
    raf = 0;
    if (!cv || !cv.isConnected || !cv.offsetParent) { cv = null; return; }
    // The slow spin only needs ~30 fps; skip alternate frames when nothing else is moving.
    if (!intro && !drag && now - lastDraw < 30) { schedule(); return; }
    lastDraw = now;
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now;
    var bw = cv.offsetWidth, bh = cv.offsetHeight;
    if (!bw || !bh) { schedule(); return; }
    var rect = cv.getBoundingClientRect(), k = (rect.width / bw) * (window.devicePixelRatio || 1);
    k = Math.min(k, 1.25);   // the car's GPU is modest: cap the backing store
    var W = Math.round(bw * k), H = Math.round(bh * k);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, bw, bh);

    // motion: intro sweep, finger inertia, idle drift
    var p = 1;
    if (intro) {
      // Bird's-eye start: straight down on the roof, then swing down and round to the usual three-quarter view.
      p = Math.min(1, (now - intro) / 2400);
      var e = ease(p);
      yaw = REST_YAW + 1.4 * (1 - e); pitch = REST_PITCH + (1.5 - REST_PITCH) * (1 - e); dist = REST_D + 3 * (1 - e);
      if (p >= 1) { intro = null; yaw = REST_YAW; pitch = REST_PITCH; dist = REST_D; }
    } else if (!drag) {
      yaw += vy; pitch = Math.max(0.02, Math.min(0.8, pitch + vp));
      vy *= 0.93; vp *= 0.9;
      // slow, constant turntable spin (pauses for 3 s after a finger lets go)
      if (now - lastTouch > 3000) yaw += SPIN * dt;
    }
    var C = camera(bw, bh), A = [0, 0, 0], B = [0, 0, 0];
    var a = hexRgb(st.accent);

    // turntable
    ctx.lineWidth = 1;
    for (var ring = 0; ring < 2; ring++) {
      var R = ring ? 3.55 : 3.25;
      ctx.beginPath();
      for (var i = 0; i <= 72; i++) {
        proj(C, R * Math.cos(i * Math.PI / 36), R * Math.sin(i * Math.PI / 36), 0, A);
        if (i) ctx.lineTo(A[0], A[1]); else ctx.moveTo(A[0], A[1]);
      }
      if (!ring) { ctx.fillStyle = 'rgba(' + a + ',0.025)'; ctx.fill(); }
      ctx.strokeStyle = 'rgba(' + a + ',' + (ring ? 0.18 : 0.32) + ')';
      ctx.stroke();
    }
    ctx.beginPath();
    for (i = 0; i < 72; i++) {
      var an = i * Math.PI / 36, r0 = i % 6 ? 3.3 : 3.25;
      proj(C, r0 * Math.cos(an), r0 * Math.sin(an), 0, A); proj(C, 3.5 * Math.cos(an), 3.5 * Math.sin(an), 0, B);
      ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]);
    }
    ctx.strokeStyle = 'rgba(' + a + ',0.22)'; ctx.stroke();

    // depth range
    var zn = 1e9, zf = -1e9;
    for (i = 0; i < 8; i++) {
      proj(C, i & 1 ? XF : XB, i & 2 ? 1 : -1, i & 4 ? 2 : 0, A);
      zn = Math.min(zn, A[2]); zf = Math.max(zf, A[2]);
    }
    for (i = 0; i < NV; i++) { proj(C, V[i * 3], V[i * 3 + 1], V[i * 3 + 2], A); PX[i] = A[0]; PY[i] = A[1]; PZ[i] = A[2]; }
    // visible faces and decal pieces, sorted far -> near (painter's algorithm hides what is behind)
    var reveal = intro ? p * 2.2 : 9, cnt = 0, cam = C.c;
    for (f = 0; f < NF; f++) {
      var q = f * 3;
      if (fn[q] * (cam[0] - fc[q]) + fn[q + 1] * (cam[1] - fc[q + 1]) + fn[q + 2] * (cam[2] - fc[q + 2]) <= 0) continue;
      if (reveal < 9 && reveal - (XF - fx[f]) / (XF - XB) * 0.85 < 0) continue;
      var Fa = FACES[f], nn = Fa[4] < 0 ? 3 : Fa.length - 1, dz = 0;
      for (k = 1; k <= nn; k++) dz += PZ[Fa[k]];
      order[cnt++] = f; depth[f] = dz / nn;
    }
    for (i = 0; i < ND; i++) {
      var o = i * 6, nq = i * 3;
      if (DN[nq] * (cam[0] - DP[o]) + DN[nq + 1] * (cam[1] - DP[o + 1]) + DN[nq + 2] * (cam[2] - DP[o + 2]) <= 0) continue;
      if (reveal < 9 && reveal - (XF - DP[o]) / (XF - XB) * 0.85 < 0.3) continue;
      proj(C, (DP[o] + DP[o + 3]) / 2, (DP[o + 1] + DP[o + 4]) / 2, (DP[o + 2] + DP[o + 5]) / 2, A);
      order[cnt++] = NF + i; depth[NF + i] = A[2] - 0.25;
    }
    var idx = Array.prototype.slice.call(order, 0, cnt);
    idx.sort(function (x, y) { return depth[y] - depth[x]; });
    // light comes from above and slightly from the viewer's side
    var Lx = C.c[0] - 0, Ly = C.c[1] * 0.6, Lz = 9, Ll = Math.hypot(Lx, Ly, Lz); Lx /= Ll; Ly /= Ll; Lz /= Ll;
    var white = [242, 242, 242], red = [255, 45, 61], silv = [200, 204, 212];
    var tintA = [Math.round(a[0] + (255 - a[0]) * 0.45), Math.round(a[1] + (255 - a[1]) * 0.45), Math.round(a[2] + (255 - a[2]) * 0.45)];
    a.k = 0; tintA.k = 1; white.k = 2; red.k = 3; silv.k = 4;
    if (rgbCache.acc !== st.accent) { rgbCache = { acc: st.accent }; }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (i = 0; i < cnt; i++) {
      var it = idx[i];
      var dep = 1 - 0.5 * Math.max(0, Math.min(1, (depth[it] - zn) / (zf - zn + 1e-6)));
      if (it < NF) {
        var Fb = FACES[it], m = MATS[Fb[0]], q3 = it * 3, nb = Fb[4] < 0 ? 3 : Fb.length - 1;
        var lam = Math.max(0, fn[q3] * Lx + fn[q3 + 1] * Ly + fn[q3 + 2] * Lz), sh = 0.35 + 0.65 * lam;
        var base = m[2] === 1 ? a : m[2] === 2 ? tintA : m[2] === 3 ? red : Fb[0] === 5 ? silv : white;
        var ft = m[0] * sh, et = m[1] * (0.55 + 0.45 * sh) * dep;
        ctx.beginPath();
        ctx.moveTo(PX[Fb[1]], PY[Fb[1]]);
        for (k = 2; k <= nb; k++) ctx.lineTo(PX[Fb[k]], PY[Fb[k]]);
        ctx.closePath();
        ctx.fillStyle = rgb(base, ft, 100);
        ctx.fill();
        ctx.strokeStyle = rgb(base, et, 40);
        ctx.lineWidth = 0.9;
        ctx.stroke();
      } else {
        var dI = it - NF, s6 = dI * 6, cls = DCL[dI], sty = DSTY[cls] || DSTY.detail;
        var c3 = cls === 'light' ? white : cls === 'tail' ? red : cls === 'silver' ? silv : cls === 'glass' || cls === 'rim' ? tintA : a;
        proj(C, DP[s6], DP[s6 + 1], DP[s6 + 2], A); proj(C, DP[s6 + 3], DP[s6 + 4], DP[s6 + 5], B);
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]);
        ctx.strokeStyle = 'rgba(' + c3 + ',' + sty[1] * dep + ')'; ctx.lineWidth = sty[0];
        ctx.stroke();
      }
    }
    // tyre callouts on the ground beside each wheel
    var la = intro ? ease((p - 0.75) / 0.25) : 1;
    if (la > 0) {
      var wh = [[meta.fw, 1], [meta.fw, -1], [meta.rw, 1], [meta.rw, -1]];
      for (i = 0; i < 4; i++) {
        var w = wh[i][0], sd = wh[i][1];
        proj(C, w[0], sd * meta.trk, w[1], A);
        proj(C, w[0], sd * (meta.trk + 0.9), 0, B);
        B[1] = Math.min(bh - 52, B[1]);
        var near = 1 - (B[2] - zn) / (zf - zn + 1e-6), al = la * (0.45 + 0.55 * Math.max(0, Math.min(1, near)));
        ctx.strokeStyle = 'rgba(242,242,242,' + 0.5 * al + ')'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
        ctx.fillStyle = '#08080A'; ctx.strokeStyle = 'rgba(242,242,242,' + al + ')'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(B[0], B[1], 4.5, 0, 6.2832); ctx.fill(); ctx.stroke();
        var v = st.tyres[i], right = B[0] >= A[0];
        ctx.textAlign = right ? 'left' : 'right'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(242,242,242,' + al + ')';
        ctx.font = "600 34px 'Barlow Condensed', sans-serif";
        var tx = B[0] + (right ? 12 : -12);
        ctx.fillText(v == null || v === '' ? '--' : String(v), tx, B[1] - 6);
        ctx.fillStyle = 'rgba(124,124,132,' + al + ')';
        ctx.font = "700 12px 'Barlow Condensed', sans-serif";
        ctx.fillText(st.labels[i] + ' PSI', tx, B[1] + 18);
      }
    }
    if (!touched) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(124,124,132,' + 0.8 * la + ')';
      ctx.font = "700 13px 'Barlow Condensed', sans-serif";
      ctx.fillText('DRAG TO ROTATE', bw / 2, bh - 10);
    }
    // Only keep drawing while something moves; a still model costs nothing.
    schedule();
  }
  function schedule() { if (!raf && cv) raf = requestAnimationFrame(frame); }

  function bind(c) {
    cv = c; ctx = c.getContext('2d'); last = 0;
    if (c.s6bound) return;
    c.s6bound = true;
    c.style.touchAction = 'none';
    function down(e) {
      drag = { x: e.clientX, y: e.clientY, t: performance.now() }; intro = null; touched = true; vy = vp = 0;
      try { c.setPointerCapture(e.pointerId); } catch (x) { }
    }
    function move(e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y, sc = c.offsetWidth / (c.getBoundingClientRect().width || 1);
      var ny = -dx * sc * 0.0065, np = dy * sc * 0.004;
      yaw += ny; pitch = Math.max(0.02, Math.min(0.8, pitch + np));
      vy = ny; vp = np;
      drag.x = e.clientX; drag.y = e.clientY; lastTouch = performance.now();
      schedule();
    }
    function up() { drag = null; lastTouch = performance.now(); }
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  window.addEventListener('resize', function () { if (cv) schedule(); });
  window.S6Wire = {
    // Called on every app render; cheap. show = the Vehicle page is visible.
    update: function (o) {
      var sig = (o.accent || '') + '|' + (o.tyres || []).join(',');
      var changed = sig !== st.sig;
      st.sig = sig;
      if (o.accent) st.accent = o.accent;
      if (o.tyres) st.tyres = o.tyres;
      var c = document.querySelector('canvas[aria-label="Vehicle model"]');
      if (!c) { cv = null; return; }
      if (c !== cv || o.enter) { changed = true; bind(c); if (o.enter) { intro = performance.now(); yaw = REST_YAW + 1.9; } }
      if (changed || c.width === 0) schedule();
    }
  };
})();
