# HOWITWORKS — Lumiis technisch

Diese Datei ist der Einstieg, wenn etwas nicht stimmt: **wo steht was, wo wird
gerechnet, und wie findet man einen Bug oder einen Absturz.**

Wenn Code und diese Datei sich widersprechen, gilt der **Code**. Dann bitte die
Stelle hier korrigieren.

---

## 1. Was das ist

Ein server-autoritatives 2D-MMORPG im Browser (Handy + PC). Der Server rechnet
alles, der Browser schickt nur Absichten und zeichnet. Ein Prozess, eine
Datenbank, kein Build-Zwang im Spiel (nur TypeScript → JavaScript).

```
packages/shared   Regeln und Daten, die Server UND Browser importieren
packages/server   Spielserver, Tick-Schleife, WebSocket, SQLite
packages/client   Phaser-Szene, Netzwerk, HTML-Oberfläche
tools/            Karten-Generator, Testcharaktere, Bots
```

---

## 2. Starten, bauen, testen

| Was | Befehl |
|---|---|
| Entwicklung (Server + Hot-Reload-Client) | `npm run dev` → Client auf http://localhost:5173 |
| Bauen + starten (ein Port) | `npm run build && npm start` → http://localhost:3000 |
| Nur bauen | `npm run build` |
| TypeScript prüfen | `npm run typecheck` |
| Alle Tests | `npx vitest run` |
| Eine Testdatei | `npx vitest run packages/server/tests/world.test.js` |
| Karten-Editor | http://localhost:3000/editor.html (oder :5173/editor.html) |

Der **Server** läuft aus `packages/server/dist/` (kompiliert). Änderst du
Server-Code, musst du neu bauen (im `dev`-Modus passiert das automatisch).
Der **Client** läuft im `dev`-Modus direkt aus dem Quellcode (Vite).

---

## 3. Projektkarte — wo liegt was

### Server (`packages/server/src/`)

| Datei | Inhalt |
|---|---|
| `index.ts` | Einstieg: `createGameServer`, Tick-Schleife, Autosave, Shutdown, **Absturz-Handler** |
| `game/world.ts` | **Die Welt einer Karte**: Spieler, Monster, Boden-Items, Inventar, Ausrüstung, Snapshot. Der größte Brocken. |
| `game/realm.ts` | **Alle Karten** + Portale. Ein `World` je Karte, Spieler wandern zwischen ihnen. |
| `game/formulas.ts` | **Alle Berechnungen** (Schaden, Abklingen, Beute-Würfe, Split). Reine Funktionen. |
| `game/monster-ai.ts` | **Monster-Entscheidungen**: Ziel suchen, Weg finden, Wandern. |
| (in `world.ts`) `drainRewards` | Kill-Belohnungen zum Rundruf (EXP-Kugeln) |
| `game/loop.ts` | `FixedStepLoop`: fester 20-Hz-Takt, holt Rückstand begrenzt nach. |
| `game/map.ts` | Karten von der Platte laden und prüfen. |
| `net/gateway.ts` | **WebSocket**: Login, Charakterauswahl, Nachrichten-`switch`, Ratenlimit, `saveAll`. |
| `store/db.ts` | **SQLite**: Accounts (scrypt), Charaktere, Inventar, Speichern/Laden. |
| `http/static.ts` | Liefert Client und `/shared/` aus. |
| `http/mapsave.ts` | Karten-Editor speichert Karten (nur lokal). |

### Geteilte Regeln (`packages/shared/src/`)

| Datei | Inhalt |
|---|---|
| `constants.ts` | `TICK_RATE` 20, `TICK_MS` 50, `SNAPSHOT_EVERY_TICKS` 2, `TILE_SIZE` 32, Limits |
| `protocol.ts` | **Alle Netz-Nachrichten** (Typen + Prüfung `parseClientMessage`) |
| `map.ts` | Karten-Typ, Kacheln, **Kollision** (`canStand`, `moveWithCollision`), SOLID |
| `movement.ts` | 8 Richtungen, `dirFromInput`, Schritt pro Tick |
| `combat.ts` | **Schwung**: Profile (Tempo, Reichweite, Trefferzeitpunkt), **Bogen** (`inSwingArc`) |
| `skills.ts` | **Skill-Tabelle**: Aura (Buff) und Schwertwirbel (AoE) |
| `items.ts` | **Gegenstände** (Waffen, Rüstung, Material), `itemDef`, Inventar-Größe |
| `monsters.ts` | **Monster-Tabelle**: TP, Schaden, Tempo, Beute, EXP. Plus `PLAYER_DAMAGE`. |
| `progression.ts` | **Levelkurve**: `expForNextLevel(level)` |
| `pathfinding.ts` | A* über die Kacheln (Monster nutzen das) |
| `index.ts` | Re-Export aller obigen Dateien |

### Client (`packages/client/src/`)

| Datei | Inhalt |
|---|---|
| `main.ts` | **Klebstoff**: Login, HUD-Takt, alles verdrahten. Keine Spielregeln. |
| `net.ts` | WebSocket: senden, Snapshot lesen, Betriebszustand |
| `state.ts` | `view`: ein veränderbares Objekt, in das das Netz schreibt und die Szene liest |
| `sim.ts` | Vorhersage der eigenen Figur + Interpolation |
| `input.ts` | Tastatur, Touch-Joystick, Zoom, Tastenbelegung |
| `combat.ts` | Schwung auslösen, Zielen, Angriffs-Pose |
| `skill.ts` | Skill auslösen, lokale Abklingzeit, Buff-Anzeige |
| `loot.ts` | Aufheben (Y / Klick / Auto) |
| `scene/world-scene.ts` | **Die Welt zeichnen**: Karte, Spieler, Monster, Boden, Effekte, Kamera |
| `scene/swing-trail.ts` | Lichtstreif des Schwungs |
| `scene/skill-effects.ts` | Wirbel-Effekt |
| `scene/reward-orbs.ts` | Gelbe EXP-Kugeln vom Monster zum Spieler |
| `art.ts` | Spieler aus Ebenen zusammensetzen (Rüstung, Kopf, Haare, Waffe) |
| `mobart.ts` | Monster-Sprites + Lebensbalken |
| `audio.ts` | Töne im Code erzeugt (Web Audio), kein Ton-Asset |
| `mobile.ts` | Handy-Erkennung, Querformat-Hinweis, Landscape-Sperre, HUD ausblenden |
| `ui/hud.ts` | HUD: Status, TP, EXP, Yang, Angriff, Skills |
| `ui/bag.ts`, `ui/characters.ts`, `ui/login.ts`, `ui/settings.ts` | Fenster |
| `editor/main.ts` | Karten-Editor |

---

## 4. Wie ein Tick läuft

Ein Tick ist **50 ms** (20 pro Sekunde). Die Schleife liegt in
`packages/server/src/game/loop.ts`, der Ablauf in `World.step()`
(`packages/server/src/game/world.ts`).

Reihenfolge in `step()`:

1. `tickCount += 1`
2. **Schwünge auflösen** (`resolveSwings` → `landSwing`): Treffer landen,
   Schaden, Tötungen, Beute.
3. **Spieler**: tot? wiederbeleben. Sonst: TP-Regeneration, Buffs ablaufen,
   Bewegung (`moveWithCollision`), Portal prüfen.
4. **Monster**: tot? wiederbeleben. Sonst: **nur wenn ein Spieler in der Nähe
   ist** (oder es bereits jagt) → Kampf (`stepMonsterCombat`) oder Wandern
   (`stepMonsterWander`). Weit entfernte Monster **schlafen** und kosten fast
   nichts.
5. **Boden-Items einsammeln** (Auto-Pickup).

Danach im Hauptthread (`index.ts`):

- Inventar-Änderungen an die Clients schicken.
- **Jeden 2. Tick** (`SNAPSHOT_EVERY_TICKS`): Snapshot je Karte an alle Spieler
  (also 10-mal pro Sekunde).
- **Alle 30 s**: alle Charaktere speichern.

---

## 5. Wie eine Nachricht läuft

```
Browser  ──WebSocket /ws──►  gateway.ts  ──►  realm.ts  ──►  world.ts
   ▲                            │                                │
   └──────── snapshot / notice ◄─┴────────────────────────────────┘
```

1. **Browser** (`client/net.ts`) schickt JSON, z. B. `{ t: 'attack', target: 7 }`.
2. **`gateway.ts`** prüft Ratenlimit, dekodiert, ruft `parseClientMessage`
   (`shared/protocol.ts`) → prüft Typ, Schlüssel und Wertebereiche.
3. Der `switch (msg.t)` ruft die passende Methode auf (`realm.attack(...)`).
4. `Realm` sucht die richtige Karte (`worldOf(playerId)`) und reicht weiter.
5. `World` entscheidet, was wirklich passiert (Server ist autoritativ).
6. Antwort: direkt (`notice`), über den Snapshot oder als Ereignis.

**Wichtig:** Der Client kann nichts „behaupten". Er schickt nur Absichten; der
Server prüft alles neu. Neue Nachrichten brauchen immer einen Fall in
`parseClientMessage` **und** im `switch` in `gateway.ts`.

---

## 6. Wo wird gerechnet

Alles Wichtige ist in **`packages/server/src/game/formulas.ts`** gebündelt:

| Funktion | Bedeutung |
|---|---|
| `attackDamage(waffe, buffs)` | Schaden eines Schlags = `PLAYER_DAMAGE` + Waffe + Aura |
| `damageTaken(roh, rüstung)` | Was nach Rüstung wirklich abgeht (mindestens 1) |
| `rollBetween(min, max, random)` | Ganzzahl-Wurf (Yang, Beutemenge) |
| `damagePortion(anteil, gesamt)` | Anteil am Kill (Schaden-Split) |
| `whirlwindDamage(angriff, faktor)` | Schaden des Schwertwirbels |
| `regeneratedHp(...)`, `revivedHp(...)` | TP-Regeneration und Wiederbelebung |

Weitere Formeln an ihrem Ort:

| Was | Wo |
|---|---|
| Levelkurve | `shared/progression.ts` → `expForNextLevel` (50 × Level^1,6) |
| Trefferbogen / Reichweite | `shared/combat.ts` → `inSwingArc`, `SWINGS` |
| Waffentempo/Trefferzeitpunkt | `shared/combat.ts` → `SWINGS` (Ticks) |
| Monster-Werte | `shared/monsters.ts` → `MONSTER_TYPES` |
| Gegenstands-Werte | `shared/items.ts` → `ITEMS` |
| Skill-Werte | `shared/skills.ts` → `SKILLS` |
| Kollision (Fußbox) | `shared/map.ts` → `canStand`, `PLAYER_HALF_WIDTH` |
| EXP/Yang-Split | `world.ts` → `rewardKill` (nutzt `damagePortion`) |
| Beute-Wurf | `world.ts` → `dropLoot` (nutzt `rollBetween`) |

**Merke:** Wenn eine Zahl im Spiel falsch aussieht, ist die erste Adresse
`formulas.ts` und die Tabelle in `shared/`.

---

## 7. Speichern

- Datei: **`data/lumiis.db`** (SQLite, WAL-Modus). Daneben `-wal` und `-shm`.
- **`data/token.key`**: geheimer HS256-Schlüssel für Session-Tokens. Wird beim
  ersten Start erzeugt. **Nie löschen/wechseln** ohne Grund — sonst loggen alle
  Clients einmalig aus.
- Passwörter: scrypt. Kein Klartext.
- **Session-Login:** Nach dem Login schickt der Server einen signierten Token
  (7 Tage) im `characters`-Paket. Der Client legt ihn in `localStorage`
  (`lumiis.token`) ab und schickt beim nächsten Start `{t:'resume', token}`.
  Gültig → Charakterliste; ungültig → `authError`, Token wird verworfen.
  Der zuletzt gespielte Charakter (`lumiis.character`) wird direkt betreten.
- Gespeichert wird: nach Login, alle 30 s, beim Abmelden und beim Shutdown.
- `data/` gehört **nie** in eine Lieferung oder ein Backup ohne Absicht.

Der Code dafür: `packages/server/src/store/db.ts` (`Store`, `loadCharacter`,
`saveCharacter`).

---

## 8. Einen Bug suchen — der Ablauf

1. **Nachstellen**: Server starten, im Browser nachspielen (oder per Test).
   Wartezeiten lassen sich mit `?` im Code kürzen, oder per Testcharakter.
2. **Eingrenzen, welche Schicht** es ist:
   - Falsche **Zahl** (Schaden, EXP, TP)? → `formulas.ts`, `shared/`-Tabellen.
   - Falsche **Bewegung/Kollision**? → `shared/map.ts` (`canStand`).
   - Monster läuft falsch? → `game/monster-ai.ts`.
   - Server tut nicht, was der Client will? → `gateway.ts` → `realm.ts` → `world.ts`.
   - Client zeigt es falsch an? → `client/scene/` oder `client/ui/`.
3. **Snapshot prüfen**: Im Browser `window.lumiis.view` in die Konsole eingeben.
   Das ist der komplette Client-Zustand (Spieler, Monster, Boden, Inventar).
   `window.lumiis.connection` und `window.lumiis.game` hängen daneben.
4. **Test schreiben**: In `packages/server/tests/world.test.ts` (oder passender
   Datei) den Fall nachbauen. Erst rot, dann fixen.

### Das Log-Fenster (für Fehler ohne Dev-Konsole)

Im HUD gibt es den Knopf **Log** (oder Taste **L**). Dort stehen die letzten
Verbindungs-Ereignisse mit Uhrzeit:

- `connecting to ws://…/ws`, `connected, logging in`, `in the world on map …`
- `connection closed (code 1006…)` — die Verbindung ist weg
- `reconnecting in Xs` — der Client versucht es erneut (Wartezeit verdoppelt sich)
- `no traffic for 7s, dropping the connection` — **die Verbindung war halb tot**
  und wurde erkannt
- `auth error: …`, `socket error`, `script error: …`

**Copy** kopiert den ganzen Log in die Zwischenablage — gut zum Weiterschicken.

**Dieselben Client-Zeilen erscheinen auch im Server-Terminal** (der Client schickt
sie an den Server), mit Spieler-Name und IP — so kannst du die zwei PCs
auseinanderhalten:

```
[ws] open from 192.168.1.20
[client guest @ 192.168.1.20] info: connected, logging in
[client test @ 192.168.1.20] info: in the world on map "testmap"
[client test @ 192.168.1.20] warn: no traffic for 7s, dropping the connection
[ws] closed test code=1006 reason=-
```

Serverseitig schreibt jedes Verbindungs-Ereignis eine Zeile ins Terminal — mit
Dauer und Nachrichtenzahl, damit man sieht, wie weit eine Verbindung kam:

```
[ws] open from 192.168.1.20
[ws] closed test @ 192.168.1.20 after 42.3s / 211 messages, code=1006 reason=-
[ws] socket error for test @ 192.168.1.20: read ECONNRESET
[ws] heartbeat missed for test @ 192.168.1.20 (31s), terminating
[ws] refused code=1008 reason=rate limit
[ws] handler failed for "attack": ...
```

Die **Schließ-Codes** sagen die Ursache:

| Code | Bedeutung |
|---|---|
| 1006 | Verbindung ohne Abschied abgerissen (Netz, WLAN, Proxy) |
| 1001 | Gegenstelle geht weg (Server-Neustart, Seite zu) |
| 1002 | Protokollfehler (ungültige Nachricht) |
| 1008 | Ratenlimit oder Richtlinie |
| 4000 | Derselbe Charakter auf einer anderen Verbindung |
| 1009 | Nachricht zu groß |

**Wichtig bei zwei PCs:** Der Client verbindet sich immer mit `<host>/ws`. Läuft
er über den **Vite-Entwicklungsserver (Port 5173)**, geht die Verbindung durch
Vite's Proxy — der ist bei Dauer-WebSockets unzuverlässig. Für einen zweiten PC
**den gebauten Client auf Port 3000** nehmen (`npm run build`, dann
`http://<IP>:3000`), dann spricht er direkt mit dem Spielserver. Im Log steht
die verwendete Adresse in der Zeile `connecting to ws://…`.

Hinweis: Zeilen, die **vor** dem Verbindungsaufbau entstehen (z. B.
`client started`) oder **während** des Schließens (`connection closed`), kommen
nicht mehr durch — dafür steht dann die `[ws] closed …`-Zeile des Servers da.

**Ein Charakter kann nur einmal in der Welt sein.** Meldet sich derselbe
Charakter ein zweites Mal an (z. B. derselbe Account auf zwei PCs), speichert
der Server die alte Figur, nimmt sie aus der Welt und schließt die alte
Verbindung mit Code **4000 „Signed in elsewhere"**. Der andere Client springt
dann **nicht** automatisch wieder hinein (sonst würden sich beide endlos
gegenseitig rauswerfen) — er landet auf der Charakterauswahl, mit Hinweis
„Signed in elsewhere". Wer den Charakter zuletzt anklickt, hat ihn.

**Wenn ein Client „einfriert"** (laufen geht, Monster stehen, treffen geht nicht):
1. Log-Fenster öffnen und den letzten Block lesen.
2. `no traffic` → die Leitung war tot; der Client verbindet sich selbst neu und
   springt automatisch in denselben Charakter zurück.
3. `code 1008` / `rate limit` → der Client hat zu viele Nachrichten geschickt.
4. `handler failed` im Server → dort steht die Nachricht, die den Fehler auslöste.

**Hintergrund-Tab:** Browser drosseln Timer im Hintergrund stark (~1×/Minute).
Damit die Verbindung dann nicht einschläft, läuft der Ping in einem **Web
Worker** (nicht gedrosselt), der den Haupt-Thread aufweckt. Ohne Worker-Unterstützung
fällt der Client auf einen normalen Timer zurück.

### Nützliche Debug-Blicke (Browser-Konsole)

```js
window.lumiis.view.self            // eigene Figur: Position, TP, Buffs
window.lumiis.view.monsters        // Map aller Monster
window.lumiis.audio.state()        // { state, played, volume } für Tonprobleme
window.lumiis.game.scene.getScene('world')   // Szene: views, trails, whirlwinds
```

---

## 9. Wenn der Server abstürzt

Seit dem Absturz-Handler (`index.ts`) gilt:

1. Der Prozess **loggt den Fehler samt Stacktrace** in die Konsole:
   `Uncaught exception, saving and stopping: ...`
2. Er **speichert alle Charaktere** und beendet sich dann mit Code 1.

Das heißt: höchstens die letzten Sekunden seit dem letzten Autosave (max. 30 s)
gehen verloren.

**Was du tun sollst:**

1. Die **letzte Logzeile vor dem Absturz** lesen — dort steht Datei und Zeile
   (z. B. `at World.landSwing (…/world.js:123:9)`).
2. Diese Stelle im TypeScript suchen (`world.ts`), die Bedingung prüfen.
3. Bug nachstellen (Abschnitt 8) und einen Test schreiben.
4. Läuft der Server nicht mehr: `data/lumiis.db` ist gespeichert; einfach neu
   starten.

**Typische Absturz-Ursachen:**

| Ursache | Wo suchen |
|---|---|
| `undefined`-Zugriff nach einem Kill/Tod | `world.ts` (`killMonster`, `revivePlayer`, `landSwing`) |
| Monster/Spieler aus der Map genommen, aber weiter benutzt | `removePlayer`, `detachPlayer`, `killMonster` |
| Karte kaputt (ungültige Kachel/Portal) | `game/map.ts` (Start bricht bewusst ab) |
| Datenbank gesperrt / Datei weg | `store/db.ts`, Meldung beim Start |

**Wichtig:** Es gibt *keinen* Fall, in dem der Server absichtlich ohne Speichern
stirbt — außer `kill -9` (SIGKILL). Dann hilft nur der letzte Autosave.

---

## 10. Häufige Änderungen — wo anfassen

| Ich will … | Datei |
|---|---|
| Monster stärker/schwächer | `shared/monsters.ts` (`MONSTER_TYPES`) |
| Waffe/Rüstung ändern oder neu | `shared/items.ts` (`ITEMS`) — neue Gegenstände **vor** den Kostüm-Block |
| Skill-Zahlen (Schaden, Abklingzeit) | `shared/skills.ts` (`SKILLS`) |
| Schwung-Tempo/Reichweite | `shared/combat.ts` (`SWINGS`) |
| Trefferbogen breiter/schmaler | `shared/combat.ts` (`SWING_ARC`) |
| Levelkurve | `shared/progression.ts` |
| Schadensformel | `game/formulas.ts` |
| Monster-KI | `game/monster-ai.ts` |
| Neue Nachricht (Client↔Server) | `shared/protocol.ts` **und** `net/gateway.ts` |
| Neues Fenster (UI) | `ui/` + `index.html` + `main.ts` (Verdrahtung) |
| Karten | `shared/maps/*.json` oder der Editor |

---

## 11. Grenzen (bewusst noch offen)

- **Kein Mana/SP** — Skills laufen nur über Abklingzeit.
- **Nur zwei Skills** (Aura, Schwertwirbel).
- **Kein Chat**, keine Gruppen, keine Gilden.
- **Ein Prozess**: fällt er, ist die Welt kurz weg (Spielstände sind gesichert).
- **Karten und Zahlen sind vorläufig**; Balancing kommt später mit Bots.

---

## 12. Wenn du gar nicht weiterkommst

Sammle diese drei Dinge und schick sie:

1. **Was du getan hast** (Schritte bis zum Bug).
2. **Die letzte Konsolenzeile** des Servers (Stacktrace).
3. **Den Client-Zustand**: `JSON.stringify(window.lumiis.view)` in der Konsole.

Damit lässt sich fast jeder Fehler in wenigen Minuten eingrenzen.
