"""Shark 6 wireframe as a solid mesh (0.66).

The car is built as real surfaces (quads) so the app can draw it like a 3D model's wireframe:
faces are depth-sorted and filled dark, so the far side, the far wheels and the inside of the
bed are hidden behind what is in front of them, and only the mesh edges facing you are drawn.
Small details (lamps, letters, door cuts, handles) ride on the surfaces as "decal" lines.

Shapes are traced from BYD's side press photo (1920x1080), with the front, rear, sports bar,
rails, steps and flares matched to a 360-degree model viewer.
Photo px -> metres: X forward = (947 - px) / 242, Z up = (803 - py) / 242. Y = left.

Output (assets/wire-model.js): window.S6_MODEL = {meta, v: [x,y,z...], f: [[mat, a, b, c, d]...]
(d = -1 for a triangle), d: [[cls, nx, ny, nz, x,y,z, x,y,z...]...]}. Face winding is such that
the normal (a->b x a->c) points out of the car, so back faces can be skipped.
"""
import json, math, os, sys

K = 242.0
def P(px, py=0): return ((947 - px) / K, (803 - py) / K)
def X(px): return (947 - px) / K
def Z(py): return (803 - py) / K
def lerp(a, b, t): return a + (b - a) * t
def clamp(v, a, b): return max(a, min(b, v))

MAT = {'body': 0, 'black': 1, 'glass': 2, 'tyre': 3, 'rim': 4, 'silver': 5, 'light': 6, 'tail': 7, 'bed': 8}

W = 0.985                    # body half width
WB, WR = 0.93, 0.80          # greenhouse half width at the beltline / at the roof
ZBELT, ZROOF = Z(456), Z(326)
XF0, XR0 = X(291), X(1590)   # front face, tailgate
XW0, XW1, XCB = X(645), X(805), X(1148)   # windscreen base, windscreen top, cab back
FW, RW = P(488, 700), P(1308, 703)
R, RIM = 100 / K, 64 / K
TRK, TW = 0.83, 0.135

# ---------------------------------------------------------------- mesh store
verts, vidx, faces, decals = [], {}, [], []
def vid(p):
    key = (round(p[0], 3), round(p[1], 3), round(p[2], 3))
    i = vidx.get(key)
    if i is None:
        i = vidx[key] = len(verts)
        verts.append(key)
    return i
def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def newell(pts):
    n = [0.0, 0.0, 0.0]
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1])
    return n
def face(mat, pts, ref=None, out=None):
    """Add a quad/triangle. ref: a point inside the solid (normal is flipped to point away from it);
    out: a direction the normal should roughly follow. Degenerate faces are dropped."""
    ids = []
    for p in pts:
        i = vid(p)
        if not ids or ids[-1] != i: ids.append(i)
    if len(ids) > 1 and ids[0] == ids[-1]: ids.pop()
    if len(ids) < 3: return
    q = [verts[i] for i in ids]
    n = newell(q)
    if math.sqrt(dot(n, n)) < 1e-5: return
    c = tuple(sum(p[k] for p in q) / len(q) for k in range(3))
    d = sub(c, ref) if ref is not None else out
    if d is not None and dot(n, d) < 0: ids = ids[::-1]
    faces.append([MAT[mat]] + ids + ([-1] if len(ids) == 3 else []))
def grid(mat_fn, rows, ref_fn, close=False):
    """rows: list of point lists (same length). mat_fn(i, j, centre) -> material or None to skip."""
    for i in range(len(rows) - 1):
        a, b = rows[i], rows[i + 1]
        n = len(a) if close else len(a) - 1
        for j in range(n):
            j2 = (j + 1) % len(a)
            q = [a[j], a[j2], b[j2], b[j]]
            c = tuple(sum(p[k] for p in q) / 4 for k in range(3))
            m = mat_fn(i, j, c)
            if m: face(m, q, ref_fn(c))
def decal(cls, pts, n, close=False):
    pts = list(pts)
    if close: pts.append(pts[0])
    decals.append([cls] + [round(v, 3) for v in n] + [round(v, 3) for p in pts for v in p])
def box(mat, x0, x1, y0, y1, z0, z1, skip=()):
    c = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    F = {'x1': [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], 'x0': [(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)],
         'y1': [(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], 'y0': [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
         'z1': [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], 'z0': [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)]}
    for k, q in F.items():
        if k not in skip: face(mat, q, c)
def tube(mat, a, b, s=0.03, up=(0, 0, 1)):
    """Square tube from a to b (s = half size)."""
    d = sub(b, a); L = math.sqrt(dot(d, d)); d = (d[0] / L, d[1] / L, d[2] / L)
    u = cross(d, up)
    if dot(u, u) < 1e-6: u = cross(d, (1, 0, 0))
    ul = math.sqrt(dot(u, u)); u = (u[0] / ul * s, u[1] / ul * s, u[2] / ul * s)
    v = cross(d, u)
    corners = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
    def at(p, cu, cv): return (p[0] + u[0] * cu + v[0] * cv, p[1] + u[1] * cu + v[1] * cv, p[2] + u[2] * cu + v[2] * cv)
    for k in range(4):
        c0, c1 = corners[k], corners[(k + 1) % 4]
        q = [at(a, *c0), at(a, *c1), at(b, *c1), at(b, *c0)]
        face(mat, q, None, out=(u[0] * (c0[0] + c1[0]) + v[0] * (c0[1] + c1[1]), u[1] * (c0[0] + c1[0]) + v[1] * (c0[1] + c1[1]), u[2] * (c0[0] + c1[0]) + v[2] * (c0[1] + c1[1])))

def interp_px(pts, x):
    m = [P(*q) for q in pts]
    for a, b in zip(m, m[1:]):
        if b[0] <= x <= a[0] and a[0] != b[0]: return lerp(a[1], b[1], (a[0] - x) / (a[0] - b[0]))
    return None
def resample(poly, n):
    """poly: list of (x, z); returns n+1 points evenly spaced along it."""
    L = [0.0]
    for a, b in zip(poly, poly[1:]): L.append(L[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    out = []
    for i in range(n + 1):
        t = L[-1] * i / n
        k = max(j for j in range(len(L) - 1) if L[j] <= t + 1e-9) if t < L[-1] else len(L) - 2
        f = (t - L[k]) / max(1e-9, L[k + 1] - L[k])
        out.append((lerp(poly[k][0], poly[k + 1][0], f), lerp(poly[k][1], poly[k + 1][1], f)))
    return out

# ---------------------------------------------------------------- profiles (side photo)
F_OPEN = [(366, 700), (368, 622), (386, 586), (420, 563), (560, 561), (595, 576), (612, 602), (616, 700)]
F_FLARE = [(352, 700), (352, 612), (362, 576), (386, 546), (422, 528), (470, 524), (560, 526), (596, 540), (616, 566), (623, 602), (626, 700)]
R_OPEN = [(1190, 700), (1192, 622), (1210, 586), (1245, 563), (1372, 561), (1405, 576), (1422, 602), (1426, 700)]
R_FLARE = [(1178, 700), (1180, 602), (1194, 566), (1222, 540), (1262, 527), (1355, 527), (1398, 540), (1424, 566), (1436, 602), (1440, 700)]
SHOULDER = [(300, 492), (330, 484), (450, 474), (600, 462), (645, 456), (1150, 456), (1160, 453), (1575, 455), (1592, 458)]
TOP = [(645, 456), (700, 410), (750, 366), (790, 334), (805, 327), (1125, 326), (1140, 331), (1148, 340)]
FRONT = [(300, 492), (293, 540), (291, 600), (292, 640), (300, 670), (322, 692)]   # front face lean

def zsill(x):
    for op in (F_OPEN, R_OPEN):
        z = interp_px(op, x)
        if z is not None and z > Z(700) + 0.001: return z
    if X(640) >= x >= X(1150): return Z(712)
    return Z(690)
def zsh(x):
    if x >= X(300): return Z(492)
    return interp_px(SHOULDER, x) or ZBELT
def ztop(x): return interp_px(TOP, x) or ZROOF
def xfront(z):
    pts = [P(*q) for q in FRONT]
    for a, b in zip(pts, pts[1:]):
        if b[1] <= z <= a[1]: return lerp(b[0], a[0], (z - b[1]) / (a[1] - b[1]))
    return pts[-1][0] if z < pts[-1][1] else pts[0][0]
def side_y(x, z, zs, zt):
    t = clamp((z - zs) / max(0.05, zt - zs), 0, 1)
    return W - 0.035 * (2 * t - 1) ** 2 + 0.005     # gently barrelled, tucked in at sill and shoulder
def gh_y(z):
    t = clamp((z - ZBELT) / (ZROOF - ZBELT), 0, 1)
    return lerp(WB, WR, t) - 0.03 * t * t

# ---------------------------------------------------------------- lower body: one skin all the way round
# columns go round the plan outline (right side rear->front, front, left side front->rear, rear);
# rows run from the sill (which follows the wheel arches) up to the shoulder.
ROWS = 6
RC = 0.16                      # plan-view corner radius
step = 0.16
xs = set()
n = int((XF0 - RC - (XR0 + RC)) / step)
for i in range(n + 1): xs.add(round(lerp(XF0 - RC, XR0 + RC, i / n), 3))
for poly in (F_OPEN, R_OPEN):
    for px, _ in poly: xs.add(round(X(px), 3))
for px in (640, 910, 1150): xs.add(round(X(px), 3))
xs = sorted((x for x in xs if XR0 + RC - 1e-6 <= x <= XF0 - RC + 1e-6), reverse=True)
# merge stations that are too close (keeps arch edges, drops the grid point next to them)
keep = []
for x in xs:
    if keep and keep[-1] - x < 0.03:
        continue
    keep.append(x)
xs = keep
ZEND_F, ZEND_R = Z(690), Z(690)

def col_side(x, s):
    zs, zt = zsill(x), zsh(x)
    return [(x, s * side_y(x, lerp(zs, zt, t), zs, zt), lerp(zs, zt, t)) for t in (i / ROWS for i in range(ROWS + 1))]
def col_corner(front, s, a):
    """a: 0 (side) -> 1 (face) round a corner."""
    if front:
        cx, zs, zt = XF0 - RC, ZEND_F, zsh(XF0 - RC)
        zt = lerp(zt, Z(492), a)
    else:
        cx, zs, zt = XR0 + RC, ZEND_R, Z(458)
    col = []
    for t in (i / ROWS for i in range(ROWS + 1)):
        z = lerp(zs, zt, t)
        yy = side_y(cx, z, zs, zt) - RC
        ang = a * math.pi / 2
        dx = RC * math.sin(ang)
        x = cx + dx if front else cx - dx
        if front: x += (xfront(z) - XF0) * a
        col.append((x, s * (yy + RC * math.cos(ang)), z))
    return col
def col_face(front, y):
    zs = ZEND_F if front else ZEND_R
    zt = Z(492) if front else Z(458)
    col = []
    for t in (i / ROWS for i in range(ROWS + 1)):
        z = lerp(zs, zt, t)
        x = xfront(z) if front else XR0
        col.append((x, y, z))
    return col

ring = []
NA = 4
for x in reversed(xs): ring.append(col_side(x, -1))                      # right side, rear -> front
for k in range(1, NA): ring.append(col_corner(True, -1, k / NA))
YF = W - RC
for k in range(9): ring.append(col_face(True, lerp(-YF, YF, k / 8)))      # front face
for k in range(NA - 1, 0, -1): ring.append(col_corner(True, 1, k / NA))
for x in xs: ring.append(col_side(x, 1))                                 # left side, front -> rear
for k in range(1, NA): ring.append(col_corner(False, 1, k / NA))
for k in range(9): ring.append(col_face(False, lerp(YF, -YF, k / 8)))     # tailgate
for k in range(NA - 1, 0, -1): ring.append(col_corner(False, -1, k / NA))
rows = [[c[r] for c in ring] for r in range(ROWS + 1)]
def ring_mat(i, j, c):
    x, y, z = c
    if z < Z(640) and XR0 + 0.05 < x < XF0 - 0.05: return 'black'     # lower cladding
    if x > XF0 - 0.08 and z < 0.86: return 'black'                       # front bumper area
    if x < XR0 + 0.06 and z < Z(640): return 'black'
    return 'body'
grid(ring_mat, rows, lambda c: (clamp(c[0], XR0 + 0.8, XF0 - 0.8), 0, c[2]), close=True)

# ---------------------------------------------------------------- hood
HX = [lerp(XF0 - 0.012, XW0, i / 9) for i in range(10)]
def hood_pt(x, u):
    """u: -1..1 across. Crowned, edges rolled down onto the shoulder."""
    zt = zsh(x)
    ys = side_y(x, zt, zsill(x), zt) if x < XF0 - RC else side_y(x, zt, ZEND_F, zt) - (RC - (XF0 - x)) * 0.0
    if x > XF0 - RC:                       # follow the rounded corner in plan
        ang = math.asin(clamp((x - (XF0 - RC)) / RC, 0, 1))
        ys = ys - RC + RC * math.cos(ang)
    y = u * ys
    e = clamp((abs(u) - 0.86) / 0.14, 0, 1)
    return (x, y, zt + 0.03 * (1 - u * u) + 0.015 - 0.015 * e * e - 0.0 * e)
hrows = [[hood_pt(x, -1 + 2 * k / 9) for k in range(10)] for x in HX]
grid(lambda i, j, c: 'body', hrows, lambda c: (c[0], 0, 0.6))
# bulge lines on the hood (raised power-dome edges)
for s in (1, -1):
    decal('detail', [hood_pt(x, s * 0.42) for x in HX[1:]], (0, 0, 1))

# ---------------------------------------------------------------- greenhouse (windscreen, side glass, roof)
NS, NR = 4, 6
GX = [lerp(XW0, XCB, i / 13) for i in range(14)]
WIN = [[(662, 452), (775, 346), (902, 346), (902, 452)],
       [(926, 452), (926, 346), (1122, 346), (1122, 422), (1094, 426), (1078, 452)]]
WIN_M = [[P(*q) for q in w] for w in WIN]
def inside(poly, x, z):
    c = False
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        if (z1 > z) != (z2 > z) and x < x1 + (z - z1) * (x2 - x1) / (z2 - z1): c = not c
    return c
def section(x):
    zt = ztop(x)
    left = []
    for k in range(NS + 1):
        z = lerp(ZBELT, zt - 0.03, k / NS)
        left.append((x, gh_y(z), z))
    yr = gh_y(zt) - 0.06
    top = [(x, yr * (1 - 2 * k / NR), zt + 0.035 * (1 - (1 - 2 * k / NR) ** 2)) for k in range(NR + 1)]
    right = [(x, -p[1], p[2]) for p in reversed(left)]
    return left + top + right
grows = [section(x) for x in GX]
NSEC = len(grows[0])
def gh_mat(i, j, c):
    x, y, z = c
    if j < NS or j >= NS + NR + 2:           # sides
        for w in WIN_M:
            if inside(w, x, z): return 'glass'
        return 'black'                        # blacked-out pillars and frames
    if j == NS or j == NS + NR + 1:           # roof edge / A-pillar fold
        return 'black'
    if x > XW1 + 0.05: return 'glass'         # windscreen
    return 'body'
grid(gh_mat, grows, lambda c: (clamp(c[0], XCB + 0.5, XW1 - 0.5), 0, ZBELT))
# cab back panel (rear window in the middle)
back = section(XCB)
for k in range(NS + 1):
    a, b = back[k], back[NSEC - 1 - k]
    if k < NS:
        a2, b2 = back[k + 1], back[NSEC - 2 - k]
        face('black' if 0 < k < NS - 0 else 'body', [a, a2, b2, b], (XCB + 1, 0, 1.6))
top_mid = back[NS:NS + NR + 1]
for k in range(NR // 2):
    face('black', [top_mid[k], top_mid[k + 1], top_mid[NR - k - 1], top_mid[NR - k]], (XCB + 1, 0, 1.6))
# belt ledge between body side and glass
for s in (1, -1):
    for x0, x1 in zip(GX, GX[1:]):
        face('black', [(x0, s * side_y(x0, ZBELT, zsill(x0), ZBELT), ZBELT), (x1, s * side_y(x1, ZBELT, zsill(x1), ZBELT), ZBELT),
                       (x1, s * gh_y(ZBELT), ZBELT), (x0, s * gh_y(ZBELT), ZBELT)], (x0, 0, 0))
# window frame lines
for w in WIN_M:
    for s in (1, -1):
        decal('glass', [(x, s * (gh_y(z) + 0.004), z) for x, z in w], (0, s, 0.2), close=True)
for s in (1, -1):
    decal('detail', [(X(906), s * (gh_y(ZBELT + 0.02)), ZBELT + 0.02), (X(912), s * gh_y(ZROOF - 0.06), ZROOF - 0.06)], (0, s, 0))

# ---------------------------------------------------------------- bed
XC, XT = X(1158), X(1585)
ZR, ZF = Z(455), Z(640)
WI = 0.86
for s in (1, -1):
    # inner wall, rail cap
    wall = [[(x, s * WI, z) for x in [lerp(XC, XT, i / 6) for i in range(7)]] for z in [lerp(ZF, ZR, i / 3) for i in range(4)]]
    grid(lambda i, j, c: 'bed', wall, lambda c: (c[0], s * 3, c[2]))
    cap = [[(x, s * yy, ZR + (0.012 if yy > WI + 0.01 else 0)) for x in [lerp(XC, XT, i / 6) for i in range(7)]] for yy in (WI, side_y(-1.8, ZR, Z(712), ZR))]
    grid(lambda i, j, c: 'black', cap, lambda c: (c[0], 0, 0))
floor = [[(x, y, ZF) for x in [lerp(XC, XT, i / 6) for i in range(7)]] for y in [lerp(-WI, WI, i / 6) for i in range(7)]]
grid(lambda i, j, c: 'bed', floor, lambda c: (c[0], 0, 0))
for x, ref in ((XC, -5), (XT, 5)):
    wall = [[(x, y, z) for y in [lerp(-WI, WI, i / 6) for i in range(7)]] for z in [lerp(ZF, ZR, i / 3) for i in range(4)]]
    grid(lambda i, j, c: 'bed', wall, lambda c, ref=ref, x=x: (x - ref, 0, c[2]))
face('black', [(XC, -W, ZR), (XC, W, ZR), (XCB, W, ZBELT), (XCB, -W, ZBELT)], (XC, 0, 0))   # gap between cab and bed
face('black', [(XT, -W + 0.03, ZR + 0.01), (XT, W - 0.03, ZR + 0.01), (XR0, W - 0.03, Z(458)), (XR0, -W + 0.03, Z(458))], (XT, 0, 0))  # tailgate top

# ---------------------------------------------------------------- flares (black, standing proud of the body)
for op, fl in ((F_OPEN, F_FLARE), (R_OPEN, R_FLARE)):
    inner = resample([P(*q) for q in op], 18)
    outer = resample([P(*q) for q in fl], 18)
    cx = (inner[0][0] + inner[-1][0]) / 2
    for s in (1, -1):
        yo, yi = s * (W + 0.055), s * (W - 0.0)
        for k in range(18):
            a0, a1, b0, b1 = inner[k], inner[k + 1], outer[k], outer[k + 1]
            face('black', [(a0[0], yo, a0[1]), (a1[0], yo, a1[1]), (b1[0], yo, b1[1]), (b0[0], yo, b0[1])], (cx, 0, 0.6))
            face('black', [(b0[0], yi, b0[1]), (b1[0], yi, b1[1]), (b1[0], yo, b1[1]), (b0[0], yo, b0[1])], (cx, s * W, Z(700)))
            face('black', [(a0[0], yi, a0[1]), (a1[0], yi, a1[1]), (a1[0], yo, a1[1]), (a0[0], yo, a0[1])], None, out=(cx - (a0[0] + a1[0]) / 2, 0, Z(700) - (a0[1] + a1[1]) / 2))

# ---------------------------------------------------------------- side steps, mirrors, door cuts, handles
for s in (1, -1):
    box('black', X(1150) + 0.08, X(640) - 0.08, s * (W - 0.04), s * (W + 0.13), Z(712) - 0.1, Z(712) - 0.055)
    for x in (X(700), X(1090)):
        box('black', x - 0.04, x + 0.04, s * 0.7, s * (W - 0.04), Z(712) - 0.1, Z(712) - 0.06, skip=('y0',))
    # mirror: arm + housing
    mx0, mx1 = X(714), X(656)
    box('black', mx0 + 0.04, mx1 - 0.06, s * (W - 0.03), s * (W + 0.06), Z(450), Z(436))
    mh = [(mx1, s * (W + 0.06), Z(446)), (mx0, s * (W + 0.06), Z(448)), (mx0 + 0.01, s * (W + 0.2), Z(444)), (mx1 - 0.02, s * (W + 0.21), Z(438))]
    for dz0, dz1 in ((0, 0),):
        pass
    face('body', mh, None, out=(0, 0, 1))
    lo = [(p[0] + 0.01, p[1], p[2] - 0.13 + (0.02 if abs(p[1]) > W + 0.1 else 0)) for p in mh]
    face('black', lo, None, out=(0, 0, -1))
    for k in range(4):
        face('body' if k != 1 else 'black', [mh[k], mh[(k + 1) % 4], lo[(k + 1) % 4], lo[k]], ((mx0 + mx1) / 2, s * (W + 0.13), Z(446) - 0.06))
    # door cut lines and handles on the body side
    for px in (640, 910, 1150):
        x = X(px)
        decal('detail', [(x, s * (side_y(x, z, zsill(x), zsh(x)) + 0.004), z) for z in [lerp(zsill(x), zsh(x), i / 6) for i in range(7)]], (0, s, 0))
    for a, b in ((828, 892), (1068, 1132)):
        z = Z(502)
        decal('light', [(X(a), s * (side_y(X(a), z, Z(712), ZBELT) + 0.01), z), (X(b), s * (side_y(X(b), z, Z(712), ZBELT) + 0.01), z)], (0, s, 0))
    # fuel / charge flap on the bed side
    decal('detail', [(X(1210), s * W, Z(478)), (X(1272), s * W, Z(478)), (X(1272), s * W, Z(510)), (X(1210), s * W, Z(510))], (0, s, 0), close=True)
    # shoulder crease along the bed and the front fender
    decal('detail', [(x, s * (W + 0.002), Z(530)) for x in (X(1250), X(1400))], (0, s, 0))

# ---------------------------------------------------------------- roof rails, shark fin, sports bar
for s in (1, -1):
    xa, xb = X(820), X(1110)
    tube('black', (xa, s * 0.68, ZROOF + 0.11), (xb, s * 0.68, ZROOF + 0.11), 0.022)
    for x in (xa + 0.02, xb - 0.02):
        tube('black', (x, s * 0.68, ZROOF + 0.02), (x, s * 0.68, ZROOF + 0.09), 0.025)
xfin = X(1095)
face('black', [(xfin + 0.16, 0, ZROOF + 0.04), (xfin, 0, ZROOF + 0.13), (xfin - 0.02, 0, ZROOF + 0.04)], None, out=(0, 1, 0))
face('black', [(xfin + 0.16, 0.001, ZROOF + 0.04), (xfin, 0.001, ZROOF + 0.13), (xfin - 0.02, 0.001, ZROOF + 0.04)], None, out=(0, -1, 0))
# tray sports bar: a hoop just behind the cab, braced back to the bed rails
hb = XC - 0.12
top = ZROOF - 0.04
for s in (1, -1):
    tube('black', (hb, s * 0.86, ZR + 0.02), (hb - 0.06, s * 0.74, top), 0.03)            # upright
    tube('black', (hb - 0.06, s * 0.74, top), (XC - 0.72, s * 0.88, ZR + 0.02), 0.028)     # back brace
tube('black', (hb - 0.06, 0.77, top), (hb - 0.06, -0.77, top), 0.03)                        # top bar
tube('black', (hb - 0.03, 0.8, ZR + 0.24), (hb - 0.03, -0.8, ZR + 0.24), 0.022)             # lower bar
tube('black', (hb - 0.06, 0.74, top), (XC - 0.72, 0.0, top - 0.22), 0.02) if False else None

# ---------------------------------------------------------------- front: grille, lamps, bumper, skid plate
XF = XF0
box('black', XF - 0.03, XF + 0.012, -0.57, 0.57, 0.975, 1.175)                    # grille panel
for sd in (1, -1):
    box('glass', XF - 0.03, XF + 0.01, sd * 0.68, sd * 0.95, 0.96, 1.24)           # headlight unit
    box('black', XF - 0.03, XF + 0.008, sd * 0.06, sd * 0.56, 0.82, 0.9)           # upper intake
GLYPH = {
    'B': [[(0.05, 1), (0.74, 1), (0.95, 0.87), (0.95, 0.63), (0.78, 0.5), (0.12, 0.5)], [(0.78, 0.5), (1, 0.37), (1, 0.13), (0.78, 0), (0.05, 0)]],
    'Y': [[(0, 1), (0, 0.66), (0.16, 0.5), (0.84, 0.5), (1, 0.66), (1, 1)], [(0.5, 0.5), (0.5, 0)]],
    'D': [[(0.05, 1), (0.62, 1), (1, 0.72), (1, 0.28), (0.62, 0), (0, 0), (0, 0.55)]],
}
def word(cls, x, ysign, zc, h, w, gap, n):
    total = 3 * w + 2 * gap
    for i, ch in enumerate('BYD'):
        u0 = -total / 2 + i * (w + gap)
        for g in GLYPH[ch]:
            decal(cls, [(x, ysign * (u0 + u * w), zc - h / 2 + v * h) for u, v in g], n)
word('silver', XF + 0.014, 1, 1.075, 0.13, 0.22, 0.06, (1, 0, 0))
for sd in (1, -1):
    for z in (0.995, 1.155):
        decal('silver', [(XF + 0.014, sd * 0.43, z), (XF + 0.014, sd * 0.51, z)], (1, 0, 0))
    decal('silver', [(XF + 0.014, sd * 0.47, 0.995), (XF + 0.014, sd * 0.47, 1.155)], (1, 0, 0))
    decal('light', [(XF + 0.012, sd * 0.72, 1.17), (XF + 0.012, sd * 0.88, 1.17)], (1, 0, 0))
    decal('light', [(XF + 0.012, sd * 0.72, 1.06), (XF + 0.012, sd * 0.88, 1.06)], (1, 0, 0))
    decal('light', [(XF + 0.012, sd * 0.69, 0.975), (XF + 0.012, sd * 0.935, 0.975), (XF + 0.012, sd * 0.935, 1.12)], (1, 0, 0))
    decal('detail', [(XF + 0.002, sd * 0.57, 1.075), (XF + 0.002, sd * 0.68, 1.075)], (1, 0, 0))
# lower bumper: wide black block stepped forward, fog lamps in the corners
XBF = XF + 0.07
bz = [0.42, 0.55, 0.8, 0.84]
bump = [[(XF - 0.16, -0.96, bz[0]), (XF - 0.16, 0.96, bz[0])], [(XBF - 0.02, -0.97, bz[1]), (XBF - 0.02, 0.97, bz[1])],
        [(XBF, -0.97, bz[2]), (XBF, 0.97, bz[2])], [(XF, -0.97, bz[3]), (XF, 0.97, bz[3])]]
bump = [[lerp_p for lerp_p in [(r[0][0], lerp(r[0][1], r[1][1], k / 8), r[0][2]) for k in range(9)]] for r in bump]
grid(lambda i, j, c: 'black', bump, lambda c: (XF - 1, 0, 0.6))
for sd in (1, -1):
    face('black', [(XF - 0.16, sd * 0.97, bz[0]), (XBF - 0.02, sd * 0.97, bz[1]), (XF - 0.2, sd * 0.97, bz[1]), (XF - 0.2, sd * 0.97, bz[0])], (XF, 0, 0.6))
    face('black', [(XBF - 0.02, sd * 0.97, bz[1]), (XBF, sd * 0.97, bz[2]), (XF - 0.2, sd * 0.97, bz[2]), (XF - 0.2, sd * 0.97, bz[1])], (XF, 0, 0.6))
    face('black', [(XBF, sd * 0.97, bz[2]), (XF, sd * 0.97, bz[3]), (XF - 0.2, sd * 0.97, bz[3]), (XF - 0.2, sd * 0.97, bz[2])], (XF, 0, 0.6))
    decal('light', [(XBF + 0.004, sd * 0.76, 0.75), (XBF + 0.004, sd * 0.92, 0.75), (XBF + 0.004, sd * 0.92, 0.79), (XBF + 0.004, sd * 0.76, 0.79)], (1, 0, 0), close=True)
# silver skid plate with two raised wings
sk = [(XBF + 0.006, -0.78, 0.71), (XBF + 0.006, -0.5, 0.71), (XBF + 0.006, -0.42, 0.63), (XBF + 0.006, 0.42, 0.63), (XBF + 0.006, 0.5, 0.71), (XBF + 0.006, 0.78, 0.71),
      (XBF - 0.015, 0.7, 0.55), (XF - 0.13, 0.45, 0.43), (XF - 0.13, -0.45, 0.43), (XBF - 0.015, -0.7, 0.55)]
face('silver', [sk[0], sk[1], sk[8], sk[9]], None, out=(1, 0, -0.3))
face('silver', [sk[1], sk[2], sk[3], sk[4], sk[7], sk[8]], None, out=(1, 0, -0.3))
face('silver', [sk[4], sk[5], sk[6], sk[7]], None, out=(1, 0, -0.3))
decal('detail', [(XBF + 0.01, -0.25, 0.6), (XBF + 0.01, 0.25, 0.6), (XBF + 0.01, 0.25, 0.76), (XBF + 0.01, -0.25, 0.76)], (1, 0, 0), close=True)   # plate
decal('detail', [(XF + 0.005, -0.92, Z(492) - 0.03), (XF + 0.005, 0.92, Z(492) - 0.03)], (1, 0, 0.3))      # hood shut line

# ---------------------------------------------------------------- rear: light bar, corner lamps, letters, bumper
XR = XR0 - 0.004
decal('detail', [(XR, -0.82, 1.335), (XR, 0.82, 1.335)], (-1, 0, 0))
decal('tail', [(XR, -0.82, 1.29), (XR, 0.82, 1.29)], (-1, 0, 0))
decal('tail', [(XR, -0.82, 1.265), (XR, 0.82, 1.265)], (-1, 0, 0))
decal('detail', [(XR, -0.82, 0.68), (XR, 0.82, 0.68)], (-1, 0, 0))
decal('detail', [(XR, -0.82, 0.68), (XR, -0.82, 1.43)], (-1, 0, 0))
decal('detail', [(XR, 0.82, 0.68), (XR, 0.82, 1.43)], (-1, 0, 0))
for sd in (1, -1):
    box('tail', XR0 - 0.03, XR0 + 0.004, sd * 0.845, sd * (W - 0.01), 0.9, 1.4)              # corner lamp
    box('tail', XR0 + 0.004, XR0 + 0.17, sd * (W - 0.03), sd * (W + 0.012), 0.92, 1.3, skip=('y0' if sd > 0 else 'y1',))  # wrap onto the side
    for z in (1.02, 1.12, 1.22):
        decal('light', [(XR0 - 0.034, sd * 0.86, z), (XR0 - 0.034, sd * 0.97, z)], (-1, 0, 0))
word('detail', XR - 0.002, -1, 1.06, 0.26, 0.36, 0.1, (-1, 0, 0))
XB = X(1607) - 0.02
box('black', XB, XR0 + 0.02, -0.99, 0.99, 0.36, 0.62)
decal('detail', [(XB - 0.004, -0.99, 0.56), (XB - 0.004, 0.99, 0.56)], (-1, 0, 0))
decal('detail', [(XB - 0.004, -0.27, 0.42), (XB - 0.004, 0.27, 0.42), (XB - 0.004, 0.27, 0.55), (XB - 0.004, -0.27, 0.55)], (-1, 0, 0), close=True)
for sd in (1, -1):
    decal('tail', [(XB - 0.004, sd * 0.66, 0.45), (XB - 0.004, sd * 0.86, 0.45)], (-1, 0, 0))
tube('black', (XB - 0.02, 0, 0.38), (XB - 0.16, 0, 0.38), 0.025)       # tow hitch

# ---------------------------------------------------------------- wheels: tyre with shoulders, recessed rim, spokes
SEG = 16
for cxz in (FW, RW):
    cx, cz = cxz
    for s in (1, -1):
        prof = [(RIM + 0.01, TRK + TW - 0.01), (R - 0.035, TRK + TW), (R, TRK + TW - 0.04), (R, TRK - TW + 0.04), (R - 0.035, TRK - TW), (RIM + 0.01, TRK - TW + 0.01)]
        rr = [[(cx + r * math.cos(a), s * y, cz + r * math.sin(a)) for (r, y) in prof] for a in [2 * math.pi * k / SEG for k in range(SEG + 1)]]
        rows_t = [[rr[k][j] for k in range(SEG + 1)] for j in range(len(prof))]
        grid(lambda i, j, c: 'tyre', rows_t, lambda c, s=s, cx=cx, cz=cz: (cx, s * TRK, cz))
        # rim face, slightly recessed, with a hub
        yo = s * (TRK + TW - 0.035)
        disc = [[(cx + r * math.cos(a), yo, cz + r * math.sin(a)) for a in [2 * math.pi * k / SEG for k in range(SEG + 1)]] for r in (RIM + 0.01, RIM, 0.075)]
        grid(lambda i, j, c: 'rim', disc, lambda c, s=s: (c[0], 0, c[2]))
        face('rim', [(cx + 0.075 * math.cos(2 * math.pi * k / 10), yo, cz + 0.075 * math.sin(2 * math.pi * k / 10)) for k in range(10)], None, out=(0, s, 0))
        yo2 = s * (TRK + TW - 0.03)
        for k in range(6):
            a = k * math.pi / 3 + 0.25
            for da, db in ((0, -0.1), (0.38, 0.22)):
                decal('rim', [(cx + 0.075 * math.cos(a + da), yo2, cz + 0.075 * math.sin(a + da)), (cx + (RIM - 0.01) * math.cos(a + db), yo2, cz + (RIM - 0.01) * math.sin(a + db))], (0, s, 0))
        decal('rim', [(cx + 0.03 * math.cos(2 * math.pi * k / 8), yo2, cz + 0.03 * math.sin(2 * math.pi * k / 8)) for k in range(9)], (0, s, 0))

meta = {'fw': [round(FW[0], 3), round(FW[1], 3)], 'rw': [round(RW[0], 3), round(RW[1], 3)], 'r': round(R, 3), 'trk': TRK + TW, 'len': [round(XBF, 3), round(XB, 3)]}
dst = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'launcher', 'src', 'main', 'assets', 'wire-model.js')
data = {'meta': meta, 'v': [c for v in verts for c in v], 'f': faces, 'd': decals}
open(dst, 'w').write('// Generated by tools/wire_mesh.py\nwindow.S6_MODEL=' + json.dumps(data, separators=(',', ':')) + ';\n')
print(len(verts), 'verts', len(faces), 'faces', len(decals), 'decals', os.path.getsize(dst) // 1024, 'KB', meta)
