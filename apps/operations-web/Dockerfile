FROM node:20-alpine AS dependencies

WORKDIR /workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/operations-web/package.json apps/operations-web/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY apps/operations-web ./apps/operations-web
RUN pnpm --filter @sco/operations-web run build

FROM node:20-alpine AS runtime

WORKDIR /workspace
ENV NODE_ENV=production
ENV PORT=3103
ENV HOSTNAME=0.0.0.0
RUN addgroup -S sco && adduser -S sco -G sco

COPY --from=build --chown=sco:sco /workspace/apps/operations-web/.next/standalone ./
COPY --from=build --chown=sco:sco /workspace/apps/operations-web/.next/static ./apps/operations-web/.next/static

USER sco
EXPOSE 3103
CMD ["node", "apps/operations-web/server.js"]