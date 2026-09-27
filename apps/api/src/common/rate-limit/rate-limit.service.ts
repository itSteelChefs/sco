import { Injectable } from '@nestjs/common';
import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
import { rateLimitConfig, type RateLimitConfig, type RateLimitPolicy } from './rate-limit.config.js';

export type RateLimitPolicyName = 'application' | 'authentication' | 'health';
type ClientWindow = { count: number; resetAt: number };

@Injectable()
export class RateLimitService {
  private readonly clients = new Map<string, ClientWindow>();
  private readonly config: RateLimitConfig;

  constructor() {
    this.config = rateLimitConfig();
  }

  clientIdentity(request: FastifyRequest): string {
    const peer = request.ip;
    if (this.config.clientIdentity !== 'trusted-proxy' || !this.config.trustedProxyPeers.includes(peer)) return peer;
    const forwardedFor = request.headers['x-forwarded-for'];
    if (typeof forwardedFor !== 'string' || forwardedFor.includes(',') || isIP(forwardedFor) === 0) return peer;
    return forwardedFor;
  }

  consume(policyName: RateLimitPolicyName, clientIdentity: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    if (!this.config.enabled) return { allowed: true, retryAfterSeconds: 0 };
    const policy: RateLimitPolicy = this.config[policyName];
    const key = `${policyName}:${clientIdentity}`;
    let current = this.clients.get(key);
    if (!current || current.resetAt <= now) {
      if (this.clients.size >= this.config.maximumClients) this.removeExpired(now);
      if (this.clients.size >= this.config.maximumClients && !this.clients.has(key)) {
        return { allowed: false, retryAfterSeconds: Math.ceil(policy.windowMilliseconds / 1000) };
      }
      current = { count: 0, resetAt: now + policy.windowMilliseconds };
      this.clients.set(key, current);
    }
    current.count += 1;
    return {
      allowed: current.count <= policy.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  private removeExpired(now: number): void {
    for (const [identity, window] of this.clients) {
      if (window.resetAt <= now) this.clients.delete(identity);
    }
  }
}