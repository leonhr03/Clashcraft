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
- Dschungel-Biom mit hohen Tropenbäumen und Büschen
- Bauwerke (eigene Designs): Dörfer mit Häusern, Feldern, Schmiede, Brunnen und Dorfbewohnern (Ebene, Wüste, Taiga),
  Wüstentempel mit verstecktem Schatzraum, Dschungeltempel mit Keller, Untergrundfestung mit Bibliothek, Brunnenraum und Portalraum
- Unterwelt (Glutportal: 8 Obsidian + Leuchtkristall): Glutgestein, Aschesand, Lavameere, Glutquarz, Glutfestungen mit Brücken und Türmen
- Leere (Portal in der Untergrundfestung): schwebende Inseln, Rückkehrportal, Sternenstädte mit wertvoller Beute
- Entdeckerkompass (Eisen + Lapis): zeigt Entfernung und Richtung zu den nächsten Bauwerken
- Speichern mehrerer Welten (automatisch)
- Touch-Steuerung: Joystick links, Umsehen rechts wischen, Tippen = Benutzen/Platzieren/Angreifen, Halten = Abbauen

## Block-Arena (Kartenkampf)
Neuer Spielmodus im Hauptmenü: **⚔ Block-Arena**. Ein 3D-Echtzeit-Kartenspiel auf einem Spielfeld aus Blöcken –
die Mobs aus Blockwelt sind die Karten.
- Zwei Bahnen mit Brücken über einen Fluss, je Seite zwei Wachtürme (Skelett-Schütze) und ein Königsturm (Dorfkönig)
- Energie (max. 10) lädt sich auf; in der letzten Minute doppelt so schnell. 3 Minuten + Verlängerung (nächster Turm entscheidet)
- 13 Karten: Zombie, Skelett-Schützen, Spinne, Aschezombie, Glutskelett, Leerenkrabbler, Kuh-Koloss, Schweinebande,
  Hühnerschwarm (fliegt), Wollschaf, Kürbiswerfer, Zauber Pulverfass und Pfeilhagel
- Eigenes 8er-Deck zusammenstellen, Computergegner in 3 Stufen, Pokale für Siege
- Karte aufs Feld ziehen (oder antippen und dann aufs Feld tippen). Nach Zerstörung eines Gegnerturms darfst du weiter vorne ausspielen.
- Alles nutzt die eigenen, prozedural erzeugten Blockwelt-Texturen und -Modelle (keine fremden Assets).

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
