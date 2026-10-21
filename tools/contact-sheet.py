#!/usr/bin/env python3
"""Writes contact sheets for the pixel layers: grid, numbers, anchor cross.

    python3 tools/contact-sheet.py                  # every sheet + one strip per body
    python3 tools/contact-sheet.py --only body      # only the bodies
    python3 tools/contact-sheet.py --only strip     # only the stacked strips
    python3 tools/contact-sheet.py --scale 6        # bigger (default 4)

Output goes to build/contact/. A layer sheet shows its own cells with the
checkerboard, column numbers, the ground line and the anchor cross at
(footX, footY); a strip stacks body, head, hair, armour and weapon for one body
so the whole walk/attack animation can be judged at a glance.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "packages" / "client" / "public" / "assets"
STYLES = ROOT / "packages" / "client" / "src" / "styles.json"
OUT = ROOT / "build" / "contact"

VIEW_NAMES = ("unten", "rechts", "oben")

BG_A = (27, 36, 48, 255)
BG_B = (34, 45, 57, 255)
GRID = (58, 74, 90, 255)
ANCHOR = (224, 90, 90, 255)
LABEL = (159, 179, 200, 255)
TITLE = (216, 180, 90, 255)


def checker(size: tuple[int, int], square: int = 8) -> Image.Image:
    """Dark checkerboard so transparent pixels are recognisable."""
    image = Image.new("RGBA", size, BG_A)
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], square):
        for x in range(0, size[0], square):
            if (x // square + y // square) % 2 == 0:
                draw.rectangle([x, y, x + square - 1, y + square - 1], fill=BG_B)
    return image


def load_pack() -> dict:
    styles = json.loads(STYLES.read_text(encoding="utf8"))
    return styles["packs"][styles["default"]]


def sheet_files(pack: dict) -> list[tuple[str, str, Path]]:
    """(kind, id, file) for every layer the game loads."""
    entries: list[tuple[str, str, Path]] = []
    for part in pack["bodies"]:
        entries.append(("body", part["id"], ASSETS / "body" / f"{part['id']}.png"))
    for part in pack["heads"]:
        entries.append(("head", part["id"], ASSETS / "head" / f"{part['id']}.png"))
    for part in pack["hairs"]:
        entries.append(("hair", part["id"], ASSETS / "hair" / f"{part['id']}.png"))
    for path in sorted((ASSETS / "armor").glob("*.png")):
        entries.append(("armor", path.stem, path))
    for path in sorted((ASSETS / "weapon").glob("*.png")):
        entries.append(("weapon", path.stem, path))
    return entries


def draw_sheet(kind: str, ident: str, path: Path, pack: dict, scale: int) -> Image.Image:
    cell = pack["cell"]
    columns = pack["columns"]
    sheet = Image.open(path).convert("RGBA")
    rows = sheet.height // cell
    left, top = 112, 30
    width = left + columns * cell * scale + 8
    height = top + rows * cell * scale + 8
    canvas = checker((width, height), 16)
    draw = ImageDraw.Draw(canvas)

    draw.text((8, 6), f"{kind}/{ident}", fill=TITLE)
    draw.text((8, 18), f"{sheet.width}x{sheet.height}, {rows} Zeilen", fill=LABEL)

    for column in range(columns):
        x = left + column * cell * scale
        draw.text((x + 2, 10), str(column), fill=LABEL)

    for row in range(rows):
        if kind == "weapon":
            half = rows // 2
            label = f"{'hinten' if row < half else 'vorne'}/" + (
                VIEW_NAMES[row % half] if row % half < len(VIEW_NAMES) else f"Zeile {row}"
            )
        else:
            label = VIEW_NAMES[row] if row < len(VIEW_NAMES) else f"Zeile {row}"
        y = top + row * cell * scale
        draw.text((8, y + 4), label, fill=LABEL)
        for column in range(columns):
            x = left + column * cell * scale
            cell_image = sheet.crop((column * cell, row * cell, (column + 1) * cell, (row + 1) * cell))
            canvas.alpha_composite(cell_image.resize((cell * scale, cell * scale), Image.NEAREST), (x, y))
            draw.rectangle([x, y, x + cell * scale - 1, y + cell * scale - 1], outline=GRID)

    # Ground line and anchor cross, so a floating figure is obvious.
    for row in range(rows):
        y = top + row * cell * scale + pack["footY"] * scale
        draw.line([left, y, left + columns * cell * scale, y], fill=(80, 110, 90, 255))
        for column in range(columns):
            x = left + column * cell * scale + pack["footX"] * scale
            draw.line([x - 6, y, x + 6, y], fill=ANCHOR)
            draw.line([x, y - 6, x, y + 6], fill=ANCHOR)

    return canvas


def layer_for(path: Path, view: int, column: int, cell: int, front: bool = False) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    rows = image.height // cell
    row = view + (rows // 2 if front and rows > len(VIEW_NAMES) else 0)
    return image.crop((column * cell, row * cell, (column + 1) * cell, (row + 1) * cell))


def draw_strip(body_id: str, pack: dict, scale: int) -> Image.Image | None:
    cell = pack["cell"]
    columns = pack["columns"]
    layers = [
        ASSETS / "body" / f"{body_id}.png",
        ASSETS / "armor" / "02_eisenplattenpanzer.png",
        ASSETS / "head" / f"{body_id}.png",
        ASSETS / "hair" / f"{body_id}_1.png",
    ]
    missing = [path for path in layers if not path.exists()]
    if missing:
        print(f"strip {body_id}: missing {', '.join(path.name for path in missing)}")
        return None

    weapon = ASSETS / "weapon" / "schwert_02.png"
    armor = layers[1]

    left, top = 112, 30
    width = left + columns * cell * scale + 8
    height = top + len(VIEW_NAMES) * cell * scale + 8
    canvas = checker((width, height), 16)
    draw = ImageDraw.Draw(canvas)
    draw.text((8, 6), f"{body_id} + Rüstung 02 + Waffe 02", fill=TITLE)
    draw.text((8, 18), "Körper · Rüstung · Kopf · Haare · Waffe", fill=LABEL)
    for column in range(columns):
        draw.text((left + column * cell * scale + 2, 10), str(column), fill=LABEL)

    for view, name in enumerate(VIEW_NAMES):
        y = top + view * cell * scale
        draw.text((8, y + 4), name, fill=LABEL)
        for column in range(columns):
            x = left + column * cell * scale
            cell_canvas = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
            if weapon.exists():
                cell_canvas.alpha_composite(layer_for(weapon, view, column, cell, front=False))
            cell_canvas.alpha_composite(layer_for(layers[0], view, column, cell))
            cell_canvas.alpha_composite(layer_for(armor, view, column, cell))
            cell_canvas.alpha_composite(layer_for(layers[2], view, column, cell))
            cell_canvas.alpha_composite(layer_for(layers[3], view, column, cell))
            if weapon.exists():
                cell_canvas.alpha_composite(layer_for(weapon, view, column, cell, front=True))
            canvas.alpha_composite(cell_canvas.resize((cell * scale, cell * scale), Image.NEAREST), (x, y))
            draw.rectangle([x, y, x + cell * scale - 1, y + cell * scale - 1], outline=GRID)

    for view in range(len(VIEW_NAMES)):
        y = top + view * cell * scale + pack["footY"] * scale
        draw.line([left, y, left + columns * cell * scale, y], fill=(80, 110, 90, 255))
        for column in range(columns):
            x = left + column * cell * scale + pack["footX"] * scale
            draw.line([x - 6, y, x + 6, y], fill=ANCHOR)
            draw.line([x, y - 6, x, y + 6], fill=ANCHOR)

    return canvas


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=["body", "head", "hair", "armor", "weapon", "strip"], help="one kind only")
    parser.add_argument("--scale", type=int, default=4, help="pixel scale (default 4)")
    args = parser.parse_args()

    pack = load_pack()
    OUT.mkdir(parents=True, exist_ok=True)
    written = 0

    if args.only != "strip":
        for kind, ident, path in sheet_files(pack):
            if args.only is not None and kind != args.only:
                continue
            if not path.exists():
                print(f"skip {kind}/{ident}: {path.name} fehlt")
                continue
            image = draw_sheet(kind, ident, path, pack, args.scale)
            target = OUT / f"{kind}-{ident}.png"
            image.save(target)
            written += 1

    if args.only is None or args.only == "strip":
        for part in pack["bodies"]:
            image = draw_strip(part["id"], pack, args.scale)
            if image is not None:
                image.save(OUT / f"strip-{part['id']}.png")
                written += 1

    print(f"{written} Kontaktbogen in {OUT}")


if __name__ == "__main__":
    main()
