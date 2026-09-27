import { isIP } from 'node:net';

export type ProxyTrustConfig = {
  enabled: boolean;
  trustedPeers: readonly string[];
};

type Environment = Record<string, string | undefined>;

export function proxyTrustConfig(environment: Environment = process.env): ProxyTrustConfig {
  const mode = environment.SCO_TRUST_PROXY;
  const configuredPeers = environment.SCO_TRUSTED_PROXY_PEERS;

  if (mode === undefined || mode === '' || mode === 'false') {
    if (configuredPeers !== undefined) throw new Error('SCO_TRUSTED_PROXY_PEERS requires SCO_TRUST_PROXY=trusted-peers');
    return { enabled: false, trustedPeers: [] };
  }

  if (mode !== 'trusted-peers') throw new Error('SCO_TRUST_PROXY must be false or trusted-peers');
  if (!configuredPeers) throw new Error('SCO_TRUSTED_PROXY_PEERS is required when proxy trust is enabled');

  const trustedPeers = configuredPeers.split(',');
  if (trustedPeers.some((peer) => !peer || peer.trim() !== peer || isIP(peer) === 0)) {
    throw new Error('SCO_TRUSTED_PROXY_PEERS must be a comma-separated list of IP addresses');
  }
  if (new Set(trustedPeers).size !== trustedPeers.length) throw new Error('SCO_TRUSTED_PROXY_PEERS must not contain duplicates');

  return { enabled: true, trustedPeers };
}