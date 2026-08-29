import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootArgumentIndex = process.argv.indexOf("--root");
if (rootArgumentIndex !== -1 && process.env.ORGSPACE_PRODUCTION_GATE_TESTING !== "1") {
  throw new Error("--root is available only to production gate self-tests");
}
const root =
  rootArgumentIndex === -1
    ? repositoryRoot
    : resolve(process.argv[rootArgumentIndex + 1] ?? "missing-production-gate-root");

const paths = {
  compose: join(root, "deploy/compose.production.yml"),
  gateway: join(root, "deploy/nginx/aup-gateway.conf"),
  ecsIngress: join(root, "deploy/nginx/ecs-orgspace.conf"),
  tunnel: join(root, "deploy/start-tunnel.sh"),
  runtimeDockerfile: join(root, "deploy/Dockerfile.runtime"),
  webDockerfile: join(root, "deploy/Dockerfile.web"),
  environmentExample: join(root, "deploy/env.production.example"),
  productionContract: join(root, "deploy/production-contract.json"),
  release: join(root, "release/cli-release.json"),
  skillRelease: join(root, "skill/tashan-orgspace/release.json"),
  minioConfig: join(root, "deploy/minio"),
};

const fixtureEnvironment = {
  ...process.env,
  ALIYUN_SMS_ACCESS_KEY_ID: "fixture-access-key-id",
  ALIYUN_SMS_ACCESS_KEY_SECRET: "fixture-access-key-secret",
  ALIYUN_SMS_ENDPOINT: "dysmsapi.aliyuncs.com",
  ALIYUN_SMS_REGION_ID: "cn-hangzhou",
  ALIYUN_SMS_SIGN_NAME: "fixture-sign",
  ALIYUN_SMS_TEMPLATE_CODE: "SMS_FIXTURE",
  ALIYUN_SMS_TEMPLATE_PARAM_KEY: "code",
  ALIYUN_SMS_NOTIFICATION_TEMPLATE_CODE: "SMS_NOTIFICATION_FIXTURE",
  ALIYUN_SMS_NOTIFICATION_TEMPLATE_PARAM_KEY: "content",
  JWT_ACTIVE_KEY_ID: "fixture-key-1",
  JWT_PRIVATE_KEY: "fixture-private-key",
  JWT_PUBLIC_KEY: "fixture-public-key",
  ORGSPACE_POSTGRES_PASSWORD: "fixture-postgres-password",
  MINIO_ROOT_USER: "fixture-minio-root",
  MINIO_ROOT_PASSWORD: "fixture-minio-root-password",
  S3_ACCESS_KEY_ID: "fixture-s3-app",
  S3_SECRET_ACCESS_KEY: "fixture-s3-app-password",
  PARTNER_FIELD_ACTIVE_KEY_VERSION: "1",
  PARTNER_FIELD_KEYS: JSON.stringify({ 1: Buffer.alloc(32, 1).toString("base64url") }),
  PARTNER_BLIND_INDEX_KEY: Buffer.alloc(32, 2).toString("base64url"),
  PHONE_CODE_PEPPER: "fixture-phone-code-pepper-value",
  SERVICE_VERSION: "0.1.0-alpha.2",
};

function fail(message) {
  throw new Error(`production contract violation: ${message}`);
}

function record(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${label} missing`);
  return value;
}

function read(path) {
  return readFileSync(path, "utf8");
}

function readJson(path, label) {
  return record(JSON.parse(read(path)), label);
}

const productionContract = readJson(paths.productionContract, "production contract");
const expectedContractFields = [
  "aupHostAlias",
  "aupLoopbackPort",
  "composeProject",
  "dockerImagePrefix",
  "ecsCertificate",
  "ecsCertificateKey",
  "ecsHostAlias",
  "ecsLoopbackPort",
  "healthPath",
  "publicOrigin",
  "remoteRoot",
];
if (Object.keys(productionContract).sort().join(",") !== expectedContractFields.join(",")) {
  fail("production contract fields must be exact");
}
if (productionContract.publicOrigin !== "https://orgspace.tashan.chat") {
  fail("publicOrigin must be https://orgspace.tashan.chat");
}
if (productionContract.healthPath !== "/v1/health") fail("healthPath must be /v1/health");
if (productionContract.aupHostAlias !== "aup-server") fail("aupHostAlias must be aup-server");
if (productionContract.ecsHostAlias !== "tashan-ecs") fail("ecsHostAlias must be tashan-ecs");
if (productionContract.remoteRoot !== "/home/aup/tashan-orgspace") {
  fail("remoteRoot must be /home/aup/tashan-orgspace");
}
if (productionContract.composeProject !== "tashan-orgspace-prod") {
  fail("composeProject must be tashan-orgspace-prod");
}
if (productionContract.dockerImagePrefix !== "m.daocloud.io/docker.io/library") {
  fail("dockerImagePrefix must use the approved mirror");
}
if (productionContract.aupLoopbackPort !== 44110) {
  fail("gateway port must match production aupLoopbackPort");
}
if (productionContract.ecsLoopbackPort !== 14010) {
  fail("ecsLoopbackPort must be 14010");
}
if (productionContract.ecsCertificate !== "/etc/ssl/wildcard-tashan/fullchain.cer") {
  fail("ECS certificate path must match the wildcard certificate");
}
if (productionContract.ecsCertificateKey !== "/etc/ssl/wildcard-tashan/tashan.chat.key") {
  fail("ECS certificate key path must match the wildcard certificate");
}

const release = readJson(paths.release, "CLI release");
if (release.apiUrl !== productionContract.publicOrigin) {
  fail("release API URL must match production publicOrigin");
}
const skillRelease = readJson(paths.skillRelease, "Skill release");
if (skillRelease.apiUrl !== productionContract.publicOrigin) {
  fail("Skill API URL must match production publicOrigin");
}

const rendered = spawnSync(
  "docker",
  ["compose", "-f", paths.compose, "config", "--format", "json"],
  { cwd: root, encoding: "utf8", env: fixtureEnvironment },
);
if (rendered.status !== 0) {
  fail(`docker compose config failed: ${(rendered.stderr || rendered.stdout).trim()}`);
}

const model = record(JSON.parse(rendered.stdout), "Compose model");
const composeSource = read(paths.compose);
if (model.name !== productionContract.composeProject) {
  fail(`Compose project name must be ${productionContract.composeProject}`);
}
const services = record(model.services, "Compose services");
for (const serviceName of [
  "postgres",
  "redis",
  "migrate",
  "api",
  "worker",
  "realtime",
  "gateway",
]) {
  record(services[serviceName], `service ${serviceName}`);
}

for (const serviceName of ["postgres", "redis"]) {
  const service = record(services[serviceName], `service ${serviceName}`);
  if (Array.isArray(service.ports) && service.ports.length > 0) {
    fail("postgres and redis must not publish host ports");
  }
}
const expectedDataImages = {
  postgres: `${productionContract.dockerImagePrefix}/postgres:17.6-alpine`,
  redis: `${productionContract.dockerImagePrefix}/redis:8.2.1-alpine`,
};
for (const [serviceName, expectedImage] of Object.entries(expectedDataImages)) {
  const service = record(services[serviceName], `service ${serviceName}`);
  if (service.image !== expectedImage) {
    fail("postgres and redis must use the approved image mirror");
  }
}

let publicDownloadBinds = 0;
for (const [serviceName, serviceValue] of Object.entries(services)) {
  const service = record(serviceValue, `service ${serviceName}`);
  if (!Array.isArray(service.volumes)) continue;
  for (const volumeValue of service.volumes) {
    const volume = record(volumeValue, `service ${serviceName} volume`);
    if (volume.type !== "bind") continue;
    if (serviceName === "minio-bootstrap") {
      if (
        volume.source !== paths.minioConfig ||
        volume.target !== "/config" ||
        volume.read_only !== true
      ) {
        fail("MinIO bootstrap config mount must be the exact read-only repository directory");
      }
      continue;
    }
    if (serviceName !== "gateway") fail("host-control mounts are forbidden");
    if (volume.source !== "/home/aup/tashan-orgspace/shared/public-downloads") {
      fail("public downloads bind source must be exact");
    }
    if (volume.target !== "/usr/share/nginx/html/downloads/orgspace") {
      fail("public downloads bind target must be exact");
    }
    if (volume.read_only !== true) fail("public downloads bind must be read-only");
    publicDownloadBinds += 1;
  }
}
if (publicDownloadBinds !== 1) fail("gateway must have exactly one public downloads bind");

const gatewayService = record(services.gateway, "service gateway");
if (gatewayService.read_only !== true) fail("gateway root filesystem must be read-only");
for (const requiredTmpfs of [
  "/var/cache/nginx:size=32m,uid=101,gid=101,mode=0755",
  "/var/run:size=4m,uid=101,gid=101,mode=0755",
]) {
  if (!composeSource.includes(requiredTmpfs)) {
    fail("gateway tmpfs must be writable only by nginx uid 101");
  }
}
const gatewayPorts = Array.isArray(gatewayService.ports) ? gatewayService.ports : [];
if (gatewayPorts.length !== 1) fail("gateway must publish only 127.0.0.1:44110:8080");
const gatewayPort = record(gatewayPorts[0], "gateway port");
if (
  gatewayPort.host_ip !== "127.0.0.1" ||
  String(gatewayPort.published) !== String(productionContract.aupLoopbackPort) ||
  Number(gatewayPort.target) !== 8080
) {
  fail("gateway must publish only 127.0.0.1:44110:8080");
}

const api = record(services.api, "service api");
const apiEnvironment = record(api.environment, "api environment");
if (apiEnvironment.NODE_ENV !== "production") fail("api NODE_ENV must be production");
if (typeof apiEnvironment.SERVICE_VERSION !== "string" || apiEnvironment.SERVICE_VERSION === "") {
  fail("api SERVICE_VERSION is required");
}
const realtime = record(services.realtime, "service realtime");
const realtimeEnvironment = record(realtime.environment, "realtime environment");
if (realtime.read_only !== true) fail("realtime root filesystem must be read-only");
if (Array.isArray(realtime.ports) && realtime.ports.length > 0)
  fail("realtime must not publish host ports");
for (const key of [
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_ACTIVE_KEY_ID",
  "JWT_PRIVATE_KEY",
  "JWT_PUBLIC_KEY",
]) {
  if (typeof realtimeEnvironment[key] !== "string" || realtimeEnvironment[key] === "")
    fail(`realtime ${key} is required`);
}

const gatewayConfig = read(paths.gateway);
if (
  !/location\s+\/v1\/\s*\{/.test(gatewayConfig) ||
  !/proxy_pass\s+http:\/\/api:4110;/.test(gatewayConfig)
) {
  fail("gateway must proxy /v1 to http://api:4110");
}
if (
  !/location\s+=\s+\/v1\/realtime\s*\{/.test(gatewayConfig) ||
  !/proxy_set_header\s+Upgrade\s+\$http_upgrade;/.test(gatewayConfig) ||
  !/proxy_pass\s+http:\/\/realtime:4120;/.test(gatewayConfig)
) {
  fail("gateway must proxy WebSocket realtime to http://realtime:4120");
}
const appServerStart = gatewayConfig.indexOf("server_name _;");
if (appServerStart === -1) fail("gateway Web server block is missing");
const stableDownloadLocation = gatewayConfig.indexOf(
  "location = /downloads/orgspace/install-skill.sh",
  appServerStart,
);
const versionedDownloadLocation = gatewayConfig.indexOf(
  "location ^~ /downloads/orgspace/v",
  appServerStart,
);
const spaLocation = gatewayConfig.indexOf("location / {", appServerStart);
if (
  stableDownloadLocation === -1 ||
  versionedDownloadLocation === -1 ||
  spaLocation === -1 ||
  !(stableDownloadLocation < versionedDownloadLocation && versionedDownloadLocation < spaLocation)
) {
  fail("gateway download locations are missing or ordered after SPA fallback");
}
const downloadConfig = gatewayConfig.slice(stableDownloadLocation, spaLocation);
if (downloadConfig.includes("/index.html") || !downloadConfig.includes("try_files $uri =404;")) {
  fail("downloads must return 404 without SPA fallback");
}
if (/autoindex\s+on;/.test(downloadConfig)) fail("download directory listing must stay disabled");
if ((downloadConfig.match(/limit_except\s+GET/g) ?? []).length !== 2) {
  fail("downloads must allow only GET and HEAD");
}
if (!downloadConfig.includes('Cache-Control "no-cache"')) {
  fail("stable Skill installer must not use immutable caching");
}
if (!downloadConfig.includes("max-age=31536000, immutable")) {
  fail("versioned downloads must use immutable caching");
}

const ecsIngress = read(paths.ecsIngress);
const publicHost = new URL(productionContract.publicOrigin).hostname;
if (!ecsIngress.includes(`server_name ${publicHost};`)) {
  fail("ECS ingress host must match production publicOrigin");
}
if (!ecsIngress.includes("server_name files.orgspace.tashan.chat;")) {
  fail("ECS ingress file host must be files.orgspace.tashan.chat");
}
if (!ecsIngress.includes("listen 443 ssl http2;")) fail("ECS ingress must require HTTPS");
if (!ecsIngress.includes(`ssl_certificate ${productionContract.ecsCertificate};`)) {
  fail("ECS ingress certificate must match production contract");
}
if (!ecsIngress.includes(`ssl_certificate_key ${productionContract.ecsCertificateKey};`)) {
  fail("ECS ingress certificate key must match production contract");
}
const ecsUpstreams = [...ecsIngress.matchAll(/proxy_pass\s+([^;]+);/g)].map((match) => match[1]);
const expectedEcsUpstream = `http://127.0.0.1:${productionContract.ecsLoopbackPort}`;
if (
  ecsUpstreams.length !== 2 ||
  ecsUpstreams.some((upstream) => upstream !== expectedEcsUpstream)
) {
  fail(`ECS ingress must proxy only to 127.0.0.1:${productionContract.ecsLoopbackPort}`);
}
if (!ecsIngress.includes("proxy_set_header X-Forwarded-For $remote_addr;")) {
  fail("ECS ingress must replace untrusted forwarded client addresses");
}

const tunnel = read(paths.tunnel);
if (!tunnel.includes('reverse_forward="127.0.0.1:$ecs_port:127.0.0.1:$aup_port"')) {
  fail("tunnel reverse forward must stay on loopback");
}
for (const requiredTunnelFragment of [
  'ecs_target="root@101.200.234.115"',
  "autossh -M 0 -N",
  "-o ExitOnForwardFailure=yes",
  "-o ServerAliveInterval=30",
  "-o ServerAliveCountMax=3",
  '-R "$reverse_forward"',
]) {
  if (!tunnel.includes(requiredTunnelFragment)) {
    fail(`tunnel is missing required safety option: ${requiredTunnelFragment}`);
  }
}
if (!/proxy_set_header\s+X-Forwarded-For\s+\$http_x_forwarded_for;/.test(gatewayConfig)) {
  fail("gateway must preserve the ECS-provided client address");
}

const runtimeDockerfile = read(paths.runtimeDockerfile);
if (
  !/^FROM m\.daocloud\.io\/docker\.io\/library\/node:24\.14\.0-bookworm-slim$/m.test(
    runtimeDockerfile,
  )
) {
  fail("runtime image must pin the approved Node mirror image");
}
if (!/^USER node$/m.test(runtimeDockerfile)) fail("runtime image must declare USER node");
if (
  !runtimeDockerfile.includes("COPY apps/realtime/package.json apps/realtime/package.json") ||
  !runtimeDockerfile.includes("COPY apps/realtime apps/realtime")
)
  fail("runtime image must include realtime service sources");

const webDockerfile = read(paths.webDockerfile);
if (
  !/^FROM m\.daocloud\.io\/docker\.io\/library\/node:24\.14\.0-bookworm-slim AS build$/m.test(
    webDockerfile,
  ) ||
  !/^FROM m\.daocloud\.io\/docker\.io\/library\/nginx:1\.30\.4-alpine$/m.test(webDockerfile)
) {
  fail("web image must pin the approved Node and Nginx mirror images");
}
if (!/^USER nginx$/m.test(webDockerfile)) fail("web image must declare USER nginx");

const requiredEnvironmentKeys = [
  "ORGSPACE_POSTGRES_PASSWORD",
  "MINIO_ROOT_USER",
  "MINIO_ROOT_PASSWORD",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "PARTNER_FIELD_ACTIVE_KEY_VERSION",
  "PARTNER_FIELD_KEYS",
  "PARTNER_BLIND_INDEX_KEY",
  "SERVICE_VERSION",
  "JWT_ACTIVE_KEY_ID",
  "JWT_PRIVATE_KEY",
  "JWT_PUBLIC_KEY",
  "PHONE_CODE_PEPPER",
  "PHONE_PROVIDER",
  "ALIYUN_SMS_ACCESS_KEY_ID",
  "ALIYUN_SMS_ACCESS_KEY_SECRET",
  "ALIYUN_SMS_SIGN_NAME",
  "ALIYUN_SMS_TEMPLATE_CODE",
  "ALIYUN_SMS_TEMPLATE_PARAM_KEY",
  "ALIYUN_SMS_NOTIFICATION_TEMPLATE_CODE",
  "ALIYUN_SMS_NOTIFICATION_TEMPLATE_PARAM_KEY",
  "ALIYUN_SMS_ENDPOINT",
  "ALIYUN_SMS_REGION_ID",
];
const exampleLines = read(paths.environmentExample)
  .split(/\r?\n/)
  .filter((line) => line !== "");
const exampleKeys = exampleLines.map((line) => {
  const match = /^([A-Z][A-Z0-9_]*)=$/.exec(line);
  if (match?.[1] === undefined)
    fail("production environment example must contain empty KEY= entries only");
  return match[1];
});
if (
  exampleKeys.length !== requiredEnvironmentKeys.length ||
  requiredEnvironmentKeys.some((key) => !exampleKeys.includes(key))
) {
  fail("production environment example keys are incomplete");
}

console.log("check-production-contract: PASS (isolated loopback production stack)");
