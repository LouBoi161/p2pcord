<p align="center">
  <img src="build/icon/icon-256x256.png" width="112" alt="P2Pcord logo">
</p>

<h1 align="center">P2Pcord</h1>

<p align="center">
  <b>Serverless voice, video and text chat for friends.</b><br>
  Inspired by Discord's layout, as simple as TeamSpeak – but peer-to-peer, end-to-end encrypted and without any account.
</p>

<p align="center">
  <a href="https://github.com/LouBoi161/p2pcord/releases/latest">Download</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#security">Security</a> ·
  <a href="#building-from-source">Build from source</a> ·
  <a href="README.de.md">Deutsch</a>
</p>

<p align="center"><sub>🤖 Built with the help of AI – developed together with <a href="https://www.anthropic.com/claude">Claude</a> (Anthropic). Every commit made with AI assistance is marked <code>Co-Authored-By: Claude</code>.</sub></p>

![P2Pcord: channels on the left, the active call in the middle, text chat on the right](docs/screenshots/call.png)

## Why

TeamSpeak is buggy, Discord reads everything, and both need servers. P2Pcord connects you and your
friends directly. There is no server that can go down, get hacked or read along.

## Features

- **Groups** with text and voice channels, roles (owner / admin / member) and an invite system
- **Friends & direct messages**, including 1:1 calls with ringing, accept and decline
- **Invite codes** via blind pairing: one person and 24 hours by default, replaced codes are revoked
- **Messages** with replies, edits, deletes and a small markdown subset (`**bold**`, `*italic*`,
  `` `code` ``, code blocks, `||spoilers||`); links open only after confirmation
- **Files, images and videos** up to 2 GB: paste, drag & drop, previews, seekable video
- **Voice**: WebRTC mesh with Opus at 64/96/128 kbps, in-band FEC, no DTX, voice activity or
  push-to-talk, per-user volume, mute/deafen and speaking indicators
- **AI noise suppression**, running locally: DeepFilterNet3 (default) or RNNoise (light)
- **Camera** (720p) and **screen sharing** (up to 1080p60 / 1440p30)
- **Key rotation**: removing someone moves the group to fresh keys automatically, so they are really out
- **Safety numbers** to verify contacts, desktop notifications and sounds
- **Streams on demand**: watch only what you click, per-viewer quality, pop-out windows, stream audio
  (Windows; Linux via PipeWire)
- **Two layouts** (like Discord or like TeamSpeak 6), color themes, custom colors, profile pictures,
  right-click menus everywhere
- **Android app**: the full P2P app on your phone, one screen at a time like Discord mobile
- **iPhone web app**: no App Store, no sideloading, free – it connects through a friend's desktop app
  (see [iPhone](#iphone))

<p align="center"><img src="docs/screenshots/settings.png" width="720" alt="Voice settings with AI noise suppression"></p>

## Installation

Download the file for your system from the
[latest release](https://github.com/LouBoi161/p2pcord/releases/latest).

| System | File | Status |
|---|---|---|
| Linux (any distro) | `P2Pcord-<version>-x64.AppImage` | ✅ tested |
| Arch Linux / Manjaro / CachyOS | `PKGBUILD` in this repo (AUR coming soon) | ✅ tested |
| Linux (manual) | `P2Pcord-linux-x64-<version>.zip` | ✅ tested |
| Windows 10/11 (x64) | `P2Pcord-win32-x64-<version>.zip` | ⚠️ experimental, unsigned |
| macOS (Apple Silicon) | `P2Pcord-darwin-arm64-<version>.zip` | ⚠️ experimental, unsigned |
| Android 10+ | `P2Pcord-<version>-android-arm64-v8a.apk` (older phones: `armeabi-v7a`) | 🧪 new |
| iPhone / iPad | web app: [p2pcord-9e78a7.gitlab.io](https://p2pcord-9e78a7.gitlab.io/) | 🧪 new, needs a bridge |

### Linux – AppImage

```sh
chmod +x P2Pcord-*-x64.AppImage
./P2Pcord-*-x64.AppImage
```

The AppImage **updates itself**: new versions are downloaded in the background, checked against the signed
release checksums and installed in place – a click on *Restart* starts the new version. The AppImage's folder
must be writable for that (e.g. `~/Applications`). All other installs show a notice when an update is out.

To get it into your app menu, either use a tool such as
[Gear Lever](https://flathub.org/apps/it.mijorus.gearlever) or AppImageLauncher, or do it by hand:

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
# icon (from the repository)
mkdir -p ~/.local/share/icons/hicolor/256x256/apps
curl -L -o ~/.local/share/icons/hicolor/256x256/apps/p2pcord.png \
  https://raw.githubusercontent.com/LouBoi161/p2pcord/main/build/icon/icon-256x256.png
```

If the AppImage does not start, install FUSE 2 (`libfuse2` on Debian/Ubuntu, `fuse2` on Arch,
`fuse-libs` on Fedora) or run it with `--appimage-extract-and-run`.

### Arch Linux

The AUR package `p2pcord-bin` is ready but not published yet (AUR registration is currently paused).
Until then, build the very same package straight from this repository:

```sh
git clone https://github.com/LouBoi161/p2pcord.git
cd p2pcord/packaging/aur/p2pcord-bin
makepkg -si
```

`makepkg` downloads the release zip, checks its SHA-256 and installs to `/opt/p2pcord` with a menu entry
and the `p2pcord` command. Once it is on the AUR, `yay -S p2pcord-bin` will do the same.

### Windows

1. Unpack `P2Pcord-win32-x64-<version>.zip`, for example to `C:\Users\<you>\P2Pcord`.
2. Start `P2Pcord.exe`. The build is not code-signed, so SmartScreen will warn:
   click **More info → Run anyway**.
3. Optional: right-click `P2Pcord.exe` → *Send to → Desktop (create shortcut)*.
4. Allow network access when the Windows firewall asks (needed for direct connections).

### macOS

1. Unpack the zip and move `P2Pcord.app` to *Applications*.
2. The build is only ad-hoc signed, so remove the download quarantine once:
   ```sh
   xattr -dr com.apple.quarantine /Applications/P2Pcord.app
   ```
3. Start it; allow microphone, camera and screen recording when asked.

### Android

1. Download `P2Pcord-<version>-android-arm64-v8a.apk` on your phone (almost every phone from the last
   years; very old ones need `armeabi-v7a`) and open it.
2. Android asks whether your browser may install apps – allow it once. The APK is signed with the
   P2Pcord release key, so later versions install over it and keep your data.
3. Allow the microphone (and camera, notifications) when P2Pcord asks.

It is the same P2P app as on the desktop: your identity lives on the phone, protected by the Android
Keystore. During a call a notification keeps it running in the background. Without a call Android may
stop the app after a while in the background, then you are offline until you open it again. Screen
sharing is not available on Android yet; watching streams is. The app checks GitHub for new versions
on start and shows a notice with the download.

### iPhone

iPhones cannot join a P2P network in the background, and apps outside the App Store cost money or need
sideloading. P2Pcord therefore runs as a **web app** on iPhones and borrows a friend's desktop app as a
**bridge**:

1. A friend opens P2Pcord on their PC: ⚙ → **iPhone bridge** → *Create code* → *Copy link* and sends you
   the link.
2. Open the link in **Safari**, tap **Share → Add to Home Screen**, then start P2Pcord from the home screen.
3. Pick a name – done. The web app finds your friend's app through public Nostr relays and connects to it
   directly (WebRTC, end-to-end encrypted).

- Your account (key pair, groups) is stored on your iPhone. On the bridge it is only kept encrypted with a
  key that never leaves your phone, and it moves with you: codes from several friends work with the same
  account, the first bridge that is online wins.
- Calls go **directly** from your iPhone to the others; only the call setup passes the bridge.
- **Limits:** at least one friend with a bridge must have P2Pcord open on their PC. iOS suspends web apps
  in the background, so there are no calls with a locked screen and no push notifications. No screen
  sharing on iOS; attachments up to 25 MB. Make a backup under ⚙ → *Web app & bridges* – deleting the
  web app deletes the account.

### First start

1. Pick a display name. A key pair is created on your device – that is your identity. No account, no password.
2. **Add a friend:** *Direct messages → Add friend → Create friend code* and send the code to your friend.
   Your friend enters it under *Redeem code*. You must be online while they redeem it.
3. **Create a group:** the **+** in the left bar. Invite people via the group menu → *Invite people*.
4. **Talk:** click a voice channel. Pick your microphone and noise suppression under ⚙ → *Voice & Video*.

## Security

| What | How |
|---|---|
| Identity | Ed25519 key pair per device, no account |
| Connections | Hyperswarm / Noise XX, bound to the peer's identity key |
| Messages & files | Each group is an encrypted Autobase; attachments live in a Hypercore encrypted with a key derived from the group key |
| Calls | WebRTC DTLS-SRTP directly between peers; SDP and fingerprints travel over the authenticated P2P channel, so there is no signaling server and no man in the middle |
| Joining | Blind pairing: an invite code contains no keys; an online member checks expiry, uses and the joiner's signature |
| Removing members | The group moves to a new base with fresh keys; every remaining member gets an invite sealed to their identity key (`crypto_box_seal`), restricted to the member list |
| Local data | Identity, group list and group keys are sealed with a vault key stored in the OS keychain (Electron `safeStorage`); opened attachments are wiped on exit |
| Updates | The AppImage only installs a release whose `SHA256SUMS` carries a valid Ed25519 signature of the release key built into the app, and only if the file's SHA-256 matches |
| App | Electron sandbox, context isolation, strict CSP, no navigation or pop-ups, attachments are never rendered as documents |

**Known limits** – please read them:

- Peers you are connected to can see your **IP address** (true for every P2P app).
- Messages are **signed**: whoever has a copy can prove which identity key wrote it. They are not deniable.
- A removed member keeps what they received **before** removal.
- Offline delivery needs at least one group member to be online.
- For calls, WebRTC asks a public **STUN** server for your public address (address lookup only, no content);
  you can change it or add your own TURN server under ⚙ → *Network*.
- When WebRTC finds no direct path (e.g. both on mobile data), the call runs through the P2P connection you
  already share: every app has its own small TURN relay listening on `127.0.0.1` only. No third-party server;
  media stays end-to-end encrypted (DTLS-SRTP).
- Android: with *Stay reachable in the background* a foreground service keeps the P2P connection so
  notifications work while the app is closed; they are decided on the phone, no push service is involved.
- Every 6 hours the app asks the **GitHub API** for the latest release (GitHub sees your IP address).
  Start it with `--no-updates` to turn that off.
- The code has **not been audited** by a third party.

**iPhone bridge** – what the friend who runs the bridge can and cannot do:

- The phone and the bridge find each other through public **Nostr relays** (`relay.damus.io`,
  `relay.primal.net`, `nostr.mom`, `relay.snort.social`, `offchain.pub`). The relays only see a random
  topic and ciphertext: offer and answer are sealed with AES-GCM using a key derived from the bridge code,
  and they carry the DTLS fingerprints, so the WebRTC data channel is end-to-end encrypted between exactly
  the phone and the bridge.
- While the phone is connected, its backend runs **on the bridge**: the bridge's app has the account key in
  memory and sees the phone's messages in plain text, like a server you trust. Only use bridges of friends.
- At rest the bridge stores the guest's identity and group list sealed with the phone's vault key, which
  it never writes to disk. Revoking a code deletes everything the guest stored there.
- Calls stay end-to-end between the phone and the other participants (DTLS-SRTP); the bridge relays the
  call setup and could in theory tamper with it.

## Noise suppression

Measured inside the app (offline rendering, clean speech plus noise from the DeepFilterNet repository):

| Filter | Pink noise, 10 dB SNR | Real-world noise, 5 dB SNR | CPU (Ryzen 7 7800X3D) |
|---|---|---|---|
| DeepFilterNet3 | −25 dB in speech pauses | −9 dB | ~7 % of one core |
| RNNoise | −22 dB | – | ~1 % |

The DeepFilterNet3 model and WebAssembly runtime are downloaded once at build time
(`scripts/fetch-models.mjs`) and pinned by SHA-256. Nothing is loaded from the network at runtime.

## Architecture

```
Renderer (Svelte, sandboxed)  ──IPC──  Electron main (thin shell)  ──pipe──  Bare worker (P2P)
  UI, WebRTC, audio pipeline           app:// + p2pfile:// protocols        Corestore, Hyperswarm,
                                        screen capture, keychain             Autobase, blind pairing
```

| Part | File | Role |
|---|---|---|
| Group logic | `workers/space.js` | Encrypted Autobase per group or DM; `apply()` enforces membership and roles deterministically on every peer |
| Backend | `workers/app.js` | Identity, groups, key rotation, files, RPC |
| Presence | `workers/presence.js` | Protomux channel: online state, voice state, WebRTC signaling |
| iPhone guests | `workers/guests.js` | Backends of bridged iPhones, each with its own identity and swarm |
| Platform bridges | `renderer/src/lib/bridges/` | The same UI on Electron, Android (WebView) and the web app |
| Bridge link | `renderer/src/lib/bridges/{nostr,tunnel,web.svelte}.ts`, `lib/bridge-host.svelte.ts` | Nostr signaling, sealed offer/answer, data channel framing |
| Android | `android/` | Java shell: Bare Kit worklet, WebView, Keystore vault, call service |
| Vault | `workers/vault.js` | At-rest encryption of local secrets |
| Schema | `schema.js` → `spec/` | HyperSchema / HyperDB / HyperDispatch (generated) |
| Calls | `renderer/src/lib/voice/` | Mesh peer connections (perfect negotiation), mic chain, Opus tuning |
| UI | `renderer/src/components/` | Rail · channel list · call · chat · dialogs · settings |

## Building from source

Requirements: **Node.js ≥ 22** and **npm** (not pnpm), git. On Linux also FUSE 2 for AppImages.

```sh
git clone https://github.com/LouBoi161/p2pcord.git
cd p2pcord
npm install --ignore-scripts        # npm ≥ 12: add --allow-git=all (Electron Forge pulls a git dependency)
node node_modules/electron/install.js
npm start                           # builds the UI and starts the app
```

| Command | Result |
|---|---|
| `npm start` | Development run (data in `~/.config/P2Pcord-dev`) |
| `npm run start:peer -- /tmp/peer2` | A second instance with its own identity, for testing |
| `npm test` | Backend tests against a local DHT testnet |
| `npm run make` | Linux: AppImage + zip in `out/make/` |
| `npm run make:win` | Windows zip (also works as a cross-build from Linux) |
| `node scripts/release-sums.mjs` | Signed `SHA256SUMS` + `SHA256SUMS.sig` for a release (needs the release key) |
| `npx electron-forge make --targets @electron-forge/maker-zip` | macOS zip (run on a Mac) |
| `npm run android` | Android APKs in `out/make/android/` (needs the Android SDK and JDK 17+) |
| `npm run build:web` | iPhone web app in `renderer/dist-web/` (GitLab CI publishes it to Pages) |

Testing without speakers or a real microphone: `P2PCORD_FAKE_MEDIA=1 npm run start:peer -- /tmp/a`.

**Android:** `npm run android` downloads the pinned Bare Kit runtime once (~400 MB, cached in
`~/.cache/p2pcord`), bundles `workers/mobile.js` with `bare-pack`, links the native addons with
`bare-link` and runs Gradle. `npm run android:debug -- --abi x86_64` builds a debug APK for the emulator;
the WebView can then be inspected via `chrome://inspect`. Release APKs are signed when
`android/keystore.properties` exists (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`).

Every push is tested in CI; tagged releases are built on GitHub Actions for Linux, Windows and macOS.

## Roadmap

- Automatic updates for the Windows and macOS builds
- Global push-to-talk while a game has focus
- Optional always-on peer (e.g. a Raspberry Pi) for offline delivery
- Reactions, typing indicator
- Android: screen sharing, self-updating APK

## Made with AI

P2Pcord was developed with the help of AI: large parts of the code, tests and documentation were written
together with [Claude](https://www.anthropic.com/claude) (Anthropic) and reviewed, tested and directed by the
maintainer. Commits made with AI assistance carry a `Co-Authored-By: Claude` trailer.

The app itself uses AI only for **local noise suppression** (DeepFilterNet3 / RNNoise). It removes background
noise from your real voice, never generates or alters speech content, runs entirely on your device and can
be switched off in the settings.

## License

[Apache-2.0](LICENSE). Third-party components are listed in [NOTICE](NOTICE).

P2Pcord is an independent project and is not affiliated with, endorsed by or sponsored by Discord Inc. or
TeamSpeak Systems GmbH. "Discord" and "TeamSpeak" are trademarks of their respective owners and are only used
to describe the kind of application.

The source is mirrored on [GitLab](https://gitlab.com/louiswalder6/p2pcord).
