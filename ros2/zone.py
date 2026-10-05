"""
Zone d'evolution des robots simules : un polygone (repere local de la carte, en metres).

Source : zone.json  ->  {"polygon": [[x, y], ...]}   (dessine depuis le dashboard : bouton "Draw zone")
                    ou  {"x", "y", "cx", "cy", "rotDeg"}  (rectangle, ancienne forme)
La zone peut etre remplacee a chaud (set_polygon) quand le dashboard envoie `set-zone`.
"""
import json
import math
import os

_DEFAULT_RECT = {'x': 9.0, 'y': 7.0, 'cx': 0.0, 'cy': 0.0, 'rotDeg': 0.0}


def rect_polygon(z):
    r = math.radians(z['rotDeg'])
    c, s = math.cos(r), math.sin(r)
    return [(z['cx'] + ux * z['x'] * c - uy * z['y'] * s, z['cy'] + ux * z['x'] * s + uy * z['y'] * c)
            for ux, uy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


def valid_polygon(poly):
    """-> liste de (x, y) ou None. 3 a 16 sommets, nombres finis, surface non nulle."""
    if not isinstance(poly, (list, tuple)) or not 3 <= len(poly) <= 16:
        return None
    pts = []
    for p in poly:
        if not isinstance(p, (list, tuple)) or len(p) != 2 or any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in p):
            return None
        try:
            x, y = float(p[0]), float(p[1])
        except (TypeError, ValueError, IndexError, KeyError):
            return None
        if not (math.isfinite(x) and math.isfinite(y)) or abs(x) > 5000 or abs(y) > 5000:
            return None
        pts.append((x, y))
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    return pts if abs(area) / 2 >= 4.0 else None


def load(path=None):
    path = path or os.environ.get('ZONE_FILE') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'shared', 'zone.json')
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        poly = valid_polygon(data.get('polygon'))
        if poly:
            return poly
        z = dict(_DEFAULT_RECT)
        z.update({k: float(v) for k, v in data.items() if k in _DEFAULT_RECT})
        return rect_polygon(z)
    except (OSError, ValueError, TypeError, AttributeError):
        return rect_polygon(_DEFAULT_RECT)


_poly = load()


def polygon():
    return list(_poly)


def set_polygon(poly):
    """Remplace la zone ; retourne True si le polygone est valide."""
    global _poly
    pts = valid_polygon(poly)
    if not pts:
        return False
    _poly = pts
    return True


def bbox():
    xs, ys = [p[0] for p in _poly], [p[1] for p in _poly]
    return min(xs), min(ys), max(xs), max(ys)


def half_extent():
    x0, y0, x1, y1 = bbox()
    return (x1 - x0) / 2, (y1 - y0) / 2


def center():
    x0, y0, x1, y1 = bbox()
    return (x0 + x1) / 2, (y0 + y1) / 2


def _inside(x, y):
    inside = False
    n = len(_poly)
    for i in range(n):
        (x1, y1), (x2, y2) = _poly[i], _poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def _edge_dist(x, y):
    best = float('inf')
    n = len(_poly)
    for i in range(n):
        (x1, y1), (x2, y2) = _poly[i], _poly[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
        best = min(best, math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)))
    return best


def contains(x, y, margin=0.0):
    """Dans la zone, a au moins `margin` metres du bord (margin<0 : tolerance)."""
    if margin <= 0:
        return _inside(x, y) or _edge_dist(x, y) <= -margin
    return _inside(x, y) and _edge_dist(x, y) >= margin


def random_point(rng, margin=0.5):
    x0, y0, x1, y1 = bbox()
    for _ in range(500):
        p = (rng.uniform(x0, x1), rng.uniform(y0, y1))
        if contains(p[0], p[1], margin):
            return p
    return home()


def home():
    """Un point bien a l'interieur : le centroide, sinon le centre de la boite."""
    a = cx = cy = 0.0
    n = len(_poly)
    for i in range(n):
        (x1, y1), (x2, y2) = _poly[i], _poly[(i + 1) % n]
        w = x1 * y2 - x2 * y1
        a += w; cx += (x1 + x2) * w; cy += (y1 + y2) * w
    if abs(a) > 1e-9:
        c = (cx / (3 * a), cy / (3 * a))
        if _inside(*c):
            return c
    # A concave polygon can have its centroid and bbox center outside the area.
    # An interval between edge intersections on a horizontal slice is inside.
    ys = sorted(set(p[1] for p in _poly))
    for low, high in zip(ys, ys[1:]):
        y = (low + high) / 2
        cuts = []
        for i, (x1, y1) in enumerate(_poly):
            x2, y2 = _poly[(i + 1) % n]
            if (y1 > y) != (y2 > y):
                cuts.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        cuts.sort()
        for left, right in zip(cuts[::2], cuts[1::2]):
            candidate = ((left + right) / 2, y)
            if _inside(*candidate):
                return candidate
    raise ValueError('Polygon has no interior')
