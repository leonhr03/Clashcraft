# Blockwelt

Ein eigenes 3D-Voxel-Sandbox-Spiel (Abbauen, Bauen, Craften, Überleben) für Android-Handys.
Alle Texturen, Mobs und Sounds werden prozedural im Code erzeugt – es werden keine fremden Assets verwendet.

## Features
- Unendliche, zufällig generierte Welt mit Seed: Ebenen, Wälder, Birkenwälder, Taiga, Wüsten, Schneetundra, Berge, Sümpfe, Ozeane, Strände
- Höhlen, Erze (Kohle, Kupfer, Eisen, Gold, Lapislazuli, Diamant), Lava, Granit/Diorit/Andesit
- 85 Blöcke und über 100 Items: Werkzeuge in 5 Stufen, Rüstungen in 4 Stufen, Bogen & Pfeile, Eimer, Schere, Essen, Farbstoffe …
- Crafting (2×2 im Inventar, 3×3 an der Werkbank), Ofen zum Schmelzen/Braten, Truhen, Bett (Schlafen + Spawnpunkt)
- Überleben: Herzen, Hunger, Sauerstoff unter Wasser, Fallschaden, Lava, Rüstungsschutz, Tod & Wiederbeleben
- Kreativmodus: alle Items, Fliegen (Springen doppelt tippen), sofortiges Abbauen
- Tiere: Schwein, Kuh, Schaf (scherbar), Huhn – Monster: Zombie, Skelett (schießt Pfeile), Spinne
- Tag-/Nacht-Zyklus mit Sonne, Mond, Sternen, Wolken; Licht von Fackeln, Laternen, Lava (weiche Beleuchtung + Umgebungsverdeckung)
- Ackerbau (Hacke, Weizen, Knochenmehl), wachsende Setzlinge, Zuckerrohr, Kakteen
- Wasser- und Lavafluss, fallender Sand/Kies
- Speichern mehrerer Welten (automatisch)
- Touch-Steuerung: Joystick links, Umsehen rechts wischen, Tippen = Benutzen/Platzieren/Angreifen, Halten = Abbauen

## APK installieren
Bei jedem Push baut GitHub Actions automatisch die APK (`.github/workflows/android.yml`).
Unter **Releases** die neueste `Blockwelt.apk` auf dem Handy herunterladen und installieren
(einmalig "Apps aus unbekannten Quellen installieren" erlauben).

## Selbst bauen
```bash
npm install
npm run build            # erzeugt android/app/src/main/assets/www/game.js
cd android && ./gradlew assembleRelease
# -> android/app/build/outputs/apk/release/app-release.apk
```
Zum Testen im Browser: `android/app/src/main/assets/www/` mit einem lokalen Webserver öffnen.

## Steuerung am PC (Browser)
WASD laufen · Maus umsehen · Linksklick abbauen/angreifen · Rechtsklick platzieren/benutzen ·
Leertaste springen (2× = fliegen im Kreativmodus) · Shift schleichen · Strg sprinten · E Inventar · Q fallen lassen · 1–9 Hotbar · F3 Debug
