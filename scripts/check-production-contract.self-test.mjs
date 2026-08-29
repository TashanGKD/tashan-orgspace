import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(repositoryRoot, "scripts/check-production-contract.mjs");

const validCompose = `name: tashan-orgspace-prod
services:
  postgres:
    image: m.daocloud.io/docker.io/library/postgres:17.6-alpine
    environment:
      POSTGRES_DB: orgspace
      POSTGRES_PASSWORD: \${ORGSPACE_POSTGRES_PASSWORD:?required}
      POSTGRES_USER: orgspace
    volumes:
      - postgres-data:/var/lib/postgresql/data
  redis:
    image: m.daocloud.io/docker.io/library/redis:8.2.1-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redis-data:/data
  minio-bootstrap:
    image: quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z
    volumes:
      - ./minio:/config:ro
  migrate:
    build:
      context: ..
      dockerfile: deploy/Dockerfile.runtime
    command: ["pnpm", "--filter", "@tashan/api", "db:migrate"]
    environment:
      DATABASE_URL: postgresql://orgspace:\${ORGSPACE_POSTGRES_PASSWORD}@postgres:5432/orgspace
  api:
    build:
      context: ..
      dockerfile: deploy/Dockerfile.runtime
    command: ["pnpm", "--filter", "@tashan/api", "start"]
    environment:
      ALIYUN_SMS_ACCESS_KEY_ID: \${ALIYUN_SMS_ACCESS_KEY_ID:?required}
      ALIYUN_SMS_ACCESS_KEY_SECRET: \${ALIYUN_SMS_ACCESS_KEY_SECRET:?required}
      ALIYUN_SMS_ENDPOINT: \${ALIYUN_SMS_ENDPOINT:?required}
      ALIYUN_SMS_REGION_ID: \${ALIYUN_SMS_REGION_ID:?required}
      ALIYUN_SMS_SIGN_NAME: \${ALIYUN_SMS_SIGN_NAME:?required}
      ALIYUN_SMS_TEMPLATE_CODE: \${ALIYUN_SMS_TEMPLATE_CODE:?required}
      ALIYUN_SMS_TEMPLATE_PARAM_KEY: \${ALIYUN_SMS_TEMPLATE_PARAM_KEY:?required}
      CORS_ORIGINS: https://orgspace.tashan.chat
      DATABASE_URL: postgresql://orgspace:\${ORGSPACE_POSTGRES_PASSWORD}@postgres:5432/orgspace
      HOST: 0.0.0.0
      JWT_AUDIENCE: tashan-orgspace
      JWT_ACTIVE_KEY_ID: \${JWT_ACTIVE_KEY_ID:?required}
      JWT_ISSUER: https://orgspace.tashan.chat
      JWT_PRIVATE_KEY: \${JWT_PRIVATE_KEY:?required}
      JWT_PUBLIC_KEY: \${JWT_PUBLIC_KEY:?required}
      NODE_ENV: production
      PHONE_CODE_PEPPER: \${PHONE_CODE_PEPPER:?required}
      PHONE_PROVIDER: aliyun
      PORT: "4110"
      REDIS_URL: redis://redis:6379
      SERVICE_VERSION: \${SERVICE_VERSION:?required}
      TRUSTED_PROXY_CIDRS: 172.31.64.0/24
    networks:
      default:
        ipv4_address: 172.31.64.20
  worker:
    build:
      context: ..
      dockerfile: deploy/Dockerfile.runtime
    command: ["pnpm", "--filter", "@tashan/worker", "start"]
    environment:
      DATABASE_URL: postgresql://orgspace:\${ORGSPACE_POSTGRES_PASSWORD}@postgres:5432/orgspace
  gateway:
    build:
      context: ..
      dockerfile: deploy/Dockerfile.web
    depends_on: [api]
    networks:
      default:
        ipv4_address: 172.31.64.10
    ports:
      - "127.0.0.1:44110:8080"
    read_only: true
    tmpfs:
      - /var/cache/nginx:size=32m,uid=101,gid=101,mode=0755
      - /var/run:size=4m,uid=101,gid=101,mode=0755
    volumes:
      - type: bind
        source: \${ORGSPACE_PUBLIC_DOWNLOADS_DIR:-/home/aup/tashan-orgspace/shared/public-downloads}
        target: /usr/share/nginx/html/downloads/orgspace
        read_only: true
volumes:
  postgres-data:
  redis-data:
networks:
  default:
    ipam:
      config:
        - subnet: 172.31.64.0/24
`;

const validGateway = `server {
  listen 8080;
  server_name _;
  root /usr/share/nginx/html;
  location /v1/ {
    proxy_set_header X-Forwarded-For $http_x_forwarded_for;
    proxy_pass http://api:4110;
  }
  location = /downloads/orgspace/install-skill.sh {
    limit_except GET { deny all; }
    add_header Cache-Control "no-cache" always;
    try_files $uri =404;
  }
  location ^~ /downloads/orgspace/v {
    limit_except GET { deny all; }
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    try_files $uri =404;
  }
  location / { try_files $uri $uri/ /index.html; }
}
`;

const validEcsIngress = `server {
  listen 80;
  server_name orgspace.tashan.chat;
}
server {
  listen 443 ssl http2;
  server_name files.orgspace.tashan.chat;
  ssl_certificate /etc/ssl/wildcard-tashan/fullchain.cer;
  ssl_certificate_key /etc/ssl/wildcard-tashan/tashan.chat.key;
  location / {
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_pass http://127.0.0.1:14010;
  }
}
server {
  listen 443 ssl http2;
  server_name orgspace.tashan.chat;
  ssl_certificate /etc/ssl/wildcard-tashan/fullchain.cer;
  ssl_certificate_key /etc/ssl/wildcard-tashan/tashan.chat.key;
  location / {
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_pass http://127.0.0.1:14010;
  }
}
`;
const validTunnel = `ecs_target="root@101.200.234.115"
reverse_forward="127.0.0.1:$ecs_port:127.0.0.1:$aup_port"
nohup autossh -M 0 -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -i "$key_file" -R "$reverse_forward" "$ecs_target"
`;

const validRuntimeDockerfile = `FROM m.daocloud.io/docker.io/library/node:24.14.0-bookworm-slim\nUSER node\n`;
const validWebDockerfile = `FROM m.daocloud.io/docker.io/library/node:24.14.0-bookworm-slim AS build\nFROM m.daocloud.io/docker.io/library/nginx:1.30.4-alpine\nUSER nginx\n`;
const validEnvironmentExample = `ORGSPACE_POSTGRES_PASSWORD=
MINIO_ROOT_USER=
MINIO_ROOT_PASSWORD=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
PARTNER_FIELD_ACTIVE_KEY_VERSION=
PARTNER_FIELD_KEYS=
PARTNER_BLIND_INDEX_KEY=
SERVICE_VERSION=
JWT_ACTIVE_KEY_ID=
JWT_PRIVATE_KEY=
JWT_PUBLIC_KEY=
PHONE_CODE_PEPPER=
PHONE_PROVIDER=
ALIYUN_SMS_ACCESS_KEY_ID=
ALIYUN_SMS_ACCESS_KEY_SECRET=
ALIYUN_SMS_SIGN_NAME=
ALIYUN_SMS_TEMPLATE_CODE=
ALIYUN_SMS_TEMPLATE_PARAM_KEY=
ALIYUN_SMS_NOTIFICATION_TEMPLATE_CODE=
ALIYUN_SMS_NOTIFICATION_TEMPLATE_PARAM_KEY=
ALIYUN_SMS_ENDPOINT=
ALIYUN_SMS_REGION_ID=
`;

const validProductionContract = {
  publicOrigin: "https://orgspace.tashan.chat",
  healthPath: "/v1/health",
  aupHostAlias: "aup-server",
  ecsHostAlias: "tashan-ecs",
  remoteRoot: "/home/aup/tashan-orgspace",
  composeProject: "tashan-orgspace-prod",
  aupLoopbackPort: 44110,
  ecsLoopbackPort: 14010,
  ecsCertificate: "/etc/ssl/wildcard-tashan/fullchain.cer",
  ecsCertificateKey: "/etc/ssl/wildcard-tashan/tashan.chat.key",
  dockerImagePrefix: "m.daocloud.io/docker.io/library",
};
const validRelease = { apiUrl: "https://orgspace.tashan.chat" };

function writeFixture({
  compose = validCompose,
  gateway = validGateway,
  ecsIngress = validEcsIngress,
  tunnel = validTunnel,
  runtimeDockerfile = validRuntimeDockerfile,
  webDockerfile = validWebDockerfile,
  environmentExample = validEnvironmentExample,
  productionContract = validProductionContract,
  release = validRelease,
  skillRelease = validRelease,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "orgspace-production-contract-"));
  const files = {
    "deploy/compose.production.yml": compose,
    "deploy/Dockerfile.runtime": runtimeDockerfile,
    "deploy/Dockerfile.web": webDockerfile,
    "deploy/nginx/aup-gateway.conf": gateway,
    "deploy/nginx/ecs-orgspace.conf": ecsIngress,
    "deploy/start-tunnel.sh": tunnel,
    "deploy/env.production.example": environmentExample,
    "deploy/production-contract.json": `${JSON.stringify(productionContract, null, 2)}\n`,
    "release/cli-release.json": `${JSON.stringify(release, null, 2)}\n`,
    "skill/tashan-orgspace/release.json": `${JSON.stringify(skillRelease, null, 2)}\n`,
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

function runGate(root) {
  return spawnSync(process.execPath, [gate, "--root", root], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ORGSPACE_PRODUCTION_GATE_TESTING: "1" },
  });
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function expectPass(name, fixture) {
  const root = writeFixture(fixture);
  try {
    const result = runGate(root);
    if (result.status !== 0) throw new Error(`${name}: expected PASS\n${output(result)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function expectReject(name, expectedMessage, fixture) {
  const root = writeFixture(fixture);
  try {
    const result = runGate(root);
    if (result.status === 0) throw new Error(`${name}: expected rejection`);
    if (!output(result).includes(expectedMessage)) {
      throw new Error(`${name}: missing ${JSON.stringify(expectedMessage)}\n${output(result)}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

expectPass("valid production model");
expectReject("public gateway bind", "gateway must publish only 127.0.0.1:44110:8080", {
  compose: validCompose.replace("127.0.0.1:44110:8080", "0.0.0.0:44110:8080"),
});
expectReject("database host port", "postgres and redis must not publish host ports", {
  compose: validCompose.replace(
    "    volumes:\n      - postgres-data:/var/lib/postgresql/data",
    '    ports: ["127.0.0.1:55432:5432"]\n    volumes:\n      - postgres-data:/var/lib/postgresql/data',
  ),
});
expectReject("docker socket mount", "host-control mounts are forbidden", {
  compose: validCompose.replace(
    "    networks:\n      default:\n        ipv4_address: 172.31.64.20",
    '    volumes: ["/var/run/docker.sock:/var/run/docker.sock"]\n    networks:\n      default:\n        ipv4_address: 172.31.64.20',
  ),
});
expectReject("host home mount", "host-control mounts are forbidden", {
  compose: validCompose.replace(
    "    networks:\n      default:\n        ipv4_address: 172.31.64.20",
    '    volumes: ["/home:/host-home:ro"]\n    networks:\n      default:\n        ipv4_address: 172.31.64.20',
  ),
});
expectReject(
  "MinIO bootstrap docker socket",
  "MinIO bootstrap config mount must be the exact read-only repository directory",
  {
    compose: validCompose.replace("./minio:/config:ro", "/var/run/docker.sock:/config:ro"),
  },
);
expectReject("writable public downloads", "public downloads bind must be read-only", {
  compose: validCompose.replace(
    "        read_only: true\nvolumes:",
    "        read_only: false\nvolumes:",
  ),
});
expectReject("wrong public downloads source", "public downloads bind source must be exact", {
  compose: validCompose.replace(
    "/home/aup/tashan-orgspace/shared/public-downloads",
    "/home/aup/tashan-orgspace/shared/other",
  ),
});
expectReject("wrong public downloads target", "public downloads bind target must be exact", {
  compose: validCompose.replace(
    "/usr/share/nginx/html/downloads/orgspace",
    "/usr/share/nginx/html",
  ),
});
expectReject("development runtime", "api NODE_ENV must be production", {
  compose: validCompose.replace("NODE_ENV: production", "NODE_ENV: development"),
});
expectReject("missing version", "api SERVICE_VERSION is required", {
  compose: validCompose.replace("      SERVICE_VERSION: ${SERVICE_VERSION:?required}\n", ""),
});
expectReject("wrong API upstream", "gateway must proxy /v1 to http://api:4110", {
  gateway: validGateway.replace("http://api:4110", "http://other:4110"),
});
expectReject("download SPA fallback", "downloads must return 404 without SPA fallback", {
  gateway: validGateway.replace(
    "location ^~ /downloads/orgspace/v {",
    "location ^~ /downloads/orgspace/v { try_files $uri /index.html; }\n  location ^~ /downloads/orgspace/versioned {",
  ),
});
expectReject("download directory listing", "download directory listing must stay disabled", {
  gateway: validGateway.replace(
    "location ^~ /downloads/orgspace/v {",
    "location ^~ /downloads/orgspace/v { autoindex on;",
  ),
});
expectReject("wrong ECS upstream", "ECS ingress must proxy only to 127.0.0.1:14010", {
  ecsIngress: validEcsIngress.replace("127.0.0.1:14010", "127.0.0.1:14011"),
});
expectReject("wrong public host", "ECS ingress host must match production publicOrigin", {
  ecsIngress: validEcsIngress.replaceAll("orgspace.tashan.chat", "wrong.tashan.chat"),
});
expectReject("non-loopback tunnel", "tunnel reverse forward must stay on loopback", {
  tunnel: validTunnel.replace("127.0.0.1:$ecs_port", "0.0.0.0:$ecs_port"),
});
expectReject("wrong project", "Compose project name must be tashan-orgspace-prod", {
  compose: validCompose.replace("name: tashan-orgspace-prod", "name: other-project"),
});
expectReject("release origin drift", "release API URL must match production publicOrigin", {
  release: { apiUrl: "https://wrong.tashan.chat" },
});
expectReject("skill origin drift", "Skill API URL must match production publicOrigin", {
  skillRelease: { apiUrl: "https://wrong.tashan.chat" },
});
expectReject("remote root escape", "remoteRoot must be /home/aup/tashan-orgspace", {
  productionContract: { ...validProductionContract, remoteRoot: "/home/aup/other" },
});
expectReject("AUP port drift", "gateway port must match production aupLoopbackPort", {
  productionContract: { ...validProductionContract, aupLoopbackPort: 44111 },
});
expectReject("image registry drift", "dockerImagePrefix must use the approved mirror", {
  productionContract: { ...validProductionContract, dockerImagePrefix: "docker.io/library" },
});
expectReject("unapproved database image", "postgres and redis must use the approved image mirror", {
  compose: validCompose.replace(
    "m.daocloud.io/docker.io/library/postgres:17.6-alpine",
    "docker.io/library/postgres:17.6-alpine",
  ),
});
expectReject("runtime image runs as root", "runtime image must declare USER node", {
  runtimeDockerfile: validRuntimeDockerfile.replace("USER node\n", ""),
});
expectReject("web image runs as root", "web image must declare USER nginx", {
  webDockerfile: validWebDockerfile.replace("USER nginx\n", ""),
});
expectReject("root-owned gateway tmpfs", "gateway tmpfs must be writable only by nginx uid 101", {
  compose: validCompose.replaceAll("uid=101,gid=101", "uid=0,gid=0"),
});

console.log("check-production-contract.self-test: PASS");
