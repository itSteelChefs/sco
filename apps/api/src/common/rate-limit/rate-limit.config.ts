export type RateLimitPolicy = {
  limit: number;
  windowMilliseconds: number;
};

import { proxyTrustConfig } from './proxy-trust.config.js';

export type RateLimitConfig = {
  enabled: boolean;
  application: RateLimitPolicy;
  authentication: RateLimitPolicy;
  health: RateLimitPolicy;
  maximumClients: number;
  clientIdentity: 'direct-peer' | 'trusted-proxy';
  trustedProxyPeers: readonly string[];
};

function positiveInteger(value: string | undefined, name: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!value || !/^[1-9][0-9]*$/.test(value)) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe positive integer`);
  return parsed;
}

export function rateLimitConfig(environment: NodeJS.ProcessEnv = process.env): RateLimitConfig {
  const deployment = environment.SCO_DEPLOY_ENVIRONMENT ?? environment.NODE_ENV ?? 'development';
  const requiresExplicitConfiguration = deployment === 'staging' || deployment === 'production';
  const enabled = environment.SCO_RATE_LIMIT_ENABLED !== 'false';
  const proxyTrust = proxyTrustConfig(environment);
  const required = [
    'SCO_RATE_LIMIT_MAX',
    'SCO_RATE_LIMIT_WINDOW_MS',
    'SCO_RATE_LIMIT_AUTH_MAX',
    'SCO_RATE_LIMIT_AUTH_WINDOW_MS',
    'SCO_RATE_LIMIT_HEALTH_MAX',
    'SCO_RATE_LIMIT_HEALTH_WINDOW_MS',
  ];
  if (requiresExplicitConfiguration && enabled && required.some((name) => !environment[name])) {
    throw new Error(`${required.join(', ')} are required for staging and production`);
  }
  const clientIdentity = environment.SCO_RATE_LIMIT_CLIENT_IDENTITY ?? 'direct-peer';
  if (clientIdentity !== 'direct-peer' && clientIdentity !== 'trusted-proxy') {
    throw new Error('SCO_RATE_LIMIT_CLIENT_IDENTITY must be direct-peer or trusted-proxy');
  }
  if (proxyTrust.enabled !== (clientIdentity === 'trusted-proxy')) {
    throw new Error('SCO_RATE_LIMIT_CLIENT_IDENTITY must match the proxy trust configuration');
  }
  if (requiresExplicitConfiguration && enabled && !environment.SCO_RATE_LIMIT_CLIENT_IDENTITY) {
    throw new Error('SCO_RATE_LIMIT_CLIENT_IDENTITY is required for staging and production');
  }
  const maximumClients = positiveInteger(environment.SCO_RATE_LIMIT_MAX_CLIENTS, 'SCO_RATE_LIMIT_MAX_CLIENTS', 10_000);
  if (maximumClients > 100_000) throw new Error('SCO_RATE_LIMIT_MAX_CLIENTS must not exceed 100000');
  return {
    enabled,
    application: {
      limit: positiveInteger(environment.SCO_RATE_LIMIT_MAX, 'SCO_RATE_LIMIT_MAX', deployment === 'test' ? 10_000 : 120),
      windowMilliseconds: positiveInteger(environment.SCO_RATE_LIMIT_WINDOW_MS, 'SCO_RATE_LIMIT_WINDOW_MS', 60_000),
    },
    authentication: {
      limit: positiveInteger(environment.SCO_RATE_LIMIT_AUTH_MAX, 'SCO_RATE_LIMIT_AUTH_MAX', deployment === 'test' ? 10_000 : 20),
      windowMilliseconds: positiveInteger(environment.SCO_RATE_LIMIT_AUTH_WINDOW_MS, 'SCO_RATE_LIMIT_AUTH_WINDOW_MS', 60_000),
    },
    health: {
      limit: positiveInteger(environment.SCO_RATE_LIMIT_HEALTH_MAX, 'SCO_RATE_LIMIT_HEALTH_MAX', deployment === 'test' ? 10_000 : 120),
      windowMilliseconds: positiveInteger(environment.SCO_RATE_LIMIT_HEALTH_WINDOW_MS, 'SCO_RATE_LIMIT_HEALTH_WINDOW_MS', 60_000),
    },
    maximumClients,
    clientIdentity,
    trustedProxyPeers: proxyTrust.trustedPeers,
  };
}