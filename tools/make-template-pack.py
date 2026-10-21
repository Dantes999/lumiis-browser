#!/usr/bin/env python3
"""Draws the modular placeholder pixel-art pack under assets/styles/pixel.

Every layer is its own PNG sheet with the same grid, so they align when the
game stacks them (weapon back, body, armour, head, hair, weapon front):

    cell 48x48, 9 columns, 3 rows (down, right, up)
    sheet = 432 x 144 px per layer (weapon: 432 x 288, back rows on top)

The figures are deliberately simple: they are the template the artist draws
over. Replace one file, the game picks it up.

    python3 tools/make-template-pack.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "packages" / "client" / "public" / "assets" / "styles" / "pixel"

CELL = 48
COLS = 9
ROWS = 3
WEAPON_ROWS = 6

SKIN = (232, 185, 138, 255)
SKIN_DARK = (200, 150, 110, 255)
HAIR = (40, 34, 32, 255)
HAIR_LIGHT = (66, 56, 52, 255)
TUNIC = (122, 82, 62, 255)
TUNIC_LIGHT = (150, 104, 78, 255)
PANTS = (62, 74, 98, 255)
BOOT = (70, 48, 34, 255)
EYE = (28, 26, 30, 255)
MOUTH = (150, 90, 80, 255)
STEEL = (196, 204, 214, 255)
STEEL_DARK = (140, 150, 162, 255)
GOLD = (212, 168, 72, 255)

ARMOR_COLORS = {
    "01_moenchsplattenpanzer": (110, 122, 136, 255),
    "02_eisenplattenpanzer": (150, 160, 172, 255),
    "03_tiger_plattenpanzer": (176, 92, 58, 255),
    "04_loewenplattenpanzer": (198, 162, 74, 255),
}


def joints(column: int, view: int) -> dict:
    """Shared skeleton of one pose; every layer draws from these points."""
    # Weapon hand is the character's left (screen left in the front view).
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
        # Side view: one arm and a narrower body, hand slightly to the side.
        pose["lh"] = (24 + (pose["lh"][0] - 24) * 0.25, pose["lh"][1])
        pose["lf"] = (22, 44)
        pose["rf"] = (27, 44)
    elif view == 2:
        # Back view: mirror the hands and feet.
        pose["lh"], pose["rh"] = (48 - pose["lh"][0], pose["lh"][1]), (48 - pose["rh"][0], pose["rh"][1])
        pose["lf"], pose["rf"] = (48 - pose["lf"][0], pose["lf"][1]), (48 - pose["rf"][0], pose["rf"][1])

    return pose


def fill(draw, points, color):
    draw.polygon(points, fill=color)


def limb(draw: ImageDraw.ImageDraw, a, b, width, color):
    draw.line([a, b], fill=color, width=width)
    draw.ellipse([b[0] - width // 2, b[1] - width // 2, b[0] + width // 2, b[1] + width // 2], fill=color)


def draw_body(draw, pose, view):
    hx, hy = pose["head"]
    hip_l, hip_r = (20, 32), (28, 32)
    sh_l, sh_r = (18, 23), (30, 23)
    if view == 1:
        sh_l = sh_r = (24, 23)
        hip_l = hip_r = (24, 32)

    # Legs and boots.
    limb(draw, (21, 32), pose["lf"], 5, PANTS)
    limb(draw, (27, 32), pose["rf"], 5, PANTS)
    for foot in (pose["lf"], pose["rf"]):
        draw.rectangle([foot[0] - 3, foot[1] - 3, foot[0] + 3, foot[1] + 1], fill=BOOT)

    # Torso.
    if view == 1:
        draw.rectangle([21, 22, 27, 33], fill=TUNIC)
        draw.rectangle([21, 31, 27, 33], fill=PANTS)
    else:
        fill(draw, [(sh_l[0] - 2, sh_l[1]), (sh_r[0] + 2, sh_r[1]), (hip_r[0] + 1, 33), (hip_l[0] - 1, 33)], TUNIC)
        draw.rectangle([hip_l[0] - 1, 31, hip_r[0] + 1, 33], fill=TUNIC_LIGHT)

    # Neck.
    draw.rectangle([hx - 2, hy + 5, hx + 2, hy + 8], fill=SKIN_DARK)

    # Arms.
    if view == 1:
        limb(draw, sh_l, pose["lh"], 4, SKIN)
    else:
        limb(draw, sh_l, pose["lh"], 4, SKIN)
        limb(draw, sh_r, pose["rh"], 4, SKIN)


def draw_head(draw, pose, view):
    hx, hy = pose["head"]
    draw.ellipse([hx - 7, hy - 7, hx + 7, hy + 7], fill=SKIN)
    if view == 0:
        draw.ellipse([hx - 4, hy - 1, hx - 2, hy + 1], fill=EYE)
        draw.ellipse([hx + 2, hy - 1, hx + 4, hy + 1], fill=EYE)
        draw.line([hx - 1, hy + 4, hx + 1, hy + 4], fill=MOUTH, width=1)
    elif view == 1:
        draw.ellipse([hx + 1, hy - 1, hx + 3, hy + 1], fill=EYE)
        draw.line([hx + 2, hy + 4, hx + 4, hy + 4], fill=MOUTH, width=1)
        draw.rectangle([hx + 6, hy - 1, hx + 7, hy + 2], fill=SKIN_DARK)


def draw_hair(draw, pose, view, long_hair: bool):
    hx, hy = pose["head"]
    draw.chord([hx - 8, hy - 9, hx + 8, hy + 6], 180, 360, fill=HAIR)
    if long_hair:
        if view == 2:
            draw.rectangle([hx - 7, hy - 2, hx + 7, hy + 11], fill=HAIR)
        else:
            draw.rectangle([hx - 8, hy - 2, hx - 5, hy + 9], fill=HAIR)
            draw.rectangle([hx + 5, hy - 2, hx + 8, hy + 9], fill=HAIR)
    else:
        draw.rectangle([hx - 8, hy - 3, hx - 6, hy + 2], fill=HAIR_LIGHT)
        draw.rectangle([hx + 6, hy - 3, hx + 8, hy + 2], fill=HAIR_LIGHT)


def draw_armor(draw, pose, view, color):
    sh_l, sh_r = (18, 23), (30, 23)
    if view == 1:
        draw.rectangle([20, 21, 28, 33], fill=color)
        draw.ellipse([21, 19, 28, 26], fill=color)
    else:
        fill(draw, [(sh_l[0] - 3, sh_l[1] - 1), (sh_r[0] + 3, sh_r[1] - 1), (29, 33), (19, 33)], color)
        draw.ellipse([sh_l[0] - 5, sh_l[1] - 4, sh_l[0] + 4, sh_l[1] + 5], fill=color)
        draw.ellipse([sh_r[0] - 4, sh_r[1] - 4, sh_r[0] + 5, sh_r[1] + 5], fill=color)
        draw.rectangle([20, 31, 28, 32], fill=GOLD)


def draw_weapon(draw, pose, column: int, long_blade: bool):
    hx, hy = pose["lh"]
    # Blade direction per column: up/out in the wind-up, across in the strike.
    angles = {0: -75, 1: -70, 2: -70, 3: -75, 4: -40, 5: 35, 6: 10, 7: -60, 8: -70}
    angle = math.radians(angles[column])
    length = 20 if not long_blade else 26
    tip = (hx + math.cos(angle) * length, hy + math.sin(angle) * length)
    guard = (hx + math.cos(angle) * 3, hy + math.sin(angle) * 3)
    # Grip and guard.
    draw.line([(hx - math.cos(angle) * 3, hy - math.sin(angle) * 3), guard], fill=BOOT, width=2)
    draw.line(
        [
            (guard[0] - math.sin(angle) * 4, guard[1] + math.cos(angle) * 4),
            (guard[0] + math.sin(angle) * 4, guard[1] - math.cos(angle) * 4),
        ],
        fill=GOLD,
        width=2,
    )
    draw.line([guard, tip], fill=STEEL, width=3 if long_blade else 2)
    draw.line([guard, tip], fill=STEEL_DARK, width=1)


def sheet(rows: int) -> Image.Image:
    return Image.new("RGBA", (CELL * COLS, CELL * rows), (0, 0, 0, 0))


def main() -> None:
    for folder in ("body", "head", "hair", "armor", "weapon"):
        (OUT / folder).mkdir(parents=True, exist_ok=True)

    # Body, head, hairs.
    body = sheet(ROWS)
    head = sheet(ROWS)
    hairs = {name: sheet(ROWS) for name in ("short", "long")}

    for view in range(ROWS):
        for column in range(COLS):
            pose = joints(column, view)
            x, y = column * CELL, view * CELL
            cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
            draw = ImageDraw.Draw(cell)
            draw_body(draw, pose, view)
            body.alpha_composite(cell, (x, y))

            cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
            draw = ImageDraw.Draw(cell)
            draw_head(draw, pose, view)
            head.alpha_composite(cell, (x, y))

            for name, long_hair in (("short", False), ("long", True)):
                cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
                draw = ImageDraw.Draw(cell)
                draw_hair(draw, pose, view, long_hair)
                hairs[name].alpha_composite(cell, (x, y))

    body.save(OUT / "body" / "default.png")
    head.save(OUT / "head" / "default.png")
    hair_short = hairs["short"]
    hair_long = hairs["long"]
    hair_short.save(OUT / "hair" / "short.png")
    hair_long.save(OUT / "hair" / "long.png")

    # Armours: one transparent overlay per item.
    for file, color in ARMOR_COLORS.items():
        armor = sheet(ROWS)
        for view in range(ROWS):
            for column in range(COLS):
                pose = joints(column, view)
                cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
                draw_armor(ImageDraw.Draw(cell), pose, view, color)
                armor.alpha_composite(cell, (column * CELL, view * CELL))
        armor.save(OUT / "armor" / f"{file}.png")

    # Weapons: back rows transparent, front rows hold the blade.
    for art, stage, long_blade in (
        ("schwert", 0, False),
        ("schwert", 2, False),
        ("schwert", 3, False),
        ("schwert", 4, False),
        ("schwert", 5, False),
        ("schwert", 6, False),
        ("zweihand", 3, True),
    ):
        weapon = sheet(WEAPON_ROWS)
        for view in range(ROWS):
            for column in range(COLS):
                pose = joints(column, view)
                cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
                draw_weapon(ImageDraw.Draw(cell), pose, column, long_blade)
                weapon.alpha_composite(cell, (column * CELL, (view + ROWS) * CELL))
        weapon.save(OUT / "weapon" / f"{art}_{stage:02d}.png")

    rows = {
        "armor": ["koerper/faust/unten", "koerper/faust/rechts", "koerper/faust/oben"],
        "head": ["kopf/unten", "kopf/rechts", "kopf/oben"],
        "hair": ["oben/unten", "oben/rechts", "oben/oben"],
        "weapon": [
            "hinten/unten",
            "hinten/rechts",
            "hinten/oben",
            "vorne/unten",
            "vorne/rechts",
            "vorne/oben",
        ],
    }
    (OUT / "rows.json").write_text(json.dumps(rows, indent=2), encoding="utf8")

    print(f"wrote {OUT}")
    print("layers: body/default, head/default, hair/short, hair/long,")
    print("        armor/<4 files>, weapon/<7 files>, rows.json")


if __name__ == "__main__":
    main()
