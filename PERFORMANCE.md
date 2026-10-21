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
SHARDS=2 npm start     # zwei Karten-Worker

# 4. In einem zweiten Terminal: Bots, Dauer in Sekunden
node tools/bots.mjs 300 30
```

Die Bots melden alle 5 s: Spieler in der Welt, Snapshots/s, Verkehr, Ping und
den Tick je Thread (`main` = Hauptprozess, `shards` = je Worker). Am Ende steht
`/status` unter Last.

Für die CPU-Zahl im Beispiel: PID des Servers holen, dann vor und nach dem Lauf
`/proc/<pid>/stat` lesen (Felder 14 + 15) — die Summe ist die CPU-Zeit in
Hundertstelsekunden.

## Ergebnis

| Spieler | 1 Prozess: Tick | 2 Shards: Tick je Worker | 2 Shards: Hauptprozess |
|---|---|---|---|
| 100 | 6,2 ms (Spitze 11,9) | 1,4 / 0,5 ms (Spitze 3,3 / 1,3) | 2,3 ms |
| 300 | 20,2 ms (**Spitze 52,7**) | 4,9 / 0,8 ms (Spitze 11,5 / 1,7) | 8,5 ms |

CPU des ganzen Serverprozesses (alle Threads, inklusive Login-Sturm mit scrypt):

| Spieler | 1 Prozess | 2 Shards |
|---|---|---|
| 100 | 61 % eines Kerns | 74 % |
| 300 | 200 % | 219 % |

## Was das heißt

- **Ein Prozess** trägt auf dieser Maschine etwa **150 Spieler** bequem. Bei 300
  liegt der Tick bei 20 ms im Mittel, mit Spitzen **über dem 50-ms-Budget** —
  ab da ruckelt es sichtbar.
- **Zwei Shards** verteilen die Arbeit: 300 Spieler kosten je Worker nur noch
  5 ms. Der Hauptprozess bleibt bei 8,5 ms, hat also Luft.
- Die CPU steigt mit Shards **leicht** (Botschaften zwischen den Threads, zwei
  Welten). Der Gewinn ist nicht weniger CPU, sondern **mehr Reserve pro Tick**:
  die Arbeit läuft auf zwei Kernen statt hintereinander auf einem.
- Der **Hauptprozess wird der nächste Engpass**: Snapshots senden (bei 300 Bots
  21–45 MB/s, weil sie dicht stehen) und Nachrichten weiterreichen.

## Grenzen dieser Messung

- Der **Bot-Prozess** ist selbst eine Node-Instanz mit 300 Sockets. Die hohen
  Pings (826 ms) im 1-Prozess-Lauf sind dessen Rückstand, nicht der des Servers.
  Für echte Latenz müssten die Bots auf einem zweiten Rechner laufen.
- Die erste Messphase enthält den **Login-Sturm** (scrypt-Hashing); sie ist
  deshalb teurer als der Dauerbetrieb.
- Alle Bots auf einer Karte: in der Praxis verteilen sich Spieler, die Snapshots
  werden kleiner.

## Nächste Schritte, wenn es eng wird

1. **Shards erhöhen** (`SHARDS=4`, `SHARDS=8`) — die Karten werden reihum
   verteilt, jede Karte bleibt ganz in einem Worker.
2. **Hauptprozess entlasten**: Snapshots nicht mehrfach kodieren (schon erledigt:
   eine Zelle teilt einen String), Nachrichten bündeln.
3. **Karten-Zuteilung nach Last** statt reihum (heute fest).
