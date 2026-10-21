#!/usr/bin/env python3
"""Turns two static character images (front, back) into a style pack.

The frames are all the same picture: this is a *placeholder* pack, so a freshly
generated illustration can be judged inside the game before it is animated.

    python3 tools/make-style-pack.py \
        --front ~/Downloads/images/chars/warrior/1/front.jpeg \
        --back  ~/Downloads/images/chars/warrior/1/back.jpeg \
        --id gemini_warrior

It removes the near-white background, crops to the figure, scales it into a
48 px cell (feet at 24/44) and writes body/armor/head/hair/weapon sheets plus
rows.json under packages/client/public/assets/styles/<id>/.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT_ROOT = ROOT / "packages" / "client" / "public" / "assets" / "styles"


def cut_white(path: Path) -> Image.Image:
    """Loads an image and makes the near-white background transparent."""
    image = Image.open(path).convert("RGBA")
    data = np.array(image)
    white = (data[:, :, 0] >= 238) & (data[:, :, 1] >= 238) & (data[:, :, 2] >= 238)
    data[white, 3] = 0
    image = Image.fromarray(data)
    box = image.getbbox()
    if box is None:
        raise SystemExit(f"{path} is completely white")
    return image.crop(box)


def into_cell(image: Image.Image, cell: int, foot: int) -> Image.Image:
    """Scales the figure to fit a cell, feet at `foot`."""
    width, height = image.size
    scale = min((cell - 2) / width, (foot - 2) / height)
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    small = image.resize(size, Image.LANCZOS)

    out = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
    out.alpha_composite(small, ((cell - size[0]) // 2, foot - size[1]))
    return out


def sheet(rows: list[Image.Image], cell: int, columns: int) -> Image.Image:
    out = Image.new("RGBA", (cell * columns, cell * len(rows)), (0, 0, 0, 0))
    for index, image in enumerate(rows):
        for column in range(columns):
            out.alpha_composite(image, (column * cell, index * cell))
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--front", required=True)
    parser.add_argument("--back")
    parser.add_argument("--id", required=True)
    parser.add_argument("--cell", type=int, default=48)
    parser.add_argument("--columns", type=int, default=9)
    args = parser.parse_args()

    folder = OUT_ROOT / args.id
    folder.mkdir(parents=True, exist_ok=True)

    cell, columns = args.cell, args.columns
    front = into_cell(cut_white(Path(args.front)), cell, 44)
    back = into_cell(cut_white(Path(args.back)), cell, 44) if args.back else front

    # Rows: down, right, up. The right view reuses the front (a static pack has
    # no side); the up view uses the back image.
    body = sheet([front, front, back], cell, columns)
    body.save(folder / "body.png")
    body.save(folder / "armor.png")

    empty3 = Image.new("RGBA", (cell * columns, cell * 3), (0, 0, 0, 0))
    empty3.save(folder / "head.png")
    empty3.save(folder / "hair.png")
    Image.new("RGBA", (cell * columns, cell * 6), (0, 0, 0, 0)).save(folder / "weapon.png")

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
    (folder / "rows.json").write_text(json.dumps(rows, indent=2), encoding="utf8")

    base = f"/assets/styles/{args.id}"
    print(f"wrote {folder}")
    print("\nadd this to packages/client/src/styles.json:\n")
    print(
        json.dumps(
            {
                args.id: {
                    "name": f"{args.id} (statisch)",
                    "cell": cell,
                    "columns": columns,
                    "footX": 24,
                    "footY": 44,
                    "body": f"{base}/body.png",
                    "head": f"{base}/head.png",
                    "hair": f"{base}/hair.png",
                    "armor": f"{base}/armor.png",
                    "weapon": f"{base}/weapon.png",
                    "armorRows": "any",
                    "rows": f"{base}/rows.json",
                }
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
