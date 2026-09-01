FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY scripts ./scripts

FROM node:22-slim
ENV NODE_ENV=production PORT=3000 TRUST_PROXY=1
WORKDIR /app
RUN useradd -r -u 1001 apiuser
COPY --from=build /app /app
# Ship the ingested database inside the image (rebuild image to refresh data),
# or mount a volume at /app/data and run "npm run ingest" instead.
COPY data/products.db ./data/products.db
USER apiuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
