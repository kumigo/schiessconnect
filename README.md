# Schießconnect Foto

Web-App fürs Handy: Foto von der Zielscheibe machen, die App erkennt die Einschüsse und rechnet im
Einschießmodus aus, wie viele Klicks am Zielfernrohr nötig sind, damit die Treffer auf den weißen
Punkt wandern. Läuft im Browser, braucht keinen App-Store und funktioniert nach dem ersten Öffnen
auch ohne Netz am Schießstand.

## So geht's

1. **Einstellungen** (Zahnrad): Breite und Höhe der Scheibe in cm, Entfernung, Kaliber
   (Liste der gängigen Kaliber oder eigenes Geschossmaß) und Klickwert des Zielfernrohrs (z. B. 0,1 MRAD oder 0,25 MOA). Wird im Handy gespeichert.
   Unter **Optik** sind das Steiner Ranger 6 (0,1 MRAD) und der Wärmebild-Vorsatz Hikmicro Thunder 3.0
   TQ50C (1,3 cm / 100 m pro Klick) hinterlegt; der Klickwert lässt sich auch in cm / 100 m eintragen.
2. **Foto aufnehmen**: Scheibe möglichst gerade von vorn fotografieren, alle 4 Ecken im Bild.
   Je größer die Scheibe im Bild ist, desto sicherer werden die Löcher erkannt. Auf 100 m reicht
   der Handy-Zoom dafür nicht: zur Scheibe gehen oder durchs Spektiv fotografieren.
3. **Ecken antippen**: die 4 Ecken der Scheibe in beliebiger Reihenfolge antippen. Beim Ziehen
   zeigt eine Lupe die genaue Stelle.
4. **Trefferbild**: Einschüsse sind rot umkreist, dazu Anzahl und Streukreis.
   Roten Kreis antippen = entfernen, freie Stelle antippen = Treffer hinzufügen. Mit dem Regler
   „Empfindlichkeit“ findet die App mehr oder weniger.
5. **Einschießen**: der weiße Punkt wird automatisch gesucht (sonst „Punkt setzen“ und antippen).
   Angezeigt werden die Klicks, z. B. „4 Klicks HOCH, 3 Klicks LINKS“. Gerechnet wird mit dem
   mittleren Treffpunkt aller markierten Schüsse.

6. **Flugbahn**: Munition wählen oder V0, BC (G1), Geschossgewicht und Visierhöhe eintragen. Die
   Tabelle zeigt für 50 bis 300 m, wie hoch oder tief das Geschoss trifft, wie viele Klicks man
   verstellen müsste, Geschwindigkeit und Energie. „GEE einstellen“ sucht die Fleckentfernung, bei
   der die Flugbahn höchstens 4 cm über den Haltepunkt steigt. Liegt der Fleck nicht auf der
   Schussentfernung, rechnet das Einschießen auf den passenden Soll-Treffpunkt über dem weißen
   Punkt (blauer Kreis). Gerechnet wird mit G1-Luftwiderstand bei Normalluft; das sind Richtwerte.

**Wärmebild-Vorsatz einschießen:** Hinter den weißen Punkt eine Wärmequelle kleben (z. B. ein
Handwärmer-Pad), mit Vorsatz auf den Punkt schießen, bei Tageslicht fotografieren und unter Optik den
Vorsatz wählen. Die Klicks gelten dann für das Einschießmenü des Vorsatzgeräts.

Die Rechnung ist dieselbe wie in der Kamera-Version: 1 MRAD = 10 cm auf 100 m, 1 MOA = 2,908 cm
auf 100 m. Man dreht in die Richtung, in die der Treffpunkt wandern soll.

## Aufs iPhone

1. In Safari https://kumigo.github.io/schiessconnect/ öffnen.
2. Teilen-Knopf → „Zum Home-Bildschirm“.
3. Einmal vom Home-Bildschirm starten, solange noch Netz da ist. Danach läuft die App auch ohne Empfang.

## Starten

Die App besteht nur aus statischen Dateien. Zum Ausprobieren am Rechner:

```
python3 -m http.server 8000
```

und `http://localhost:8000` öffnen. Fürs Handy die Dateien auf einen Webserver mit HTTPS legen,
z. B. GitHub Pages. Danach im Handybrowser „Zum Startbildschirm hinzufügen“, dann startet sie
wie eine App.

## Tests

```
npm test
```

Die Tests erzeugen künstliche, schräg aufgenommene und unscharfe Scheibenfotos mit bekannten
Einschüssen und prüfen Entzerrung, Lochsuche, weißen Punkt und Klickrechnung.

## Dateien

- `ballistics.js`: Flugbahn mit G1-Luftwiderstand und GEE
- `core.js`: Rechenkern (Entzerren, Löcher und weißen Punkt finden, Klicks), ohne Browser-Abhängigkeit
- `app.js`, `index.html`, `style.css`: Oberfläche
- `sw.js`, `manifest.webmanifest`, `icon*`: Offline-Betrieb und Installation auf dem Startbildschirm
- `tests/`: Tests mit künstlichen Scheibenfotos
