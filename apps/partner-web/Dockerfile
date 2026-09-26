FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS dependencies

WORKDIR /workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/partner-web/package.json apps/partner-web/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY apps/partner-web ./apps/partner-web
RUN pnpm --filter @sco/partner-web run build

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runtime

WORKDIR /workspace
ENV NODE_ENV=production
ENV PORT=3102
ENV HOSTNAME=0.0.0.0
RUN addgroup -S sco && adduser -S sco -G sco

COPY --from=build --chown=sco:sco /workspace/apps/partner-web/.next/standalone ./
COPY --from=build --chown=sco:sco /workspace/apps/partner-web/.next/static ./apps/partner-web/.next/static

USER sco
EXPOSE 3102
CMD ["node", "apps/partner-web/server.js"]