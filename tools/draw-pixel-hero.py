#!/usr/bin/env python3
"""Draws the hero layers of the `pixel` style pack: body, head and hairs.

Same grid and skeleton as tools/make-template-pack.py, so the existing armour
and weapon sheets still line up (the weapon hand `lh` is unchanged):

    cell 48x48, 9 columns, 3 rows (down, right, up), feet anchor (24, 44)

Everything is drawn from a fixed palette. Each part is painted as a flat mask,
then a shading pass adds the outline (against empty pixels and parts behind),
a light edge on the top/left and a dark edge on the bottom/right.

    python3 tools/draw-pixel-hero.py            # writes body/head/hair sheets
    python3 tools/draw-pixel-hero.py --preview  # also writes a 4x preview PNG
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(os.environ.get("LUMIIS_ROOT", Path(__file__).resolve().parent.parent))
OUT = ROOT / "packages" / "client" / "public" / "assets" / "styles" / "pixel"

CELL = 48
COLS = 9
ROWS = 3

# ------------------------------------------------------------------- palette
# Every ramp: outline, dark, mid, light. No other colours are ever written.
RAMPS = {
    "skin": ((112, 58, 52), (214, 140, 108), (242, 186, 142), (255, 222, 186)),
    "shirt": ((74, 56, 52), (166, 146, 118), (204, 188, 154), (232, 222, 194)),
    "belt": ((58, 36, 30), (92, 58, 40), (120, 80, 52), (150, 104, 66)),
    "pants": ((34, 32, 56), (56, 60, 96), (76, 84, 128), (100, 112, 160)),
    "boot": ((48, 30, 26), (90, 56, 38), (122, 80, 52), (156, 108, 70)),
    "hair": ((34, 22, 22), (66, 40, 32), (96, 60, 42), (138, 92, 62)),
}
EYE = (38, 30, 48, 255)
IRIS = (72, 98, 158, 255)
GLINT = (255, 255, 255, 255)
BLUSH = (246, 148, 140, 255)
MOUTH = (150, 74, 70, 255)
BUCKLE = (222, 178, 80, 255)

TRANSPARENT = (0, 0, 0, 0)


# ------------------------------------------------------------------ skeleton
def joints(column: int, view: int) -> dict:
    """Pose of one cell. Head and hands match make-template-pack.py."""
    poses = {
        0: {"head": (24, 14), "lh": (16, 36), "rh": (32, 36), "lf": (20, 44), "rf": (28, 44)},
        1: {"head": (24, 14), "lh": (13, 32), "rh": (35, 40), "lf": (17, 44), "rf": (31, 44)},
        2: {"head": (24, 14), "lh": (13, 40), "rh": (35, 32), "lf": (25, 44), "rf": (23, 44)},
        3: {"head": (24, 14), "lh": (15, 35), "rh": (33, 35), "lf": (20, 44), "rf": (28, 44)},
        4: {"head": (24, 13), "lh": (9, 21), "rh": (34, 35), "lf": (20, 44), "rf": (28, 44)},
        5: {"head": (24, 14), "lh": (27, 41), "rh": (31, 33), "lf": (20, 44), "rf": (28, 44)},
        6: {"head": (24, 14), "lh": (18, 34), "rh": (33, 36), "lf": (20, 44), "rf": (28, 44)},
        7: {"head": (23, 15), "lh": (14, 31), "rh": (34, 31), "lf": (20, 44), "rf": (28, 44)},
        8: {"head": (24, 24), "lh": (13, 41), "rh": (35, 41), "lf": (18, 44), "rf": (30, 44)},
    }
    pose = dict(poses[column])

    if view == 1:
        # Side view: weapon arm pulled in front of the body, legs stride.
        pose["lh"] = (24 + (pose["lh"][0] - 24) * 0.25, pose["lh"][1])
        side_feet = {1: ((18, 44), (29, 44)), 2: ((29, 44), (19, 44)), 8: ((17, 44), (30, 44))}
        pose["lf"], pose["rf"] = side_feet.get(column, ((22, 44), (27, 44)))
    elif view == 2:
        mirror = lambda p: (48 - p[0], p[1])  # noqa: E731
        pose["lh"], pose["rh"] = mirror(pose["lh"]), mirror(pose["rh"])
        pose["lf"], pose["rf"] = mirror(pose["lf"]), mirror(pose["rf"])

    return pose


# ------------------------------------------------------------------ painting
class Cell:
    """A 48x48 grid of part ids, painted back to front."""

    def __init__(self) -> None:
        self.part = [[None] * CELL for _ in range(CELL)]  # (ramp, group, z)
        self.color = [[None] * CELL for _ in range(CELL)]  # fixed colour overrides
        self.z = 0

    def set(self, x: int, y: int, ramp: str, group: str) -> None:
        if 0 <= x < CELL and 0 <= y < CELL:
            self.part[y][x] = (ramp, group, self.z)
            self.color[y][x] = None

    def dot(self, x: int, y: int, rgba) -> None:
        if 0 <= x < CELL and 0 <= y < CELL and self.part[y][x] is not None:
            self.color[y][x] = rgba

    def next(self) -> None:
        self.z += 1

    def rect(self, x0, y0, x1, y1, ramp, group) -> None:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.set(x, y, ramp, group)

    def capsule(self, a, b, radius, ramp, group) -> None:
        """Thick line from a to b with round ends."""
        ax, ay = a
        bx, by = b
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy or 1
        for y in range(CELL):
            for x in range(CELL):
                px, py = x + 0.5, y + 0.5
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
                cx, cy = ax + dx * t, ay + dy * t
                if (px - cx) ** 2 + (py - cy) ** 2 <= radius * radius:
                    self.set(x, y, ramp, group)

    def ellipse(self, cx, cy, rx, ry, ramp, group) -> None:
        for y in range(CELL):
            for x in range(CELL):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1.0:
                    self.set(x, y, ramp, group)

    def grid(self, ox: int, oy: int, rows: list[str], ramp: str, group: str) -> None:
        """ASCII mask: '#' mid, 'h' forced light, 'd' forced dark, '.' empty."""
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch == ".":
                    continue
                self.set(ox + i, oy + j, ramp, group)
                if ch == "h":
                    self.color[oy + j][ox + i] = ("force", 3)
                elif ch == "d":
                    self.color[oy + j][ox + i] = ("force", 1)

    def render(self) -> Image.Image:
        img = Image.new("RGBA", (CELL, CELL), TRANSPARENT)
        px = img.load()
        get = lambda x, y: self.part[y][x] if 0 <= x < CELL and 0 <= y < CELL else None  # noqa: E731
        for y in range(CELL):
            for x in range(CELL):
                me = get(x, y)
                if me is None:
                    continue
                ramp, group, z = me
                override = self.color[y][x]
                if override is not None and override[0] != "force":
                    px[x, y] = override
                    continue

                def edge(n) -> bool:
                    return n is None or (n[1] != group and n[2] < z)

                def other(n) -> bool:
                    return n is None or n[1] != group

                nbrs = [get(x - 1, y), get(x + 1, y), get(x, y - 1), get(x, y + 1)]
                if any(edge(n) for n in nbrs):
                    shade = 0
                elif override is not None:
                    shade = override[1]
                elif other(get(x + 1, y)) or other(get(x, y + 1)):
                    shade = 1
                elif other(get(x - 1, y)) or other(get(x, y - 1)):
                    shade = 3
                else:
                    shade = 2
                px[x, y] = RAMPS[ramp][shade] + (255,)
        return img


# ---------------------------------------------------------------------- body
def draw_body(c: Cell, column: int, view: int, pose: dict) -> None:
    hx, hy = pose["head"]
    ox, oy = hx - 24, hy - 14  # the torso follows the head (lean, hit, fall)
    hip_y = 33 + oy

    # Legs: pants down to the shin, boot at the foot. Back leg first.
    feet = sorted([("l", pose["lf"]), ("r", pose["rf"])], key=lambda f: 0 if view == 1 and f[0] == "r" else 1)
    for side, foot in feet:
        hip_x = (24 if view == 1 else (21 if side == "l" else 27)) + ox
        if view == 2:
            hip_x = 48 - hip_x
        fx, fy = foot
        knee = (hip_x + (fx - hip_x) * 0.55, hip_y + (fy - hip_y) * 0.55)
        c.capsule((hip_x, hip_y), knee, 2.3, "pants", f"leg_{side}")
        c.capsule(knee, (fx, fy - 2), 2.1, "pants", f"leg_{side}")
        # Boot: toe points to the viewer (front/back) or to the right (side).
        bx0, bx1 = (fx - 3, fx + 3) if view == 1 else (fx - 3, fx + 2)
        c.rect(bx0, fy - 4, bx1, fy, "boot", f"leg_{side}")
        if view == 1:
            c.rect(bx1 - 2, fy - 5, bx1 - 1, fy - 5, "boot", f"leg_{side}")
        c.next()

    # Torso: short tunic with belt.
    if view == 1:
        rows = [
            "..######.",
            ".########",
            ".########",
            ".########",
            ".########",
            ".#######.",
            ".#######.",
            ".#######.",
            "#########",
            "#########",
            "#########",
            "#########",
        ]
        c.grid(20 + ox, 21 + oy, rows, "shirt", "torso")
        c.rect(20 + ox, 30 + oy, 28 + ox, 31 + oy, "belt", "torso")
        c.dot(27 + ox, 31 + oy, BUCKLE)
    else:
        rows = [
            "...#########...",
            "..###########..",
            ".#############.",
            ".#############.",
            ".#############.",
            "..###########..",
            "..###########..",
            "..###########..",
            "..###########..",
            ".#############.",
            ".#############.",
            ".#############.",
            "..###########..",
        ]
        c.grid(17 + ox, 21 + oy, rows, "shirt", "torso")
        c.rect(18 + ox, 30 + oy, 30 + ox, 31 + oy, "belt", "torso")
        if view == 0:
            c.dot(24 + ox, 30 + oy, BUCKLE)
            c.dot(24 + ox, 31 + oy, BUCKLE)
            # Collar: a little V of skin under the chin.
            for i, w in enumerate((2, 1)):
                for x in range(24 - w, 24 + w):
                    c.set(x + ox, 21 + oy + i, "skin", "torso")
    c.next()

    # Arms: sleeve at the shoulder, skin forearm, round fist.
    arms = [("l", (18 + ox, 24 + oy), pose["lh"])]
    if view != 1:
        arms.append(("r", (30 + ox, 24 + oy), pose["rh"]))
    if view == 1:
        arms = [("l", (24 + ox, 24 + oy), pose["lh"])]
    if view == 2:
        arms = [(s, (48 - sh[0], sh[1]), h) for s, sh, h in arms]
    for side, shoulder, hand in arms:
        sx, sy = shoulder
        hx2, hy2 = hand
        elbow = (sx + (hx2 - sx) * 0.45, sy + (hy2 - sy) * 0.45)
        c.capsule(shoulder, elbow, 2.2, "shirt", f"arm_{side}")
        c.capsule(elbow, hand, 1.8, "skin", f"arm_{side}")
        c.ellipse(hx2, hy2, 2.3, 2.3, "skin", f"arm_{side}")
        c.next()


# ---------------------------------------------------------------------- head
def draw_head(c: Cell, column: int, view: int, pose: dict) -> None:
    hx, hy = pose["head"]
    c.ellipse(hx, hy + 0.5, 8.2, 7.6, "skin", "head")
    if view == 1:
        # Cheek bulge toward the facing side, ear in the middle.
        c.ellipse(hx + 3, hy + 3, 4.6, 3.6, "skin", "head")
    c.next()

    if view == 0:
        eyes = ((hx - 5, hy + 1), (hx + 3, hy + 1))
    elif view == 1:
        eyes = ((hx + 4, hy + 1),)
    else:
        return

    for ex, ey in eyes:
        if column == 8:  # dead: closed eyes
            for x in range(ex, ex + 2):
                c.dot(x, ey + 2, EYE)
        elif column == 7:  # hit: squeezed shut
            c.dot(ex, ey + 1, EYE)
            c.dot(ex + 1, ey + 2, EYE)
            c.dot(ex, ey + 3 - 0, EYE)
        else:
            c.dot(ex, ey, EYE)
            c.dot(ex + 1, ey, EYE)
            c.dot(ex, ey + 1, GLINT)
            c.dot(ex + 1, ey + 1, IRIS)
            c.dot(ex, ey + 2, EYE)
            c.dot(ex + 1, ey + 2, IRIS)

    if view == 0:
        c.dot(hx - 6, hy + 4, BLUSH)
        c.dot(hx + 5, hy + 4, BLUSH)
        mouth = [(hx - 1, hy + 5)] if column != 7 else [(hx - 1, hy + 5), (hx, hy + 5)]
        for m in mouth:
            c.dot(*m, MOUTH)
    else:
        c.dot(hx + 6, hy + 4, BLUSH)
        c.dot(hx + 6, hy + 6, MOUTH)
        # Ear.
        c.dot(hx - 1, hy + 1, RAMPS["skin"][1] + (255,))
        c.dot(hx - 1, hy + 2, RAMPS["skin"][1] + (255,))


# ---------------------------------------------------------------------- hair
# Grids start at (hx - 9, hy - 9); the head spans columns 1..16, rows 2..16.
HAIR = {
    ("short", 0): [
        ".....########.....",
        "...############...",
        "..###hhh#######...",
        ".###hhh#########..",
        ".##hh############.",
        ".################.",
        ".################.",
        ".################.",
        ".####.###.##.####.",
        ".###...#.....#.##.",
        ".##.............#.",
        ".##.............#.",
        ".#...............",
    ],
    ("short", 1): [
        "....########......",
        "..############....",
        ".####hhhh######...",
        ".###hhh#########..",
        ".################.",
        ".################.",
        ".################.",
        ".################.",
        ".###########.###..",
        ".########.....#...",
        ".######...........",
        ".#####............",
        "..###.............",
    ],
    ("short", 2): [
        ".....########.....",
        "...############...",
        "..###hhh#######...",
        ".###hhh#########..",
        ".##hh############.",
        ".################.",
        ".################.",
        ".################.",
        ".################.",
        ".################.",
        ".################.",
        "..##############..",
        "..#############...",
        "...###########....",
        ".....#.##.#.......",
    ],
    ("long", 0): [
        ".....########.....",
        "...############...",
        "..###hhh#######...",
        ".###hhh#########..",
        ".##hh############.",
        "##################",
        "##################",
        "##################",
        "#####.###.##.#####",
        "####...#.....#.###",
        "###............###",
        "###............###",
        "###............###",
        "###............###",
        "###............###",
        "####..........####",
        "####..........####",
        ".###..........###.",
        ".##............##.",
        ".#..............#.",
    ],
    ("long", 1): [
        "....########......",
        "..############....",
        ".####hhhh######...",
        ".###hhh#########..",
        "#################.",
        "#################.",
        "#################.",
        "#################.",
        "############.###..",
        "#########.....#...",
        "#######...........",
        "#######...........",
        "#######...........",
        "#######...........",
        "#######...........",
        "######............",
        "######............",
        ".#####............",
        ".####.............",
        "..##..............",
    ],
    ("long", 2): [
        ".....########.....",
        "...############...",
        "..###hhh#######...",
        ".###hhh#########..",
        ".##hh############.",
        "##################",
        "##################",
        "##################",
        "##################",
        "##################",
        "##################",
        "##################",
        "##################",
        "##################",
        ".################.",
        ".################.",
        ".################.",
        "..##############..",
        "..###.######.###..",
        "...#...####...#...",
    ],
}


def draw_hair(c: Cell, column: int, view: int, pose: dict, style: str) -> None:
    hx, hy = pose["head"]
    c.grid(hx - 9, hy - 9, HAIR[(style, view)], "hair", "hair")
    c.next()


# -------------------------------------------------------------------- sheets
def build(draw) -> Image.Image:
    sheet = Image.new("RGBA", (CELL * COLS, CELL * ROWS), TRANSPARENT)
    for view in range(ROWS):
        for column in range(COLS):
            cell = Cell()
            draw(cell, column, view, joints(column, view))
            sheet.alpha_composite(cell.render(), (column * CELL, view * CELL))
    return sheet


def main() -> None:
    sheets = {
        "body/default.png": build(draw_body),
        "head/default.png": build(draw_head),
        "hair/short.png": build(lambda c, col, v, p: draw_hair(c, col, v, p, "short")),
        "hair/long.png": build(lambda c, col, v, p: draw_hair(c, col, v, p, "long")),
    }
    for name, img in sheets.items():
        (OUT / name).parent.mkdir(parents=True, exist_ok=True)
        img.save(OUT / name)
        print(f"wrote {OUT / name}")

    if "--preview" in sys.argv:
        preview(sheets)


def preview(sheets: dict) -> None:
    """Stacks the layers (with the sword) on grass, 4x, short and long hair."""
    weapon_file = OUT / "weapon" / "schwert_00.png"
    weapon = Image.open(weapon_file).convert("RGBA") if weapon_file.exists() else None
    out = Image.new("RGBA", (CELL * COLS, CELL * ROWS * 2), (86, 128, 74, 255))
    for k, hair in enumerate(("hair/short.png", "hair/long.png")):
        y0 = k * CELL * ROWS
        stack = Image.new("RGBA", (CELL * COLS, CELL * ROWS), TRANSPARENT)
        if weapon is not None:
            stack.alpha_composite(weapon.crop((0, 0, CELL * COLS, CELL * ROWS)))
        for layer in ("body/default.png", "head/default.png", hair):
            stack.alpha_composite(sheets[layer])
        if weapon is not None:
            stack.alpha_composite(weapon.crop((0, CELL * ROWS, CELL * COLS, CELL * ROWS * 2)))
        out.alpha_composite(stack, (0, y0))
    out = out.resize((out.width * 4, out.height * 4), Image.NEAREST)
    target = Path(os.environ.get("PREVIEW_OUT", ROOT / "pixel-preview.png"))
    out.save(target)
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
