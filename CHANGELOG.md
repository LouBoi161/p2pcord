# Changelog

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
