// Bare Kit worklet entry on Android: the same backend as on the desktop. The
// app starts it with its private files directory as the only argument and
// relays the IPC frames to the WebView.
/* global BareKit */
const path = require('path')
const { serve } = require('./rpc')

serve(BareKit.IPC, path.join(Bare.argv[0], 'p2pcord'), { notify: true })
