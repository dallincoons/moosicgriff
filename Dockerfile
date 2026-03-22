FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npx tsc

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/build ./build
COPY --from=build /app/app ./app
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/index.ts ./index.ts
COPY --from=build /app/config.ts ./config.ts

ENTRYPOINT ["node", "build/index.js"]
CMD ["artists"]
