/**
 * The EPG key used for a channel: the provider's tvg/epg id when present,
 * otherwise a synthetic per-channel key (used when hydrating Xtream EPG for
 * channels without an epg_channel_id). Main and renderer must agree on this.
 */
export function effectiveEpgChannelId(channel: {
  id: number
  epgChannelId: string | null
}): string {
  return channel.epgChannelId ?? `ch#${channel.id}`
}
