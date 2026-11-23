"""Shark 6 wireframe model, traced by hand from BYD's official 1920x1080 side-view press photo.
Photo px -> metres: X forward = (947 - px) / K, Z up = (803 - py) / K. Y = left/right.
Output: model.json = list of [class, [x,y,z, x,y,z, ...]] rounded to cm."""
import json, math
K = 242.0
def P(px, py): return ((947 - px) / K, (803 - py) / K)
W = 0.985          # body half width
WB = 0.93          # greenhouse half width at the beltline
WR = 0.79          # roof half width
ZBELT = P(0, 456)[1]
ZROOF = P(0, 326)[1]
FW = P(488, 700); RW = P(1308, 703)
R = 100 / K; RIM = 66 / K
TRK = 0.83; TW = 0.135
out = []
def add(cls, pts, close=False):
    pts = list(pts)
    if close: pts.append(pts[0])
    out.append([cls, [round(v, 3) for p in pts for v in p]])
def both(cls, pts2, y, close=False):
    """2D side-photo polyline (px) placed on both sides at |y| (y may be a function of z)."""
    for s in (1, -1):
        add(cls, [(x, s * (y(z) if callable(y) else y), z) for x, z in (P(*q) for q in pts2)], close)
def gh_y(z):  # greenhouse half-width at height z (tumblehome)
    t = max(0.0, min(1.0, (z - ZBELT) / (ZROOF - ZBELT)))
    return WB + (WR - WB) * t
def arc(c, r, a0, a1, n):
    return [(c[0] + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), c[1] + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]
def lerp(a, b, t): return a + (b - a) * t

# ---- top profile (centreline) as a function of x, from the photo
TOP = [(290, 494), (300, 490), (330, 482), (400, 472), (500, 466), (600, 460), (645, 456),
       (700, 410), (750, 366), (790, 334), (805, 327), (1125, 326), (1140, 330), (1146, 345), (1150, 455)]
BED = [(1160, 453), (1575, 455), (1590, 458)]
def ztop_hood(x):
    pts = [P(*q) for q in TOP[:7]]
    for a, b in zip(pts, pts[1:]):
        if b[0] <= x <= a[0]: return lerp(a[1], b[1], (a[0] - x) / (a[0] - b[0]))
    return pts[-1][1]

# ---- side silhouette, lower body (both sides at y=W), with wheel-arch cut-outs
ARCH_R = 128 / K
side_lo = [P(300, 492), P(291, 560), P(290, 640), P(300, 670), P(322, 692), P(352, 700)]
# Squared-off arches (traced from the side photo): flat top, steep sides
F_OPEN = [(366, 700), (368, 622), (386, 586), (420, 563), (560, 561), (595, 576), (612, 602), (616, 700)]
F_FLARE = [(352, 612), (362, 576), (386, 546), (422, 528), (470, 524), (560, 526), (596, 540), (616, 566), (623, 602), (626, 700)]
R_OPEN = [(1190, 700), (1192, 622), (1210, 586), (1245, 563), (1372, 561), (1405, 576), (1422, 602), (1426, 700)]
R_FLARE = [(1178, 700), (1180, 602), (1194, 566), (1222, 540), (1262, 527), (1355, 527), (1398, 540), (1424, 566), (1436, 602), (1440, 700)]
side_lo += [P(*q) for q in F_OPEN[1:-1]]
side_lo += [P(616, 700), P(640, 712), P(1150, 712), P(1190, 700)]
side_lo += [P(*q) for q in R_OPEN[1:-1]]
side_lo += [P(1426, 700), P(1440, 692), P(1555, 690), P(1558, 640), P(1600, 632), P(1607, 690), P(1560, 702)]
for s in (1, -1):
    add('body', [(x, s * W, z) for x, z in side_lo])
# fender flares: black cladding standing proud of the body, inner and outer edge
for fl, op in ((F_FLARE, F_OPEN), (R_FLARE, R_OPEN)):
    both('body', fl, W + 0.035)
    both('detail', op, W + 0.035)
    both('detail', fl, W)
# shoulder: hood edge -> belt -> bed rail (the body's top edge on each side)
shoulder = [(300, 492), (330, 484), (450, 474), (600, 462), (645, 456), (1150, 456), (1160, 453), (1575, 455), (1590, 458)]
both('body', shoulder, W)
# lower cladding line and rocker step
both('detail', [(640, 640), (1150, 640)], W)
both('detail', [(650, 700), (1140, 700)], W + 0.04)
both('detail', [(345, 540), (420, 520), (560, 522), (640, 560)], W)   # front fender crease
both('detail', [(1170, 548), (1250, 528), (1400, 528), (1555, 545)], W)   # bed crease
# doors, handles, fuel flap
both('detail', [(640, 456), (640, 712)], W)
both('detail', [(910, 456), (910, 712)], W)
both('detail', [(1150, 456), (1150, 712)], W)
both('light', [(828, 502), (892, 502)], W + 0.01)
both('light', [(1068, 502), (1132, 502)], W + 0.01)
both('detail', [(1210, 478), (1272, 478), (1272, 510), (1210, 510)], W, close=True)
# side glass (on the tumblehome)
both('glass', [(662, 452), (775, 346), (902, 346), (902, 452)], gh_y, close=True)
both('glass', [(926, 452), (926, 346), (1122, 346), (1122, 422), (1094, 426), (1078, 452)], gh_y, close=True)
both('body', [(645, 456), (700, 410), (750, 366), (790, 334), (805, 327)], gh_y)          # A-pillar
both('body', [(805, 327), (1125, 326)], gh_y)                                             # roof edge
both('body', [(1125, 326), (1140, 330), (1146, 345), (1150, 456)], gh_y)                 # C-pillar
both('detail', [(906, 345), (918, 456)], gh_y)                                            # B-pillar
# mirrors
for s in (1, -1):
    m = [P(655, 445), P(660, 412), P(712, 410), P(716, 444)]
    add('body', [(x, s * 0.96, z) for x, z in m] + [(m[-1][0], s * 1.16, m[-1][1]), (m[1][0] - 0.04, s * 1.16, m[1][1]), (m[1][0], s * 0.96, m[1][1])])

# ---- cross-section ribs (gives the 3D mesh look)
def section_top(x):
    """half-section from side (y=W) up and over: returns list of (y,z) for y>=0, outer->centre."""
    xs = P(645, 0)[0]; xr = P(1150, 0)[0]
    if x >= xs:   # hood
        zt = ztop_hood(x); return [(W, zt - 0.02), (W - 0.05, zt), (0.55, zt + 0.015), (0.0, zt + 0.02)]
    if x >= xr:   # cab
        zr = ZROOF
        xw0, xw1 = P(645, 0)[0], P(805, 0)[0]
        if x > xw1:  # windscreen
            t = (xw0 - x) / (xw0 - xw1); zr = lerp(ZBELT, ZROOF, t)
        return [(W, ZBELT), (WB, ZBELT + 0.01), (gh_y(zr), zr), (0.4, zr + 0.015), (0.0, zr + 0.02)]
    return None
def zsill(x):
    for op in (F_OPEN, R_OPEN):
        pts = [P(*q) for q in op]
        for a, b in zip(pts, pts[1:]):
            if b[0] <= x <= a[0] and a[0] != b[0]: return lerp(a[1], b[1], (a[0] - x) / (a[0] - b[0]))
    if x > P(640, 0)[0] or x < P(1150, 0)[0]: return P(0, 690)[1]
    return P(0, 712)[1]
stations = [P(px, 0)[0] for px in (310, 380, 460, 540, 620, 690, 760, 830, 900, 970, 1040, 1110)]
for x in stations:
    h = section_top(x)
    if not h: continue
    zs = zsill(x)
    half = [(W, zs)] + h
    full = half + [(-y, z) for y, z in half[::-1][1:]]
    add('rib', [(x, y, z) for y, z in full])
# bed: walls, floor, ribs
XC, XT = P(1155, 0)[0], P(1585, 0)[0]
ZR, ZF = P(0, 454)[1], P(0, 640)[1]
WI = 0.86
for s in (1, -1):
    add('body', [(XC, s * WI, ZR), (XT, s * WI, ZR)])
    add('detail', [(XC, s * WI, ZF), (XT, s * WI, ZF)])
for x in [lerp(XC, XT, t / 4) for t in range(1, 4)]:
    add('rib', [(x, W, zsill(x)), (x, W, ZR), (x, WI, ZR), (x, WI, ZF), (x, -WI, ZF), (x, -WI, ZR), (x, -W, ZR), (x, -W, zsill(x))])
for y in (-0.43, 0, 0.43):
    add('rib', [(XC, y, ZF), (XT, y, ZF)])
# roof + hood longitudinal contours and roof rails
xa, xb = P(805, 0)[0], P(1125, 0)[0]
for y in (-0.4, 0, 0.4):
    add('rib', [(xa, y, ZROOF + 0.02), (xb, y, ZROOF + 0.02)])
    add('rib', [(x, y, ztop_hood(x) + 0.018) for x in [P(px, 0)[0] for px in range(300, 650, 25)]])
for s in (1, -1):
    rail = [(xa + 0.05, s * 0.66, ZROOF + 0.08), (xb - 0.05, s * 0.66, ZROOF + 0.08)]
    add('body', rail)
    for x in (xa + 0.08, (xa + xb) / 2, xb - 0.08): add('detail', [(x, s * 0.66, ZROOF + 0.02), (x, s * 0.66, ZROOF + 0.08)])
# windscreen + rear cab glass
add('glass', [(P(652, 0)[0], -0.86, ZBELT + 0.03), (P(652, 0)[0], 0.86, ZBELT + 0.03), (P(795, 0)[0], 0.74, ZROOF - 0.03), (P(795, 0)[0], -0.74, ZROOF - 0.03)], close=True)
xcb = P(1146, 0)[0]
add('glass', [(xcb, -0.6, ZBELT + 0.12), (xcb, 0.6, ZBELT + 0.12), (xcb + 0.02, 0.58, ZROOF - 0.08), (xcb + 0.02, -0.58, ZROOF - 0.08)], close=True)
add('body', [(xcb + 0.005, -W, ZBELT), (xcb + 0.005, W, ZBELT)])
add('body', [(XC, -WI, ZF), (XC, WI, ZF)])

# ---- BYD wordmark glyphs (as on the grille and tailgate: open-left B, U-topped Y, D)
GLYPH = {
    'B': [[(0.05, 1), (0.74, 1), (0.95, 0.87), (0.95, 0.63), (0.78, 0.5), (0.12, 0.5)], [(0.78, 0.5), (1, 0.37), (1, 0.13), (0.78, 0), (0.05, 0)]],
    'Y': [[(0, 1), (0, 0.66), (0.16, 0.5), (0.84, 0.5), (1, 0.66), (1, 1)], [(0.5, 0.5), (0.5, 0)]],
    'D': [[(0.05, 1), (0.62, 1), (1, 0.72), (1, 0.28), (0.62, 0), (0, 0), (0, 0.55)]],
}
def word(cls, text, x, ysign, zc, h, w, gap):
    total = len(text) * w + (len(text) - 1) * gap
    for i, ch in enumerate(text):
        u0 = -total / 2 + i * (w + gap)
        for g in GLYPH[ch]:
            add(cls, [(x, ysign * (u0 + u * w), zc - h / 2 + v * h) for u, v in g])
def rect(cls, x, y0, y1, z0, z1):
    add(cls, [(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)], close=True)

# ---- front (traced from the front-three-quarter photo)
XF = P(291, 0)[0]
zh = P(0, 492)[1]                      # hood leading edge
add('body', [(XF - 0.05, -W + 0.04, zh), (XF - 0.05, W - 0.04, zh)])
add('detail', [(XF - 0.01, -0.92, zh - 0.03), (XF - 0.01, 0.92, zh - 0.03)])          # hood shut line
for sd in (1, -1):                                                                 # face corners
    add('body', [(XF - 0.05, sd * (W - 0.04), zh), (XF, sd * (W - 0.03), zh - 0.05), (XF, sd * (W - 0.03), 0.84)])
add('body', [(XF, -W + 0.03, 0.84), (XF, W - 0.03, 0.84)])                         # bottom of the body-colour face
# black grille panel with the silver wordmark and I-shaped end bars
rect('body', XF + 0.004, -0.56, 0.56, 0.98, 1.17)
word('light', 'BYD', XF + 0.01, 1, 1.075, 0.13, 0.22, 0.06)
for sd in (1, -1):
    for z in (0.995, 1.155):
        add('light', [(XF + 0.01, sd * 0.43, z), (XF + 0.01, sd * 0.51, z)])
    add('light', [(XF + 0.01, sd * 0.47, 0.995), (XF + 0.01, sd * 0.47, 1.155)])
    add('detail', [(XF + 0.006, sd * 0.56, 1.075), (XF + 0.006, sd * 0.68, 1.075)])   # bar out to the headlight
    # headlight: square unit at the corner, LED lenses, L-shaped light strip under it
    rect('detail', XF + 0.004, sd * 0.68, sd * 0.95, 0.97, 1.24)
    add('light', [(XF + 0.008, sd * 0.72, 1.17), (XF + 0.008, sd * 0.86, 1.17)])
    add('light', [(XF + 0.008, sd * 0.72, 1.06), (XF + 0.008, sd * 0.86, 1.06)])
    add('light', [(XF + 0.008, sd * 0.68, 0.95), (XF + 0.008, sd * 0.96, 0.95), (XF + 0.008, sd * 0.96, 1.1)])
    # lower intakes with slats
    rect('detail', XF + 0.004, sd * 0.06, sd * 0.55, 0.82, 0.9)
    add('rib', [(XF + 0.006, sd * 0.08, 0.86), (XF + 0.006, sd * 0.53, 0.86)])
# dark lower bumper: wide, stepped forward, fog lamps at the corners
XBF = XF + 0.06
for sd in (1, -1):
    add('body', [(XF, sd * 0.97, 0.84), (XBF, sd * 0.97, 0.8), (XBF, sd * 0.97, 0.55), (XF - 0.08, sd * 0.93, 0.42)])
    rect('light', XBF + 0.003, sd * 0.76, sd * 0.92, 0.75, 0.8)
add('body', [(XBF, -0.97, 0.8), (XBF, 0.97, 0.8)])
add('body', [(XF - 0.08, -0.93, 0.42), (XF - 0.08, 0.93, 0.42)])
# silver skid plate with two raised wings, number plate in the middle
add('glass', [(XBF + 0.004, -0.78, 0.71), (XBF + 0.004, -0.5, 0.71), (XBF + 0.004, -0.42, 0.62), (XBF + 0.004, 0.42, 0.62), (XBF + 0.004, 0.5, 0.71), (XBF + 0.004, 0.78, 0.71),
              (XBF - 0.02, 0.7, 0.52), (XF - 0.06, 0.45, 0.43), (XF - 0.06, -0.45, 0.43), (XBF - 0.02, -0.7, 0.52), (XBF + 0.004, -0.78, 0.71)])
rect('detail', XBF + 0.006, -0.25, 0.25, 0.6, 0.76)
for sd in (1, -1):
    for z in (0.6, 0.645):
        add('glass', [(XBF + 0.006, sd * 0.55, z), (XBF + 0.006, sd * 0.7, z)])

# ---- rear (traced from the rear-three-quarter photo)
XR = P(1590, 0)[0]
zt1 = P(0, 458)[1]
add('body', [(XR, -W, 0.62), (XR, -W, zt1), (XR, W, zt1), (XR, W, 0.62)])
add('detail', [(XR - 0.004, -0.82, 1.33), (XR - 0.004, 0.82, 1.33)])             # top cap of the tailgate
add('tail', [(XR - 0.006, -0.82, 1.29), (XR - 0.006, 0.82, 1.29)])               # full-width light bar
add('tail', [(XR - 0.006, -0.82, 1.26), (XR - 0.006, 0.82, 1.26)])
add('detail', [(XR - 0.004, -0.82, 0.66), (XR - 0.004, 0.82, 0.66), (XR - 0.004, 0.82, 1.43)])
add('detail', [(XR - 0.004, -0.82, 0.66), (XR - 0.004, -0.82, 1.43)])
add('detail', [(XR - 0.004, -0.82, 0.8), (XR - 0.004, 0.82, 0.8)])               # badge band
for sd in (1, -1):
    # tall corner lamps that wrap round onto the bed sides
    lamp = [(XR - 0.006, sd * 0.84, 1.38), (XR - 0.006, sd * 0.84, 0.92), (XR - 0.006, sd * W, 0.9), (XR + 0.17, sd * (W + 0.005), 0.92), (XR + 0.17, sd * (W + 0.005), 1.3), (XR - 0.006, sd * W, 1.38)]
    add('tail', lamp, close=True)
    for z in (1.02, 1.12, 1.22):
        add('tail', [(XR - 0.008, sd * 0.87, z), (XR - 0.008, sd * 0.96, z), (XR + 0.15, sd * (W + 0.006), z)])
word('detail', 'BYD', XR - 0.006, -1, 1.06, 0.26, 0.36, 0.1)
XB = P(1607, 0)[0] - 0.02
for x in (XR, XB):
    add('body', [(x, -0.98, 0.62), (x, 0.98, 0.62), (x, 0.98, 0.36), (x, -0.98, 0.36)], close=True)
for sd in (1, -1):
    add('body', [(XR, sd * 0.98, 0.62), (XB, sd * 0.98, 0.62)])
    add('body', [(XR, sd * 0.98, 0.36), (XB, sd * 0.98, 0.36)])
    add('tail', [(XB - 0.003, sd * 0.66, 0.45), (XB - 0.003, sd * 0.86, 0.45)])
add('detail', [(XB - 0.003, -0.98, 0.56), (XB - 0.003, 0.98, 0.56)])             # step
rect('detail', XB - 0.003, -0.27, 0.27, 0.42, 0.55)
add('detail', [(XB, 0, 0.34), (XB - 0.22, 0, 0.34), (XB - 0.22, 0, 0.42)])

# ---- wheels
for c in (FW, RW):
    for s in (1, -1):
        for yy, cls in ((TRK + TW, 'tyre'), (TRK - TW, 'tyreIn')):
            add(cls, [(c[0] + R * math.cos(a), s * yy, c[1] + R * math.sin(a)) for a in [i * math.pi / 18 for i in range(37)]])
        for k in range(12):
            a = k * math.pi / 6
            add('tread', [(c[0] + R * math.cos(a), s * (TRK + TW), c[1] + R * math.sin(a)), (c[0] + R * math.cos(a), s * (TRK - TW), c[1] + R * math.sin(a))])
        yo = s * (TRK + TW - 0.03)
        add('rim', [(c[0] + RIM * math.cos(a), yo, c[1] + RIM * math.sin(a)) for a in [i * math.pi / 15 for i in range(31)]])
        add('rim', [(c[0] + 0.06 * math.cos(a), yo, c[1] + 0.06 * math.sin(a)) for a in [i * math.pi / 6 for i in range(13)]])
        for k in range(6):
            a = k * math.pi / 3 + 0.25
            add('rim', [(c[0] + 0.06 * math.cos(a), yo, c[1] + 0.06 * math.sin(a)), (c[0] + RIM * math.cos(a - 0.12), yo, c[1] + RIM * math.sin(a - 0.12))])
            add('rim', [(c[0] + 0.06 * math.cos(a + 0.35), yo, c[1] + 0.06 * math.sin(a + 0.35)), (c[0] + RIM * math.cos(a + 0.2), yo, c[1] + RIM * math.sin(a + 0.2))])

meta = {'fw': [round(FW[0], 3), round(FW[1], 3)], 'rw': [round(RW[0], 3), round(RW[1], 3)], 'r': round(R, 3), 'trk': TRK + TW, 'len': [round(XF, 3), round(XB, 3)]}
import sys, os
dst = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'launcher', 'src', 'main', 'assets', 'wire-model.js')
open(dst, 'w').write('// Generated by tools/wire_model.py\nwindow.S6_MODEL=' + json.dumps({'meta': meta, 'lines': out}, separators=(',', ':')) + ';\n')
print(len(out), 'polylines', sum(len(l[1]) // 3 for l in out), 'points', meta)
