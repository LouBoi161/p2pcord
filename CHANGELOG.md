# Changelog

## v0.3.0

- **Android app**: the full P2P app on the phone (the same backend in a Bare Kit worklet, the same UI in a
  WebView), one screen at a time like Discord mobile, back button, notifications for new messages, a call
  keeps running in the background, local data sealed with a key from the Android Keystore, attachments are
  saved to *Downloads/P2Pcord*; APKs for arm64, armv7 and x86_64, signed with the release key
- **iPhone web app** on GitLab Pages (add it to the home screen): it connects through a friend's desktop app
  (*⚙ → iPhone bridge*), found via public Nostr relays and linked by an end-to-end encrypted WebRTC data
  channel. The account stays on the iPhone and is only kept sealed on the bridge; several bridges work with
  the same account; calls go directly from the iPhone to the others; account backup and restore
- Desktop: *iPhone bridge* settings to create, share and revoke bridge codes (revoking deletes what the guest
  stored)
- Long press opens the context menus on touch screens; mobile settings as a list with pages
- Phones default to RNNoise (DeepFilterNet3 stays selectable)

## v0.2.0

- The AppImage updates itself: new releases are downloaded in the background, verified against the signed
  `SHA256SUMS` and installed with one click on *Restart*; other installs show a notice
- *Check for updates* in the settings sidebar
- Voice no longer sounds choppy: the voice gate runs on the audio thread with 30 ms lookahead, hysteresis and a
  longer hold; the mic chain gets a larger buffer while AI noise suppression runs; optional receive buffer
- Streams are opt-in: click *Watch stream* to see one, stop watching any time; nothing is sent to people
  who do not watch
- Per-viewer stream quality (source, 1080p … 360p), stream volume and mute, pop-out window for streams
- Stream audio on Linux via PipeWire (venmic), without your own call audio; audio toggle when sharing
- Screen sharing keeps the monitor's shape (portrait, 4:3, ultrawide) instead of squeezing it into 16:9
- Call tiles adapt to the window shape; call and chat stack on narrow or portrait windows; chat, channel
  list and channel sections can be collapsed; minimum window size 640 × 480
- Right-click menus everywhere: messages (copy text/selection/link, quote, reply, edit, delete), people
  (volume, mute for me, stream options, profile), channels, groups, direct messages; spelling suggestions
  and cut/copy/paste in text fields
- Layouts like Discord or like TeamSpeak 6, asked on first start; seven color themes, custom colors,
  shareable theme codes, message styles (cozy, bubbles, compact), zoom
- New sound set with three sound packs, more events (stream start, viewers, ringback while calling, lost
  connection, push-to-talk), volume and per-event switches; sounds follow the output device
- Profile pictures (crop and zoom, shared only with friends, cached for offline) and avatar colors
- Fix: two people joining a voice channel at the same moment did not connect

## v0.1.1

- Remove friends from the DM list or the chat header, including entries still waiting for the friend code to be redeemed
- Camera falls back to the default device when the saved one is gone; clearer camera error messages
- Microphone sensitivity is set directly on the level meter of the mic test
- Screen sharing on Wayland asks the portal only once per session
- License notice for the Lucide/Feather icons, disclaimer regarding Discord/TeamSpeak

## v0.1.0 – first public release

- Groups with text and voice channels, roles, invites (blind pairing)
- Friends and direct messages, 1:1 calls with ringing
- Messages with replies, edits, deletes, markdown subset; files, images and videos up to 2 GB
- WebRTC mesh voice (Opus up to 128 kbps), camera, screen sharing
- Local AI noise suppression: DeepFilterNet3 and RNNoise
- Key rotation when members are removed; restricted, sealed invites for remaining members
- Local data sealed with a vault key kept in the OS keychain
- Linux AppImage and zip, AUR package `p2pcord-bin`; experimental Windows and macOS builds
