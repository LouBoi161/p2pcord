<p align="center">
  <img src="build/icon/icon-256x256.png" width="112" alt="P2Pcord-Logo">
</p>

<h1 align="center">P2Pcord</h1>

<p align="center">
  <b>Serverloser Voice-, Video- und Text-Chat für Freunde.</b><br>
  Vom Aufbau her von Discord inspiriert, so einfach wie TeamSpeak – aber Peer-to-Peer, Ende-zu-Ende-verschlüsselt und ohne Account.
</p>

<p align="center">
  <a href="https://github.com/LouBoi161/p2pcord/releases/latest">Download</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#sicherheit">Sicherheit</a> ·
  <a href="#selbst-bauen">Selbst bauen</a> ·
  <a href="README.md">English</a>
</p>

<p align="center"><sub>🤖 Mit Hilfe von KI entwickelt – zusammen mit <a href="https://www.anthropic.com/claude">Claude</a> (Anthropic). Jeder Commit mit KI-Unterstützung ist mit <code>Co-Authored-By: Claude</code> gekennzeichnet.</sub></p>

![P2Pcord: links die Kanäle, in der Mitte der aktive Call, rechts der Textchat](docs/screenshots/call.png)

## Warum

TeamSpeak ist verbuggt, Discord liest alles mit, und beide brauchen Server. P2Pcord verbindet dich und
deine Freunde direkt miteinander. Es gibt keinen Server, der ausfallen, gehackt werden oder mitlesen kann.

## Funktionen

- **Gruppen** mit Text- und Sprachkanälen, Rollen (Besitzer/Admin/Mitglied) und Einladungen
- **Freunde & Direktnachrichten** inkl. Anrufen mit Klingeln, Annehmen und Ablehnen
- **Einladungscodes** per Blind Pairing: standardmäßig 1 Person und 24 Stunden, ersetzte Codes werden widerrufen
- **Nachrichten** mit Antworten, Bearbeiten, Löschen und Markdown-Light (`**fett**`, `*kursiv*`, `` `code` ``,
  Codeblöcke, `||Spoiler||`); Links öffnen erst nach Nachfrage
- **Dateien, Bilder, Videos** bis 2 GB: Einfügen, Drag & Drop, Vorschau, Video mit Spulen
- **Voice**: WebRTC-Mesh mit Opus (64/96/128 kbps), Fehlerkorrektur, Sprachaktivierung oder Push-to-Talk,
  Lautstärke pro Person, Stumm/Taub, Sprech-Anzeige
- **KI-Rauschunterdrückung** lokal: DeepFilterNet3 (Standard) oder RNNoise (leicht)
- **Kamera** (720p) und **Bildschirm teilen** (bis 1080p60 / 1440p30)
- **Schlüsselrotation**: Wer entfernt wird, ist wirklich draußen – die Gruppe zieht automatisch auf neue Schlüssel um
- **Sicherheitsnummern** zum Prüfen von Kontakten, Desktop-Benachrichtigungen, Töne
- **Streams auf Klick**: Du siehst nur, was du anklickst, Qualität pro Zuschauer, Pop-out-Fenster, Stream-Ton
  (Windows; Linux über PipeWire)
- **Zwei Layouts** (wie Discord oder wie TeamSpeak 6), Farbthemes, eigene Farben, Profilbilder,
  Rechtsklick-Menüs überall
- **Android-App**: die volle P2P-App auf dem Handy, ein Bildschirm nach dem anderen wie bei Discord mobil
- **iPhone-Web-App**: ohne App Store, ohne Sideloading, kostenlos – sie verbindet sich über die Desktop-App
  eines Freundes (siehe [iPhone](#iphone))

## Installation

Lade die passende Datei aus dem [neuesten Release](https://github.com/LouBoi161/p2pcord/releases/latest).

| System | Datei | Status |
|---|---|---|
| Linux (jede Distribution) | `P2Pcord-<version>-x64.AppImage` | ✅ getestet |
| Arch / Manjaro / CachyOS | `PKGBUILD` aus diesem Repo (AUR folgt) | ✅ getestet |
| Linux (manuell) | `P2Pcord-linux-x64-<version>.zip` | ✅ getestet |
| Windows 10/11 (x64) | `P2Pcord-win32-x64-<version>.zip` | ⚠️ experimentell, unsigniert |
| macOS (Apple Silicon) | `P2Pcord-darwin-arm64-<version>.zip` | ⚠️ experimentell, unsigniert |
| Android 10+ | `P2Pcord-<version>-android-arm64-v8a.apk` (alte Handys: `armeabi-v7a`) | 🧪 neu |
| iPhone / iPad | Web-App: [p2pcord-9e78a7.gitlab.io](https://p2pcord-9e78a7.gitlab.io/) | 🧪 neu, braucht eine Brücke |

### Linux – AppImage

```sh
chmod +x P2Pcord-*-x64.AppImage
./P2Pcord-*-x64.AppImage
```

Das AppImage **aktualisiert sich selbst**: Neue Versionen werden im Hintergrund geladen, gegen die signierten
Prüfsummen des Releases geprüft und direkt ersetzt – ein Klick auf *Neu starten* startet die neue Version. Dafür
muss der Ordner des AppImages beschreibbar sein (z. B. `~/Applications`). Alle anderen Installationen zeigen nur
einen Hinweis, wenn ein Update da ist.

Ins Startmenü bekommst du es mit [Gear Lever](https://flathub.org/apps/it.mijorus.gearlever) oder
AppImageLauncher – oder von Hand:

```sh
mkdir -p ~/Applications ~/.local/share/applications
mv P2Pcord-*-x64.AppImage ~/Applications/P2Pcord.AppImage
cat > ~/.local/share/applications/p2pcord.desktop <<EOF
[Desktop Entry]
Type=Application
Name=P2Pcord
Exec=$HOME/Applications/P2Pcord.AppImage %U
Icon=p2pcord
Categories=Network;Chat;InstantMessaging;
StartupWMClass=P2Pcord
EOF
mkdir -p ~/.local/share/icons/hicolor/256x256/apps
curl -L -o ~/.local/share/icons/hicolor/256x256/apps/p2pcord.png \
  https://raw.githubusercontent.com/LouBoi161/p2pcord/main/build/icon/icon-256x256.png
```

Startet das AppImage nicht, installiere FUSE 2 (`libfuse2` unter Debian/Ubuntu, `fuse2` unter Arch,
`fuse-libs` unter Fedora) oder starte es mit `--appimage-extract-and-run`.

### Arch Linux

Das AUR-Paket `p2pcord-bin` ist fertig, aber noch nicht veröffentlicht (die AUR-Registrierung ist gerade
pausiert). Bis dahin baust du genau dasselbe Paket direkt aus diesem Repo:

```sh
git clone https://github.com/LouBoi161/p2pcord.git
cd p2pcord/packaging/aur/p2pcord-bin
makepkg -si
```

`makepkg` lädt das Release-ZIP, prüft die SHA-256-Prüfsumme und installiert nach `/opt/p2pcord` mit
Startmenü-Eintrag und dem Befehl `p2pcord`. Sobald es im AUR ist, geht das auch mit `yay -S p2pcord-bin`.

### Windows

1. `P2Pcord-win32-x64-<version>.zip` entpacken, z. B. nach `C:\Users\<du>\P2Pcord`.
2. `P2Pcord.exe` starten. Der Build ist nicht signiert, daher warnt SmartScreen:
   **Weitere Informationen → Trotzdem ausführen**.
3. Optional: Rechtsklick auf `P2Pcord.exe` → *Senden an → Desktop (Verknüpfung erstellen)*.
4. Netzwerkzugriff erlauben, wenn die Windows-Firewall fragt (nötig für direkte Verbindungen).

### macOS

1. ZIP entpacken und `P2Pcord.app` nach *Programme* verschieben.
2. Der Build ist nur ad-hoc signiert, daher einmal die Download-Quarantäne entfernen:
   ```sh
   xattr -dr com.apple.quarantine /Applications/P2Pcord.app
   ```
3. Starten und Mikrofon, Kamera und Bildschirmaufnahme erlauben.

### Android

1. `P2Pcord-<version>-android-arm64-v8a.apk` auf dem Handy herunterladen (passt für praktisch alle Handys der
   letzten Jahre; sehr alte brauchen `armeabi-v7a`) und öffnen.
2. Android fragt, ob dein Browser Apps installieren darf – einmal erlauben. Die APK ist mit dem
   P2Pcord-Release-Schlüssel signiert, spätere Versionen installieren sich darüber und behalten deine Daten.
3. Mikrofon (und Kamera, Benachrichtigungen) erlauben, wenn P2Pcord fragt.

Es ist dieselbe P2P-App wie am PC: Deine Identität liegt auf dem Handy, geschützt durch den Android-Keystore.
Während eines Anrufs hält eine Benachrichtigung die App im Hintergrund am Laufen. Ohne Anruf beendet Android
die App nach einer Weile im Hintergrund, dann bist du offline, bis du sie wieder öffnest. Bildschirm teilen
geht auf Android noch nicht, Streams anschauen schon. Beim Start fragt die App GitHub nach neuen Versionen und
zeigt einen Hinweis mit Download.

**Mit F-Droid** (automatische Updates): <https://louiswalder6.gitlab.io/p2pcord-fdroid/> auf dem Handy öffnen
und *Repo zu F-Droid hinzufügen* antippen, oder unter *Einstellungen → Paketquellen → +* diese Adresse eintragen:

    https://louiswalder6.gitlab.io/p2pcord-fdroid/repo?fingerprint=2434F7CADD4103F469EC50F3215BEE8436975C777BDD54E9CF58B696FFF20182

Dort liegen dieselben signierten APKs, eine schon installierte App aktualisiert sich also auch über F-Droid.

### iPhone

iPhones können nicht im Hintergrund in ein P2P-Netz, und Apps außerhalb des App Stores kosten Geld oder
brauchen Sideloading. Deshalb läuft P2Pcord auf dem iPhone als **Web-App** und nutzt die Desktop-App eines
Freundes als **Brücke**:

1. Ein Freund öffnet P2Pcord am PC: ⚙ → **iPhone-Brücke** → *Code erstellen* → *Link kopieren* und schickt dir
   den Link.
2. Link in **Safari** öffnen, **Teilen → Zum Home-Bildschirm** tippen und P2Pcord vom Home-Bildschirm starten.
3. Namen wählen – fertig. Die Web-App findet die App deines Freundes über öffentliche Nostr-Relays und
   verbindet sich direkt mit ihr (WebRTC, Ende-zu-Ende verschlüsselt).

- Dein Konto (Schlüsselpaar, Gruppen) liegt auf deinem iPhone. Auf der Brücke liegt es nur verschlüsselt mit
  einem Schlüssel, der dein iPhone nie verlässt, und es zieht mit: Codes von mehreren Freunden funktionieren
  mit demselben Konto, die erste Brücke, die online ist, gewinnt.
- Anrufe laufen **direkt** von deinem iPhone zu den anderen, nur der Verbindungsaufbau läuft über die Brücke.
- **Grenzen:** Mindestens ein Freund mit Brücke muss P2Pcord am PC offen haben. iOS beendet Web-Apps im
  Hintergrund, also keine Anrufe bei gesperrtem Bildschirm und keine Push-Benachrichtigungen. Kein
  Bildschirm teilen auf iOS, Anhänge bis 25 MB. Mach unter ⚙ → *Web-App & Brücken* eine Sicherung – wer die
  Web-App löscht, löscht auch das Konto.

#### Brücke ohne Desktop-App (Server)

Damit die iPhones nicht davon abhängen, dass jemand den PC anhat, läuft die Brücke auch ohne Oberfläche auf
einem Rechner, der immer an ist (Heimserver, Raspberry Pi, VPS) – nur mit Node.js 22.18+ (x64 oder arm64):

```sh
git clone https://gitlab.com/louiswalder6/p2pcord.git && cd p2pcord
npm install --ignore-scripts
node cli/bridge.mjs add "Lenas iPhone"   # zeigt den Link fürs iPhone
node cli/bridge.mjs run                  # Brücke starten (Strg+C beendet)
```

Weitere Befehle: `list`, `revoke <code|name>` (löscht auch alles, was das iPhone dort gespeichert hat). Codes
lassen sich anlegen und widerrufen, während die Brücke läuft. Daten liegen in `~/.local/share/p2pcord-bridge`
(`--storage <ordner>`), bis zu 8 iPhones gleichzeitig (`--max-guests <n>`). Keine Portfreigabe nötig. Als
Dienst mit Autostart: [`packaging/p2pcord-bridge.service`](packaging/p2pcord-bridge.service). Für den
Server-Betreiber gilt dasselbe wie für jeden Brücken-Betreiber (siehe [Sicherheit](#sicherheit)).

### Erster Start

1. Namen wählen. Auf deinem Gerät entsteht ein Schlüsselpaar – das ist deine Identität. Kein Account, kein Passwort.
2. **Freund hinzufügen:** *Direktnachrichten → Freund hinzufügen → Freundescode erstellen* und den Code schicken.
   Dein Freund gibt ihn unter *Code einlösen* ein. Du musst dabei online sein.
3. **Gruppe erstellen:** das **+** in der linken Leiste. Einladen über das Gruppenmenü → *Leute einladen*.
4. **Reden:** Sprachkanal anklicken. Mikrofon und Rauschfilter unter ⚙ → *Sprache & Video*.

## Sicherheit

| Was | Wie |
|---|---|
| Identität | Ed25519-Schlüsselpaar pro Gerät, kein Account |
| Verbindungen | Hyperswarm / Noise XX, an den Schlüssel des Gegenübers gebunden |
| Nachrichten & Dateien | Jede Gruppe ist eine verschlüsselte Autobase; Anhänge liegen in einem Hypercore mit abgeleitetem Gruppenschlüssel |
| Anrufe | WebRTC DTLS-SRTP direkt zwischen den Peers; SDP und Fingerprints laufen über den authentifizierten P2P-Kanal – kein Signaling-Server, kein Man-in-the-Middle |
| Beitritt | Blind Pairing: Codes enthalten keine Schlüssel; ein Mitglied prüft Ablauf, Nutzungen und Signatur |
| Entfernen | Die Gruppe zieht auf eine neue Base mit neuen Schlüsseln; jedes verbleibende Mitglied bekommt eine an seinen Identitätsschlüssel versiegelte Einladung (`crypto_box_seal`), beschränkt auf die Mitgliederliste |
| Lokale Daten | Identität, Gruppenliste und Gruppenschlüssel sind mit einem Tresor-Schlüssel aus dem System-Schlüsselbund versiegelt (Electron `safeStorage`); geöffnete Anhänge werden beim Beenden gelöscht |
| Updates | Das AppImage installiert nur Releases, deren `SHA256SUMS` eine gültige Ed25519-Signatur des in der App hinterlegten Release-Schlüssels trägt, und nur wenn die SHA-256 der Datei stimmt |
| App | Electron-Sandbox, Context Isolation, strikte CSP, keine Navigation/Popups, Anhänge nie als Dokument |

**Bekannte Grenzen** – bitte lesen:

- Verbundene Peers sehen deine **IP-Adresse** (gilt für jede P2P-App).
- Nachrichten sind **signiert**: Wer eine Kopie hat, kann belegen, welcher Schlüssel sie geschrieben hat. Sie sind nicht abstreitbar.
- Wer entfernt wird, behält, was er **vorher** empfangen hat.
- Nachrichten an Offline-Leute brauchen mindestens ein Mitglied, das online ist.
- Für Anrufe fragt WebRTC einen öffentlichen **STUN**-Server nach deiner Adresse (nur Adresse, keine Inhalte);
  änderbar unter ⚙ → *Netzwerk*, optional mit eigenem TURN-Server.
- Findet WebRTC keinen direkten Weg (z. B. beide im Mobilfunk), läuft der Anruf über eure bestehende
  P2P-Verbindung: jede App hat dafür einen eigenen kleinen TURN-Relay, der nur auf `127.0.0.1` lauscht.
  Kein fremder Server, die Medien bleiben Ende-zu-Ende verschlüsselt (DTLS-SRTP).
- Android: Mit *Im Hintergrund erreichbar bleiben* hält ein Vordergrund-Dienst die P2P-Verbindung, damit
  Benachrichtigungen auch bei geschlossener App kommen; sie entstehen auf dem Handy, ohne Push-Dienst.
- Alle 6 Stunden fragt die App die **GitHub-API** nach dem neuesten Release (GitHub sieht dabei deine IP-Adresse).
  Mit `--no-updates` gestartet, lässt sie das.
- Der Code wurde **nicht unabhängig geprüft** (kein Audit).

**iPhone-Brücke** – was der Freund, der die Brücke betreibt, kann und was nicht:

- iPhone und Brücke finden sich über öffentliche **Nostr-Relays** (`relay.damus.io`, `relay.primal.net`,
  `nostr.mom`, `relay.snort.social`, `offchain.pub`). Die sehen nur ein zufälliges Thema und Chiffretext:
  Angebot und Antwort sind mit AES-GCM und einem aus dem Brücken-Code abgeleiteten Schlüssel versiegelt und
  enthalten die DTLS-Fingerprints, der WebRTC-Datenkanal ist also Ende-zu-Ende verschlüsselt zwischen genau
  dem iPhone und der Brücke.
- Solange das iPhone verbunden ist, läuft sein Backend **auf der Brücke**: Die App dort hat den Kontoschlüssel
  im Speicher und sieht die Nachrichten des iPhones im Klartext – wie ein Server, dem man vertraut. Nutze nur
  Brücken von Freunden.
- Gespeichert liegen Identität und Gruppenliste des Gasts auf der Brücke nur versiegelt mit dem
  Tresor-Schlüssel des iPhones, den sie nie auf die Platte schreibt. Wird ein Code widerrufen, löscht die
  Brücke alles, was der Gast dort hatte.
- Anrufe bleiben Ende-zu-Ende zwischen dem iPhone und den anderen (DTLS-SRTP); die Brücke leitet nur den
  Verbindungsaufbau weiter und könnte ihn theoretisch manipulieren.

## Rauschunterdrückung

| Filter | Rosa Rauschen, 10 dB SNR | Echtes Störgeräusch, 5 dB SNR | CPU (Ryzen 7 7800X3D) |
|---|---|---|---|
| DeepFilterNet3 | −25 dB in Sprechpausen | −9 dB | ~7 % eines Kerns |
| RNNoise | −22 dB | – | ~1 % |

## Selbst bauen

Voraussetzungen: **Node.js ≥ 22**, **npm** (kein pnpm), git; unter Linux für AppImages zusätzlich FUSE 2.

```sh
git clone https://github.com/LouBoi161/p2pcord.git
cd p2pcord
npm install --ignore-scripts        # ab npm 12 zusätzlich: --allow-git=all
node node_modules/electron/install.js
npm start
```

| Befehl | Ergebnis |
|---|---|
| `npm start` | Entwicklungsstart (Daten in `~/.config/P2Pcord-dev`) |
| `npm run start:peer -- /tmp/peer2` | Zweite Instanz mit eigener Identität zum Testen |
| `npm test` | Backend-Tests gegen ein lokales DHT-Testnetz |
| `npm run make` | Linux: AppImage + ZIP in `out/make/` |
| `npm run make:win` | Windows-ZIP (auch als Cross-Build unter Linux) |
| `node scripts/release-sums.mjs` | Signierte `SHA256SUMS` + `SHA256SUMS.sig` für ein Release (braucht den Release-Schlüssel) |
| `npx electron-forge make --targets @electron-forge/maker-zip` | macOS-ZIP (auf einem Mac) |
| `npm run android` | Android-APKs in `out/make/android/` (braucht Android-SDK und JDK 17+) |
| `npm run build:web` | iPhone-Web-App in `renderer/dist-web/` (GitLab-CI veröffentlicht sie auf Pages) |

Mehr zu Architektur und Details steht in der [englischen README](README.md#architecture).

## Mit KI entwickelt

P2Pcord wurde mit Hilfe von KI entwickelt: Große Teile von Code, Tests und Dokumentation sind zusammen mit
[Claude](https://www.anthropic.com/claude) (Anthropic) entstanden und wurden vom Maintainer gesteuert, geprüft
und getestet. Commits mit KI-Unterstützung tragen den Vermerk `Co-Authored-By: Claude`.

Die App selbst nutzt KI nur für die **lokale Rauschunterdrückung** (DeepFilterNet3 / RNNoise). Sie entfernt
Hintergrundgeräusche aus deiner echten Stimme, erzeugt oder verändert keine Sprachinhalte, läuft komplett auf
deinem Gerät und lässt sich in den Einstellungen abschalten.

## Lizenz

[Apache-2.0](LICENSE). Drittkomponenten stehen in [NOTICE](NOTICE).

P2Pcord ist ein unabhängiges Projekt und steht in keiner Verbindung zu Discord Inc. oder der TeamSpeak Systems
GmbH und wird von diesen weder unterstützt noch gesponsert. „Discord“ und „TeamSpeak“ sind Marken ihrer
jeweiligen Inhaber und werden nur verwendet, um die Art der Anwendung zu beschreiben. Spiegel auf
[GitLab](https://gitlab.com/louiswalder6/p2pcord).
