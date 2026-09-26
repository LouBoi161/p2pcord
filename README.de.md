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

## Installation

Lade die passende Datei aus dem [neuesten Release](https://github.com/LouBoi161/p2pcord/releases/latest).

| System | Datei | Status |
|---|---|---|
| Linux (jede Distribution) | `P2Pcord-<version>-x64.AppImage` | ✅ getestet |
| Arch / Manjaro / CachyOS | `PKGBUILD` aus diesem Repo (AUR folgt) | ✅ getestet |
| Linux (manuell) | `P2Pcord-linux-x64-<version>.zip` | ✅ getestet |
| Windows 10/11 (x64) | `P2Pcord-win32-x64-<version>.zip` | ⚠️ experimentell, unsigniert |
| macOS (Apple Silicon) | `P2Pcord-darwin-arm64-<version>.zip` | ⚠️ experimentell, unsigniert |

### Linux – AppImage

```sh
chmod +x P2Pcord-*-x64.AppImage
./P2Pcord-*-x64.AppImage
```

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
| App | Electron-Sandbox, Context Isolation, strikte CSP, keine Navigation/Popups, Anhänge nie als Dokument |

**Bekannte Grenzen** – bitte lesen:

- Verbundene Peers sehen deine **IP-Adresse** (gilt für jede P2P-App).
- Nachrichten sind **signiert**: Wer eine Kopie hat, kann belegen, welcher Schlüssel sie geschrieben hat. Sie sind nicht abstreitbar.
- Wer entfernt wird, behält, was er **vorher** empfangen hat.
- Nachrichten an Offline-Leute brauchen mindestens ein Mitglied, das online ist.
- Für Anrufe fragt WebRTC einen öffentlichen **STUN**-Server nach deiner Adresse (nur Adresse, keine Inhalte);
  änderbar unter ⚙ → *Netzwerk*, optional mit eigenem TURN-Server.
- Der Code wurde **nicht unabhängig geprüft** (kein Audit).

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
| `npx electron-forge make --targets @electron-forge/maker-zip` | macOS-ZIP (auf einem Mac) |

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
