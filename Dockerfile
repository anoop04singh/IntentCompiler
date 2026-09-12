FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY .npmrc ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY examples ./examples
RUN npm run build

FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY package*.json ./
COPY .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY skills ./skills
COPY supabase ./supabase
USER node
EXPOSE 3000
CMD ["node","dist/src/main.js"]

FROM api AS worker
USER root
RUN apt-get update && apt-get install -y --no-install-recommends build-essential curl ca-certificates protobuf-compiler pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
ARG SUBSTREAMS_VERSION=v1.22.0
ARG BUF_VERSION=1.72.0
RUN curl -fsSL https://sh.rustup.rs -o /tmp/rustup.sh && sh /tmp/rustup.sh -y --profile minimal --default-toolchain stable && /root/.cargo/bin/rustup target add wasm32-unknown-unknown
RUN curl -fsSL "https://github.com/streamingfast/substreams/releases/download/${SUBSTREAMS_VERSION}/substreams_linux_x86_64.tar.gz" -o /tmp/substreams.tar.gz && tar -xzf /tmp/substreams.tar.gz -C /usr/local/bin substreams && chmod +x /usr/local/bin/substreams
RUN curl -fsSL "https://github.com/bufbuild/buf/releases/download/v${BUF_VERSION}/buf-Linux-x86_64" -o /usr/local/bin/buf && chmod +x /usr/local/bin/buf
RUN mv /root/.cargo /opt/cargo && mv /root/.rustup /opt/rustup && chown -R node:node /opt/cargo /opt/rustup && mkdir /app/builds && chown node:node /app/builds
ENV CARGO_HOME=/opt/cargo RUSTUP_HOME=/opt/rustup PATH=/opt/cargo/bin:$PATH
USER node
CMD ["node","dist/src/worker-main.js"]
