# P2Pcord

Serverloser Voice-, Video- und Text-Chat für Freundesgruppen – im Stil von Discord, so schlicht wie
TeamSpeak. Läuft komplett Peer-to-Peer auf dem [Holepunch/Pear-Stack](https://docs.pears.com)
(derselbe Unterbau wie Keet), Ende-zu-Ende-verschlüsselt, mit KI-Rauschunterdrückung.

## Funktionen

- **Gruppen** mit Text- und Sprachkanälen, Rollen (Besitzer/Admin/Mitglied), Kicken
- **Freunde & Direktnachrichten** (1:1) inkl. Anrufen mit Klingeln/Annehmen/Ablehnen
- **Einladungscodes** (Blind Pairing): einmalig oder mehrfach, mit Ablaufzeit
- **Nachrichten**: Antworten, Bearbeiten, Löschen, Markdown-Light (`**fett**`, `*kursiv*`,
  `` `code` ``, Codeblöcke, `||Spoiler||`), Links mit Sicherheitsabfrage
- **Dateien, Bilder, Videos** bis 2 GB: Einfügen, Drag & Drop, Vorschau, Video mit Spulen
- **Voice** als WebRTC-Mesh mit Opus (64/96/128 kbps, FEC, kein DTX), Sprachaktivierung oder
  Push-to-Talk, Lautstärke pro Person, Stumm/Taub, Sprech-Indikator
- **KI-Rauschunterdrückung** lokal: DeepFilterNet3 (Standard) oder RNNoise (leicht)
- **Kamera** (720p) und **Bildschirm teilen** (bis 1080p60/1440p30, Windows inkl. System-Audio)
- **Sicherheitsnummern** zum Verifizieren von Kontakten, Desktop-Benachrichtigungen, Töne

## Architektur

```
Renderer (Svelte, sandboxed)  ──IPC──  Electron main (dünne Hülle)  ──pipe──  Bare-Worker (P2P)
   UI, WebRTC, Audio-Pipeline           Protokolle app:// + p2pfile://        Corestore, Hyperswarm,
                                        Screen-Capture, Berechtigungen        Autobase, Blind Pairing
```

| Teil | Datei | Aufgabe |
|---|---|---|
| Gruppen-Logik | `workers/space.js` | Verschlüsselte Autobase je Gruppe/DM; `apply()` prüft Mitgliedschaft & Rollen deterministisch auf jedem Peer |
| Backend | `workers/app.js` | Identität, Gruppenliste, Dateien, RPC-Methoden |
| Präsenz | `workers/presence.js` | Protomux-Kanal: online, Voice-Status, WebRTC-Signalisierung |
| Schema | `schema.js` → `spec/` | HyperSchema/HyperDB/HyperDispatch (generiert mit `npm run build:db`) |
| Calls | `renderer/src/lib/voice/` | Mesh-PeerConnections (Perfect Negotiation), Mikrofon-Kette, Opus-Tuning |
| UI | `renderer/src/components/` | Rail · Kanalliste · Call · Chat · Dialoge · Einstellungen |

## Sicherheitsmodell

- **Identität** = Ed25519-Schlüsselpaar pro Gerät, kein Account/Passwort.
- **Transport**: Hyperswarm/Noise-XX – jede Verbindung ist verschlüsselt und an den Identitätsschlüssel gebunden.
- **Daten**: Jede Gruppe ist eine Autobase mit `encrypt: true`; Dateien liegen in einem Hypercore,
  dessen Schlüssel vom Gruppenschlüssel abgeleitet ist.
- **Beitritt**: Blind Pairing – der Code enthält keine Schlüssel; ein Mitglied prüft die Einladung
  (Ablauf, Nutzungen, DM max. 2 Personen) und die Signatur des Beitretenden.
- **Anrufe**: DTLS-SRTP direkt zwischen den Peers. SDP/Fingerprints laufen über den authentifizierten
  Hyperswarm-Kanal → kein Man-in-the-Middle möglich, kein Signaling-Server.
- **Electron-Härtung**: `sandbox`, `contextIsolation`, strikte CSP, keine Navigation/Popups,
  Anhänge nur als Medien (nie als Dokument), Pfad-Traversal-Schutz.
- **Grenzen** (bewusst): Peers sehen gegenseitig ihre IP-Adressen. Gekickte Mitglieder behalten bereits
  empfangene Daten (Schlüsselrotation ist Roadmap). Offline-Nachrichten brauchen, dass irgendein
  Mitglied online ist. Für Anrufe wird standardmäßig ein öffentlicher STUN-Server nach der eigenen
  Adresse gefragt (nur Adressabfrage, in den Einstellungen änderbar; optional eigener TURN-Server).

## Entwicklung

Voraussetzung: Node ≥ 22, npm (kein pnpm – bricht Electron Forge).

```sh
npm install --ignore-scripts --allow-git=all   # Electron Forge zieht @electron/node-gyp aus Git
node node_modules/electron/install.js
npm start                                    # baut UI + startet (Daten: ~/.config/P2Pcord-dev)
npm run start:peer -- /tmp/peer2             # zweite Instanz mit eigener Identität zum Testen
npm test                                     # Backend-Tests gegen ein lokales DHT-Testnetz
```

Tests mit Fake-Mikrofon/-Kamera und ohne Tonausgabe: `P2PCORD_FAKE_MEDIA=1 npm run start:peer -- /tmp/a`.
Mit `P2PCORD_DEBUG_PORT=9301` lässt sich eine Dev-Instanz per Chrome DevTools Protocol steuern.

Die DeepFilterNet3-Assets (WASM + Modell, ~24 MB) lädt `scripts/fetch-models.mjs` einmalig beim Build
und prüft sie per SHA-256. Zur Laufzeit wird nichts aus dem Netz nachgeladen.

## Bauen

```sh
npm run make       # Linux AppImage  → out/make/P2Pcord-<version>-x64.AppImage
npm run make:win   # Windows (portables ZIP, Cross-Build von Linux) → out/make/zip/win32/x64/
```

P2P-Updates (OTA): `package.json#upgrade` braucht einen echten Link aus `pear touch`. Solange dort der
Platzhalter steht, ist der Updater deaktiviert.

## Rauschunterdrückung – Messwerte

Gemessen in der App (Offline-Rendering, saubere Sprache + Störgeräusch aus dem DeepFilterNet-Repo):

| Filter | Rosa Rauschen, 10 dB SNR | Echtes Störgeräusch, 5 dB SNR | CPU (Ryzen 7800X3D) |
|---|---|---|---|
| DeepFilterNet3 | −25 dB in Sprechpausen | −9 dB | ~7 % eines Kerns |
| RNNoise | −22 dB | – (Ausreißer) | ~1 % |

## Roadmap

- OTA-Updates aktivieren (`pear touch`, Multisig), macOS-Build
- Globales Push-to-Talk (auch wenn ein Spiel im Vordergrund ist)
- Optionaler Always-on-Knoten (z. B. Raspberry Pi) für Offline-Nachrichten
- Schlüsselrotation beim Kicken, Reaktionen, Tipp-Anzeige, Mobile
