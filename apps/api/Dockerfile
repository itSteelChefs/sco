FROM node:20-alpine AS dependencies

WORKDIR /workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @sco/api exec prisma generate --schema prisma/schema.prisma
RUN pnpm --filter @sco/api run build
RUN pnpm prune --prod

FROM node:20-alpine AS runtime

WORKDIR /workspace
ENV NODE_ENV=production
ENV PORT=3101
RUN addgroup -S sco && adduser -S sco -G sco

COPY --from=build --chown=sco:sco /workspace/node_modules ./node_modules
COPY --from=build --chown=sco:sco /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=sco:sco /workspace/apps/api/dist ./apps/api/dist
COPY --from=build --chown=sco:sco /workspace/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=sco:sco /workspace/packages/config ./packages/config

USER sco
EXPOSE 3101
CMD ["node", "apps/api/dist/main.js"]