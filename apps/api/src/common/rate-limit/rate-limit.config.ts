export type RateLimitPolicy = {
  limit: number;
  windowMilliseconds: number;
};

export type RateLimitConfig = {
  enabled: boolean;
  application: RateLimitPolicy;
  authentication: RateLimitPolicy;
  health: RateLimitPolicy;
  maximumClients: number;
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
  if (environment.SCO_TRUST_PROXY && environment.SCO_TRUST_PROXY !== 'false') {
    throw new Error('SCO_TRUST_PROXY is not supported without an approved proxy trust boundary');
  }
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
  if (requiresExplicitConfiguration && enabled && environment.SCO_RATE_LIMIT_CLIENT_IDENTITY !== 'direct-peer') {
    throw new Error('SCO_RATE_LIMIT_CLIENT_IDENTITY=direct-peer is required until a trusted proxy boundary is approved');
  }
  if (environment.SCO_RATE_LIMIT_CLIENT_IDENTITY && environment.SCO_RATE_LIMIT_CLIENT_IDENTITY !== 'direct-peer') {
    throw new Error('Only direct-peer client identity is supported');
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
  };
}