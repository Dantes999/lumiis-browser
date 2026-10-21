# Lastmessung

Gemessen am 2026-10-21 auf einem Rechner mit 12 Kernen, Node 24, Server und Bots
auf derselben Maschine. Alle Bots stehen auf **einer** Karte und drängen sich um
den Startpunkt — das ist der ungünstigste Fall für Snapshots.

## Selbst messen

```bash
# 1. Server stoppen (zwei Schreiber auf einer SQLite-Datei streiten sich)
# 2. Bot-Accounts anlegen (einmalig, Passwort "botpass123")
node tools/seed-bots.mjs 300

# 3. Server starten, wahlweise mit Shards
SHARDS=1 npm start     # ein Prozess (Standard)
SHARDS=2 npm start     # Karten auf zwei Worker

# 4. In einem zweiten Terminal: Bots, Dauer in Sekunden
node tools/bots.mjs 300 30
```

Die Bots melden alle 5 s: Spieler in der Welt, Snapshots/s, Verkehr, Ping und
den Tick je Thread (`main` = Hauptprozess, `shards` = je Worker). Am Ende steht
`/status` unter Last.

## Ergebnis: 300 Spieler

| | 1 Prozess | 2 Shards (je Worker) | Hauptprozess |
|---|---|---|---|
| Tick | 16 ms | 8,6 / 1,3 ms | 7,1 ms |
| Spitze | 58 ms | 19 / 3 ms | 26 ms |
| Verkehr | 18–55 MB/s | **3,8 MB/s** | – |
| Snapshot im Schnitt | 5,7–11 KB | **1,2 KB** | – |
| CPU (ganzer Prozess) | ~183 % | ~213 % | – |

Die Bytes sind durch die **Delta-Snapshots** um das 5–9-fache gefallen: nur noch
Neuigkeiten, Bewegung und Abgänge statt aller Spieler mit Namen, Level, EXP und
Yang. Eine Zelle, in der sich nichts tut, schickt **gar nichts**.

**Grenze:** Mehr Shards als Karten bringen nichts — bei zwei Karten sind zwei
Shards das Maximum, `SHARDS=4` ergibt dasselbe. Und eine einzelne **volle**
Karte lässt sich so nicht teilen: alle Spieler dieser Karte liegen in einem
Worker. In der Praxis verteilen sich Spieler über 26 Karten, deshalb hilft es
dort.

## Delta-Snapshots (der größte Byte-Hebel)

Vorher: jede Zelle bekam 10×/s die vollständige Liste aller sichtbaren Spieler.
Jetzt (je Zelle einmal gebaut, von allen dort geteilt):

- **erster Snapshot** einer Zelle und jedes Mal, wenn jemand neu hineinläuft:
  das ganze Bild (`full: true`)
- danach **nur Änderungen**: neue oder veränderte Wesen als voller Eintrag,
  Bewegung als kurzes Tupel `[id, x, y, dir, flags, hp]`, Abgänge als IDs
- der eigene Eintrag ist ein normaler Eintrag: er kommt, wenn sich EXP, Yang,
  Level, TP oder Buffs ändern

Der Worker-Tick blieb dabei bei 8,6 ms, obwohl die Kodierung aufwendiger ist —
weil sie **einmal je Zelle** läuft, nicht je Spieler.

## Hauptprozess entlastet — was gemessen wurde

CPU-Profil des Haupt-Threads unter 300 Bots (`node --cpu-prof`), Anteil der
Samples:

| Stelle | vorher | nachher | Maßnahme |
|---|---|---|---|
| `saveCharacter` (SQLite) | 6,7 % | 0,5 % | Statements einmal vorbereiten, `synchronous = NORMAL`, Saves je Tick in **einer** Transaktion |
| `broadcastSnapshot` | 7,4 % | < 0,4 % | Snapshots einmal je Zelle als UTF-8-Puffer, kein Neu-Kodieren und kein Hashen großer Strings je Socket |
| `writev` (Sockets) | 9,4 % | 7,8 % | bleibt: die Bytes müssen raus |
| **Leerlauf** | 61 % | 77 % | – |

Lesart: Der Haupt-Thread war nie voll ausgelastet, verbrauchte aber Zeit an
vermeidbarer Arbeit. Beides ist jetzt weg — die verbleibende Arbeit ist das
Schreiben der Snapshots in die Sockets, und die hängt an der **Byte-Menge**,
nicht an der Spielerzahl.

## 500 Spieler (nur zur Orientierung)

| | 2 Shards (2 Karten) |
|---|---|
| Tick je Worker | 7,3 / 0,9 ms (424 / 76 Spieler) |
| Hauptprozess | 8–11 ms (Spitze bis 47 ms) |
| Verkehr | 42–55 MB/s |

Bei 500 Bots ist **der Bot-Prozess** selbst am Limit (eine Node-Instanz mit 500
Sockets, Pings bis 1,7 s). Die Serverzahlen sind deshalb eine Obergrenze der
Last, keine saubere Latenzmessung.

## Grenzen dieser Messung

- Bots und Server teilen sich die CPU. Für echte Latenz müssten die Bots auf
  einem zweiten Rechner laufen.
- Die erste Messphase enthält den **Login-Sturm** (scrypt); sie ist teurer als
  der Dauerbetrieb.
- Alle Bots auf einer Karte, dicht gedrängt: die Snapshots sind im Test viel
  größer als im Spiel (11 KB statt wenige hundert Byte).

## Wenn es wieder eng wird

1. **Mehr Karten je Worker** gibt es nicht — die Zuteilung ist reihum und fest.
   Mehr Shards helfen nur, wenn mehr Karten da sind.
2. **Hauptprozess**: die verbleibende Arbeit ist der Socket-Versand. Der nächste
   Schritt wäre, Snapshots zu verkleinern (nur Änderungen senden statt aller
   Spieler mit Namen, Level, EXP, Yang) — das senkt die Bytes direkt.
3. **Eine volle Karte** teilen geht nur, wenn Spieler derselben Karte auf
   mehrere Worker verteilt werden; das braucht eine andere Architektur
   (Zonen statt Karten).
