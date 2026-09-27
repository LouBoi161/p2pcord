// Opus tuning. fmtp parameters in *our* description tell the remote encoder
// what we want to receive: high bitrate, in-band FEC against packet loss, no
// DTX (it clips the start of words), fullband. Stereo is allowed so shared
// screen audio (music, games) keeps its stereo image; voice is sent as a mono
// track and stays mono.
export function tuneOpus (sdp: string, kbps: number): string {
  const match = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i)
  if (!match) return sdp
  const pt = match[1]
  const params: Record<string, string> = {
    minptime: '10',
    useinbandfec: '1',
    usedtx: '0',
    maxaveragebitrate: String(kbps * 1000),
    maxplaybackrate: '48000',
    'sprop-maxcapturerate': '48000',
    stereo: '1',
    'sprop-stereo': '1',
    cbr: '0'
  }
  const fmtpRe = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`, 'g')
  if (fmtpRe.test(sdp)) {
    return sdp.replace(fmtpRe, (_line, existing: string) => {
      const merged: Record<string, string> = {}
      for (const kv of existing.split(';')) {
        const [k, v] = kv.split('=')
        if (k && v !== undefined) merged[k.trim()] = v.trim()
      }
      Object.assign(merged, params)
      return `a=fmtp:${pt} ` + Object.entries(merged).map(([k, v]) => `${k}=${v}`).join(';')
    })
  }
  return sdp.replace(new RegExp(`(a=rtpmap:${pt} opus/48000/2\\r?\\n)`, 'i'), `$1a=fmtp:${pt} ` + Object.entries(params).map(([k, v]) => `${k}=${v}`).join(';') + '\r\n')
}
