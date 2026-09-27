// Bare worker entry on the desktop: runs the P2Pcord backend and answers
// JSON-RPC frames from the renderer (relayed byte-for-byte by Electron main).
const path = require('path')
const { serve } = require('./rpc')

serve(Bare.IPC, path.join(Bare.argv[2], 'p2pcord'), { guests: true })
