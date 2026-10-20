# Grafiken von Lumiis (assets/)

Alle Figuren, Rüstungen, Waffen, Haare, Kostüme, Monster, NPCs, Pferde und Symbole liegen hier als PNG-Dateien.
Das Spiel malt sie nicht mehr selbst, es lädt genau diese Dateien (`client/art.js`). **Wer eine Datei austauscht,
sieht nach dem Neuladen der Seite das neue Bild im Spiel.** Neu starten muss man den Server dafür nicht.

Was weiter im Code entsteht: Karten, Bodenkacheln, Bäume und Häuser (`client/tilelooks*.js`, `client/mapart*.js`) sowie
Effekte (`client/vfx.js`).

## Regeln beim Austauschen

- Größe gleich lassen: ein Bogen hat genau so viele Zeilen und Spalten wie vorher, sonst fehlen Bilder.
- Durchsichtig ist durchsichtig (Alpha 0). Halbdurchsichtige Pixel gehen, bei Figuren aber nicht in Masken (siehe unten).
- Den Umriss der Spielerfiguren und die dunkle Linie unter dem Kopf rechnet das Spiel selbst aus. Diese Linien gehören
  nicht in die Bilder der Figur.
- Die Figur schaut nach links? Das gibt es nicht als Bild. Das Spiel spiegelt die Ansicht „rechts“.
- Die JSON-Listen sagen dem Spiel, welche Datei wofür steht. Wer eine Datei umbenennt, ändert auch den Eintrag `datei`.
  Neue Einträge in einer Liste (zum Beispiel ein neuer Helm) braucht das Spiel nur zusammen mit dem Gegenstand im
  Code (`shared/items.js`).

## Ordner

| Ordner | Inhalt |
|---|---|
| `ruestungen/<klasse>_<m\|w>/` | eine Datei je Rüstung, `00_ohne_ruestung.png` ist die Grundkleidung; Nummer = Rüstungsstufe |
| `helme/<klasse>_<m\|w>/` | eine Datei je Helm, Nummer = Helmstufe |
| `waffen/<art>/` | eine Datei je Waffenstufe (`00.png`, `01.png` …); `sura_schwert` sind die eigenen Schwerter des Sura |
| `haare/` | Frisur und Gesicht je Klasse, Geschlecht und Gestalt: `krieger_m_1.png` = Krieger, männlich, Gestalt 1 |
| `modelle/spieler/` | Kopf (Haut, Ohren) je Klasse und Geschlecht |
| `kostueme/koerper/<kostüm>/` | Kostüme für den Körper, eine Datei je Klasse und Geschlecht; ersetzen die Rüstung |
| `kostueme/frisuren/<frisur>/` | Kostüm-Frisuren; je nach Art ersetzen sie das Haar (`art: "haar"`) oder den Helm (`art: "helm"`) |
| `modelle/monster/` | ein Bogen je Monster-Aussehen, dazu eine JSON-Datei mit dem Zuschnitt (siehe unten) |
| `modelle/npcs/` | ein Bogen je NPC, ebenso mit JSON-Datei |
| `modelle/pferde/` | Pferde 1 bis 8 (Aussehen nach Pferdestufe) |
| `modelle/puppe.png` | Trainingspuppe |
| `icons/<typ>/<gegenstand>.png` | ein Symbol je Gegenstand, 32 Pixel breit, 32 × Höhe in Inventarfeldern hoch |
| `icons/yang_boden.png` | Yang auf dem Boden |

Klassen heißen in Dateinamen `krieger`, `ninja`, `sura`, `schamane`.

## Spielerfiguren: so setzt das Spiel sie zusammen

Eine Figur besteht aus Schichten aus fünf Dateien: Rüstung (oder Körper-Kostüm), Haar, Kopf, Helm (falls getragen) und
Waffe. Jeder Bogen ist ein Raster aus Bildern zu **48 × 48 Pixeln**. Der Fußpunkt der Figur liegt bei (24, 44).

**Spalten** (in jedem Bogen gleich, von links): `stehen`, `schritt_1`, `schritt_2`, `atmen`, `angriff_1`, `angriff_2`,
`angriff_3`, `treffer`, `tot`. In der Spalte `tot` steht die Figur von vorn ohne Waffe; das Spiel legt sie hin.

**Zeilen** stehen in der JSON-Liste des Ordners (`zeilen`), von oben nach unten. Ein Zeilenname besteht aus
`<schicht>/<waffenart>/<ansicht>`, beritten mit `/reiten` dahinter, zum Beispiel `koerper/schwert/rechts/reiten`.
Ansichten: `unten` (zum Betrachter), `rechts`, `oben` (Rücken).

Reihenfolge von hinten nach vorn:

1. Waffe `hinten` (nur wo noch nichts von der Figur ist)
2. Rüstung `hinten` (Umhang, Rückenteile)
3. Haar `hinten`
4. Maske `loeschen` der Rüstung (macht frei, was darunter liegt), Rüstung `koerper`, danach die Maske `naht`
5. Haar `ueber` (fällt über den Rücken)
6. Rüstung `waffenarm`, danach die Maske `naht_waffenarm`
7. Helm `hinten`
8. Kopf `kopf`
9. Haar `oben` (nur ohne Helm oder mit einem Helm, der alles Haar zeigt)
10. Haar `gesicht` (Augen, Brauen, Mund; mit Helm die Zeile `gesicht_helm`)
11. Helm `vorne`
12. dunkle Linie unter Kopf und Haar, Umriss (rechnet das Spiel)
13. Waffe `vorne`, außer wo die Hand am Griff (Masken `haende`, `haende_waffenarm`) noch zu sehen ist

Der Helm sagt in `helme.json` mit `haar`, wie viel Haar man darunter sieht: `none` keins, `back` nur das Haar hinten und
über dem Rücken, `all` alles.

**Masken** sind keine Bilder. Jedes Pixel, das nicht durchsichtig ist, zählt; die Farbe ist egal, exportiert werden sie
schwarz. Alle stehen im Bogen der Rüstung (und des Körper-Kostüms):

| Maske | Wirkung |
|---|---|
| `naht`, `naht_waffenarm` | das Pixel darunter wird dunkel wie eine Innenlinie (Trennlinie zwischen Arm und Körper) |
| `hand`, `hand_waffenarm` | Hände von Körper und Waffenarm: die dunkle Linie unter dem Kopf läuft nicht über sie |
| `haende`, `haende_waffenarm` | Hände, die eine Waffe vor dem Körper halten: sie liegen über dem Griff |
| `loeschen` | dort wird vor dem Körper alles wieder durchsichtig (Saum des Rocks der Sura) |

Wer eine Hand neu malt, malt sie in `koerper` oder `waffenarm` und dieselben Pixel in `hand…` (und `haende…`, wenn sie
eine Waffe hält).

Die Stufe einer Rüstung, eines Helms oder einer Waffe steht in der Liste (`stufe`). Fehlt eine Stufe, nimmt das Spiel die
höchste vorhandene darunter.

## Monster, NPCs, Pferde, Puppe

Ein Bogen (PNG) und daneben eine gleichnamige JSON-Datei. Die JSON hat den Aufbau, den das Spiel braucht (`frames`, bei
NPCs auch Werte wie `ox`, `oy`). An jeder Stelle, an der dort `{"@": [x, y, b, h]}` steht, schneidet das Spiel dieses
Rechteck aus dem Bogen aus. Bei Monstern sind die Zeilen die Ansichten (unten, links, rechts, oben) und die Spalten
`stehen`, `schritt_1`, `schritt_2`, `angriff`, `tot`. Wer nur die Pixel innerhalb der Rechtecke ändert, muss an der JSON
nichts ändern. Das weiße Aufblitzen bei Treffern rechnet das Spiel aus dem Bild.

`modelle/monster/monster.json` ordnet jedem Monster-Aussehen (`aussehen` in `shared/mobs.js`) seine Datei zu. Größere
Varianten heißen `<aussehen>@<größe>.png`. Bei Lumiis-Steinen stehen dort auch die Farben der Runen (`rune`, `body`).
Ein unbekanntes Aussehen zeigt das Spiel als Wolf, einen unbekannten NPC als Schmied.

## Neu exportieren (überschreibt!)

Die Bilder kamen einmal aus dem alten Zeichencode (`tools/generator/`). `npm run export-art` malt sie neu und
**überschreibt dabei die Dateien hier, auch selbst gemalte**. Darum nur einzelne Teile neu erzeugen und vorher sichern:

```
node tools/export-art.js --nur=icons          # figuren, monster, npcs, icons
node tools/export-art.js --ziel=assets_neu    # in einen anderen Ordner, zum Vergleichen
```

Für Monster, NPCs und Symbole braucht der Export Chromium über Playwright (`npm i` und `npx playwright install chromium`),
für Figuren nicht. Ob die Dateien noch genau dem Generator entsprechen, prüfen `npm run art:pruefen` (alles außer Figuren)
und `node tools/art/check-figures.js` (Figuren). Wer eigene Bilder einsetzt, sieht dort natürlich Unterschiede.
