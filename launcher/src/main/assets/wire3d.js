// Vehicle page: a 3D wireframe of the Shark 6 you can spin with a finger.
// Model (metres, X forward, Y left, Z up) comes from wire-model.js, traced from the side photo by tools/wire_model.py.
(function () {
  var M = window.S6_MODEL;
  if (!M) return;
  var lines = M.lines, meta = M.meta;
  var XF = meta.len[0], XB = meta.len[1];
  var REST_YAW = 0.72, REST_PITCH = 0.2, REST_D = 15;
  var st = { accent: '#D42A3A', tyres: [], labels: ['FL', 'FR', 'RL', 'RR'] };
  var cv = null, ctx = null, raf = 0, last = 0;
  var yaw = REST_YAW, pitch = REST_PITCH, dist = REST_D, vy = 0, vp = 0;
  var drag = null, touched = false, lastTouch = 0, intro = null, lastDraw = 0, SPIN = 0.16;
  // Compass (0.66, Jonty): with the car's heading, the floor carries N/E/S/W and the car turns to its real
  // heading under a camera that stays put relative to north (north runs into the screen). Without a
  // heading it falls back to the slow turntable spin.
  var heading = null, hdShow = null, VIEW = 0.5;
  function wrapA(x) { while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; }
  function homeYaw() { return hdShow == null ? REST_YAW : hdShow + Math.PI + VIEW; }
  // centroid X and depth helpers per polyline (precomputed)
  var cx = lines.map(function (l) { var p = l[1], s = 0, n = p.length / 3; for (var i = 0; i < p.length; i += 3) s += p[i]; return s / n; });
  var STY = {
    rib: [1, 0.30, 0], tread: [0.8, 0.28, 0], tyreIn: [1, 0.4, 0], detail: [1.2, 0.62, 0],
    glass: [1.4, 0.75, 0], rim: [1.2, 0.75, 0], body: [2, 1, 1], tyre: [2, 1, 1], light: [1.6, 0.9, 1], tail: [2.6, 1, 1]
  };
  var ORDER = ['rib', 'tread', 'tyreIn', 'detail', 'glass', 'rim', 'body', 'tyre', 'light', 'tail'];

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
    // Size from the middle column, not the whole canvas: the canvas runs under the dials so nothing is cropped.
    var fw = Math.min(w, h * 1.2);
    var F = Math.min((h > w ? 1.0 : 0.88) * fw * REST_D / 5.6, 0.5 * h * REST_D / 2.4);
    return { c: c, f: f, r: r, u: u, F: F, ox: w / 2, oy: h * 0.54 };
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
    if (!intro && !drag && now - lastDraw < 45) { schedule(); return; }
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
    var p = 1, moving = true;
    if (intro) {
      // Bird's-eye start: straight down on the roof, then swing down and round to the usual three-quarter view.
      p = Math.min(1, (now - intro) / 2400);
      var e = ease(p);
      var hy = homeYaw();
      yaw = hy + 1.4 * (1 - e); pitch = REST_PITCH + (1.5 - REST_PITCH) * (1 - e); dist = REST_D + 3 * (1 - e);
      if (p >= 1) { intro = null; yaw = hy; pitch = REST_PITCH; dist = REST_D; }
    } else if (!drag) {
      yaw += vy; pitch = Math.max(0.02, Math.min(0.8, pitch + vp));
      vy *= 0.93; vp *= 0.9;
      if (now - lastTouch > 3000) {
        if (heading == null) yaw += SPIN * dt;      // no compass: slow turntable spin
        else {
          // follow the heading smoothly, then settle the camera back to its place
          var dh = wrapA(heading - (hdShow == null ? heading : hdShow));
          hdShow = wrapA((hdShow == null ? heading : hdShow) + dh * Math.min(1, dt * 2.5));
          var dy = wrapA(homeYaw() - yaw);
          yaw += dy * Math.min(1, dt * 2.5);
          pitch += (REST_PITCH - pitch) * Math.min(1, dt * 2.5);
          moving = Math.abs(dy) > 0.002 || Math.abs(dh) > 0.002 || Math.abs(vy) > 0.0005;
        }
      }
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
    // compass marks on the floor, fixed to the world
    if (hdShow != null) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var CARD = [['N', 0], ['E', -Math.PI / 2], ['S', Math.PI], ['W', Math.PI / 2]];
      for (i = 0; i < 4; i++) {
        var ca = hdShow + CARD[i][1], cx0 = Math.cos(ca), cy0 = Math.sin(ca);
        proj(C, 3.25 * cx0, 3.25 * cy0, 0, A); proj(C, 3.6 * cx0, 3.6 * cy0, 0, B);
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]);
        ctx.strokeStyle = i ? 'rgba(242,242,242,0.45)' : 'rgba(' + a + ',0.95)'; ctx.lineWidth = i ? 1.5 : 3; ctx.stroke();
        proj(C, 3.95 * cx0, 3.95 * cy0, 0, A);
        ctx.font = (i ? '600 20px' : '700 26px') + " 'Barlow Condensed', sans-serif";
        ctx.fillStyle = i ? 'rgba(166,166,172,0.85)' : 'rgb(' + a + ')';
        ctx.fillText(CARD[i][0], A[0], A[1]);
      }
      ctx.lineWidth = 1;
    }

    // depth range
    var zn = 1e9, zf = -1e9;
    for (i = 0; i < 8; i++) {
      proj(C, i & 1 ? XF : XB, i & 2 ? 1 : -1, i & 4 ? 2 : 0, A);
      zn = Math.min(zn, A[2]); zf = Math.max(zf, A[2]);
    }
    // build one path per class x depth bucket (x glow), partial lines during the intro
    var reveal = intro ? p * 2.2 : 9;
    var paths = {};
    for (i = 0; i < lines.length; i++) {
      var L = lines[i], cls = L[0], pts = L[1], n = pts.length / 3;
      var ti = (XF - cx[i]) / (XF - XB), fr = Math.max(0, Math.min(1, (reveal - ti * 0.85) / 0.55));
      if (fr <= 0) continue;
      var m = Math.floor(pts.length / 3 / 2) * 3;
      proj(C, pts[m], pts[m + 1], pts[m + 2], A);
      var bucket = Math.min(2, Math.floor((A[2] - zn) / ((zf - zn) / 3 + 1e-6)));
      var key = cls + bucket;
      var path = paths[key] || (paths[key] = { cls: cls, b: bucket, segs: [] });
      var seg = [], upto = fr * (n - 1);
      for (var j = 0; j < n; j++) {
        if (j > upto + 1) break;
        var t = j > upto ? upto - (j - 1) : 1, q = j * 3;
        if (t < 1) {
          var q0 = q - 3;
          proj(C, pts[q0] + (pts[q] - pts[q0]) * t, pts[q0 + 1] + (pts[q + 1] - pts[q0 + 1]) * t, pts[q0 + 2] + (pts[q + 2] - pts[q0 + 2]) * t, B);
        } else proj(C, pts[q], pts[q + 1], pts[q + 2], B);
        seg.push(B[0], B[1]);
      }
      path.segs.push(seg);
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (var pass = 0; pass < 2; pass++) {
      for (var oi = 0; oi < ORDER.length; oi++) {
        for (var b = 2; b >= 0; b--) {
          var P = paths[ORDER[oi] + b];
          if (!P) continue;
          var s = STY[P.cls], c = col(P.cls), depthA = [1, 0.62, 0.32][b];
          if (pass === 0 && (!s[2] || b === 2)) continue;
          ctx.beginPath();
          for (var si = 0; si < P.segs.length; si++) {
            var sg = P.segs[si];
            ctx.moveTo(sg[0], sg[1]);
            for (var sj = 2; sj < sg.length; sj += 2) ctx.lineTo(sg[sj], sg[sj + 1]);
          }
          ctx.strokeStyle = 'rgba(' + c + ',' + (pass ? s[1] * depthA : 0.16 * depthA) + ')';
          ctx.lineWidth = pass ? s[0] : s[0] * 3.2;
          ctx.stroke();
        }
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
    // Only keep drawing while something moves; a still model costs nothing (keeps the climate buttons snappy).
    if (moving || drag || intro) schedule();
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
    function up() { drag = null; lastTouch = performance.now(); setTimeout(schedule, 3050); schedule(); }
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  window.addEventListener('resize', function () { if (cv) schedule(); });
  window.S6Wire = {
    // Called on every app render; cheap. show = the Vehicle page is visible.
    update: function (o) {
      if (typeof o.heading === 'number' && isFinite(o.heading)) {
        // car heading: degrees clockwise from north -> radians counter-clockwise in the model's frame
        var hr = wrapA(o.heading * Math.PI / 180);
        if (heading == null || Math.abs(wrapA(hr - heading)) > 0.01) { heading = hr; if (hdShow == null) { hdShow = hr; yaw = homeYaw(); } if (cv) schedule(); }
      }
      var sig = (o.accent || '') + '|' + (o.tyres || []).join(',');
      var changed = sig !== st.sig;
      st.sig = sig;
      if (o.accent) st.accent = o.accent;
      if (o.tyres) st.tyres = o.tyres;
      var c = document.querySelector('canvas[aria-label="Vehicle model"]');
      if (!c) { cv = null; return; }
      if (c !== cv || o.enter) { changed = true; bind(c); if (o.enter) { intro = performance.now(); yaw = homeYaw() + 1.9; } }
      if (changed || c.width === 0) schedule();
    }
  };
})();
