#!/usr/bin/env python3
"""Composes rendered frames into a style pack.

The render script writes one PNG per view and column (v0_c0.png … v2_c8.png).
This tool downsamples them to the cell size, lays them out as a sheet with one
row per view, and writes the pack files plus rows.json and the styles.json
entry.

    python3 tools/assemble-3d-pack.py --frames build/demo3d --id demo3d --cell 48
"""

import argparse
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames", required=True, help="folder with v<view>_c<column>.png")
    parser.add_argument("--id", required=True)
    parser.add_argument("--cell", type=int, default=48)
    parser.add_argument("--columns", type=int, default=9)
    parser.add_argument("--out", help="default: packages/client/public/assets/styles/<id>")
    args = parser.parse_args()

    frames = Path(args.frames)
    out = Path(args.out) if args.out else ROOT / "packages" / "client" / "public" / "assets" / "styles" / args.id
    out.mkdir(parents=True, exist_ok=True)

    cell = args.cell
    columns = args.columns

    def frame(view: int, column: int) -> Image.Image:
        path = frames / f"v{view}_c{column}.png"
        if not path.exists():
            raise SystemExit(f"missing frame {path}")
        return Image.open(path).convert("RGBA").resize((cell, cell), Image.LANCZOS)

    # Three views as three rows; downscaling at the end keeps the edges clean.
    sheet = Image.new("RGBA", (cell * columns, cell * 3), (0, 0, 0, 0))
    for view in range(3):
        for column in range(columns):
            sheet.alpha_composite(frame(view, column), (column * cell, view * cell))

    sheet.save(out / "body.png")
    sheet.save(out / "armor.png")

    empty_views = Image.new("RGBA", (cell * columns, cell * 3), (0, 0, 0, 0))
    empty_views.save(out / "head.png")
    empty_views.save(out / "hair.png")
    Image.new("RGBA", (cell * columns, cell * 6), (0, 0, 0, 0)).save(out / "weapon.png")

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
    (out / "rows.json").write_text(json.dumps(rows, indent=2), encoding="utf8")

    base = f"/assets/styles/{args.id}"
    print(f"wrote {out}")
    print("\nadd this to packages/client/src/styles.json:\n")
    print(
        json.dumps(
            {
                args.id: {
                    "name": f"{args.id} (3D-Render)",
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
                    "bodyArt": "faust",
                }
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
