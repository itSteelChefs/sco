FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS dependencies

WORKDIR /workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/operations-web/package.json apps/operations-web/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

ARG RELEASE_SHA=unknown
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_RELEASE=$RELEASE_SHA
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
COPY apps/operations-web ./apps/operations-web
RUN pnpm --filter @sco/operations-web run build

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runtime

WORKDIR /workspace
ENV NODE_ENV=production
ENV PORT=3103
ENV HOSTNAME=0.0.0.0
RUN apk upgrade --no-cache \
	&& rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
	&& rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
	&& addgroup -S sco && adduser -S sco -G sco

COPY --from=build --chown=sco:sco /workspace/apps/operations-web/.next/standalone ./
COPY --from=build --chown=sco:sco /workspace/apps/operations-web/.next/static ./apps/operations-web/.next/static

USER sco
EXPOSE 3103
CMD ["node", "apps/operations-web/server.js"]