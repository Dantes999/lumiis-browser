# Grafik: modulare Pixelart

Jede Figur besteht aus **getrennten PNG-Ebenen**, die im Spiel übereinander
gelegt werden. Du zeichnest in Paint/Aseprite eine Ebene, legst sie ab, fertig.

```
packages/client/public/assets/
  body/     warrior_m.png …      ← Körper ohne Rüstung, ohne Haare
  head/     warrior_m.png …      ← Kopf/Gesicht, ohne Haare
  hair/     warrior_m_1.png …    ← Haare/Helm
  armor/    01_… 02_… 03_… 04_…  ← nur die Rüstungsteile (sonst transparent)
  weapon/   schwert_00.png …     ← nur die Waffe
  monster/  boar.png …           ← Monster (40 × 32, 4 Ansichten × 5 Bilder)
  icons/                         ← Gegenstands-Symbole
  rows.json                      ← Zeilen-Zuordnung (nicht ändern)
```

## Das Raster (verbindlich)

| | |
|---|---|
| Kachel | **48 × 48 px** |
| Spalten | **9** (siehe unten) |
| Zeilen | **3** Ansichten: 0 unten, 1 rechts, 2 oben (hinten) |
| Blattgröße | **432 × 144 px** (Körper/Kopf/Haare/Rüstung) |
| Waffe | **432 × 288 px** (6 Zeilen: oben 3 leere „hinten", unten 3 „vorne") |
| Anker | **Füße bei (24, 44)** in **jeder** Kachel |
| Figur | etwa 40 px hoch, Kopf ca. y 7–21 |

**Alle Ebenen benutzen dieselben Kachel-Koordinaten.** Wenn die Hand in Spalte 5
bei (27, 41) ist, muss die Waffe dort ansetzen — dann passt sie automatisch.

## Die Spalten

| Spalte | Bedeutung |
|---|---|
| 0 | stehen |
| 1 | Laufen, Schritt 1 |
| 2 | Laufen, Schritt 2 |
| 3 | atmen (frei, wird nicht benutzt) |
| 4 | Angriff: ausholen |
| 5 | Angriff: durchziehen |
| 6 | Angriff: zurück |
| 7 | Treffer |
| 8 | tot |

Das Spiel zeigt 0, 1/2 im 180-ms-Takt, 4–6 über die Schwertdauer (500/600/800 ms),
7 und 8. Die linke Blickrichtung spiegelt der Client selbst — du zeichnest nur
**unten, rechts, oben**.

## Was auf welche Ebene gehört

| Ebene | Inhalt | Nicht darauf |
|---|---|---|
| `body` | Torso, Arme, Beine, Stiefel, Hose | Kopf, Haare, Rüstung, Waffe |
| `armor` | Brust, Schultern, Helm **falls** Teil der Rüstung; Rest transparent | Körper, Kopf, Haare |
| `head` | Gesicht/Kopf | Haare, Helm |
| `hair` | Haare oder Helm | Gesicht |
| `weapon` | nur die Klinge/Griff | Körper |

Reihenfolge im Spiel: Waffe hinten → Körper → Rüstung → Kopf → Haare → Waffe
vorne. Die Rüstung liegt **über** dem Körper und ist außerhalb der Teile
transparent — deshalb kannst du jede Rüstung mit jedem Körper kombinieren.

## Dateinamen

- Körper: `body/<id>.png` (z. B. `body/human_m.png`)
- Kopf: `head/<id>.png`
- Haare/Helm: `hair/<id>.png`
- Rüstung: `armor/<armorFile>.png` — der Wert `armorFile` aus
  `packages/shared/src/items.ts`, z. B. `03_tiger_plattenpanzer`
- Waffe: `weapon/<weaponArt>_<stage>.png` — `weaponArt` und `stage` aus dem Item,
  `stage` **zweistellig**, z. B. `schwert_02.png`, `zweihand_03.png`

## Neues Teil einbauen

1. PNG im richtigen Ordner ablegen (Raster wie oben).
2. Nur bei **Körper/Kopf/Haaren** einen Eintrag im Manifest ergänzen:
   `packages/client/src/styles.json` → Pack `pixel` → `bodies` / `heads` / `hairs`:
   ```json
   { "id": "human_m", "name": "Mensch (m)", "sheet": "/assets/body/human_m.png" }
   ```
   Rüstungen und Waffen brauchen **keinen** Manifest-Eintrag — sie hängen an den
   Items (`armorFile`, `weaponArt`/`stage`).
3. Prüfen: `node tools/check-art.mjs` (Raster) und `/look.html` (Ebenen
   übereinander). Danach im Spiel: `?style=pixel`.

## Im Spiel

- Beim Anlegen eines Charakters wählst du **Body** und **Kopf/Haare**.
- Rüstung und Waffe erscheinen, sobald du sie anlegst.
- Ein Klick auf ein Item legt es an; die Ebenen wechseln sofort.

## Werkzeuge

| Befehl / Seite | Zweck |
|---|---|
| `node tools/check-art.mjs` | prüft alle Sheets (Raster, Anker, leere Frames, Ebenen-Kontakt) und die Monster |
| `node tools/check-art.mjs pixel` | nur das Paket (ohne Monster) |
| `node tools/watch-art.mjs` | prüft nach jedem Speichern, für ein zweites Terminal |
| `python3 tools/contact-sheet.py` | Kontaktbogen je Ebene + Streifen je Körper nach `build/contact/` |
| `/look.html` | Ebenen + Pose + Ansicht, dazu der ganze Streifen, als PNG speicherbar |
| `/sheet.html` | eine einzelne Sheet-Datei mit Raster und Animation |
| `python3 tools/make-template-pack.py` | Platzhalter-Ebenen neu zeichnen (nicht im Manifest) |
| `python3 tools/draw-pixel-hero.py` | Vorlage mit Schattierung neu zeichnen (nicht im Manifest) |

## Was der Prüfer meldet

`check-art` liest die Pixel (kein Python nötig) und unterscheidet:

**Fehler** (rot, lassen den Test scheitern): Datei fehlt, kein PNG, Breite ≠
Kachel × Spalten, Höhe kein Vielfaches der Kachel, ein Body-Frame ist leer.

**Hinweise** (ändern nichts, zeigen aber, was beim Zeichnen schiefging):

- Füße nicht auf der Bodenlinie (mit y-Wert und Frame),
- ein Frame berührt den Kachelrand (abgeschnitten?),
- eine Ebene berührt ihren Partner nicht (Haare → Kopf, Kopf/Rüstung → Körper,
  Waffe → Körper), mit Anzahl und Beispiel-Frame,
- die neun Spalten eines Körpers sind identisch (keine Animation),
- ein Monster-Frame schwebt über dem Boden.

Der Kontaktbogen (`build/contact/`) zeigt dasselbe visuell: Raster,
Spaltennummern, Bodenlinie, Ankerkreuz — pro Ebene und als gestapelter Streifen.

## Monster

Monster sind eigene Sheets, unabhängig von den Spieler-Ebenen:

| | |
|---|---|
| Kachel | **40 × 32 px** |
| Ansichten | **4**, in dieser Reihenfolge: unten · links · rechts · oben |
| Bilder | **5** je Ansicht (stehen + 4 Laufbilder) |
| Blatt | **200 × 128 px** |
| Anker | Füße bei **(20, 29)** |
| Datei | `assets/monster/<look>.png` |
| Eintrag | `look` in `tools`-frei: `packages/shared/src/monsters.ts` → `MONSTER_TYPES` |

Ein neues Monster: PNG ablegen, in `MONSTER_TYPES` einen Eintrag mit `look`
(Dateiname ohne `.png`), Werten (TP, Tempo, Schaden, EXP, Beute) und `name`
anlegen; das Spiel lädt das Blatt automatisch. `check-art` prüft Raster und
Anker, `contact-sheet` prüft es nicht (Monster haben einen eigenen Aufbau).

## Tipps

- In Aseprite: Sprite-Größe **48×48**, Raster an, dann als **Streifen** mit 9
  Spalten und 3 Zeilen exportieren (432×144).
- Transparenter Hintergrund; keine Ränder über die Kachel hinaus.
- Die Füße immer auf y = 44, sonst schwebt die Figur über dem Boden.
- Erst **eine** Pose zeichnen und im Spiel ansehen, dann die anderen acht.
