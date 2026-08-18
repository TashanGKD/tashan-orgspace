import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { basename, resolve } from "node:path";
import { URL } from "node:url";

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || value === undefined) throw new Error("invalid arguments");
    values.set(name, value);
  }
  for (const name of ["--release-dir", "--asset", "--port-file", "--key", "--cert"]) {
    if (!values.has(name)) throw new Error(`missing ${name}`);
  }
  return Object.fromEntries([...values].map(([name, value]) => [name.slice(2), value]));
}

const options = parseArguments(process.argv.slice(2));
const releaseDirectory = resolve(options["release-dir"]);
const assetName = basename(options.asset);
const checksumName = "SHA256SUMS";
const capabilities = JSON.parse(
  readFileSync(
    new URL("../../packages/capabilities/src/phase0-capabilities.json", import.meta.url),
  ),
);

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(
  {
    key: readFileSync(resolve(options.key)),
    cert: readFileSync(resolve(options.cert)),
  },
  (request, response) => {
    const pathname = new URL(request.url ?? "/", "https://127.0.0.1").pathname;
    const releaseSuffix = pathname.split("/").at(-1);
    if (request.method === "GET" && releaseSuffix === checksumName) {
      response.writeHead(200, { "content-type": "text/plain" });
      createReadStream(resolve(releaseDirectory, checksumName)).pipe(response);
      return;
    }
    if (request.method === "GET" && releaseSuffix === assetName) {
      response.writeHead(200, { "content-type": "application/gzip" });
      createReadStream(resolve(releaseDirectory, assetName)).pipe(response);
      return;
    }
    if (request.method === "GET" && pathname === "/v1/health") {
      json(response, 200, {
        status: "ok",
        version: "fresh-user-fixture",
        time: new Date().toISOString(),
      });
      return;
    }
    if (request.method === "GET" && pathname === "/v1/capabilities") {
      json(response, 200, { items: capabilities });
      return;
    }
    json(response, 404, {
      error: {
        code: "CAPABILITY_NOT_FOUND",
        message: "fixture route not found",
        requestId: "00000000-0000-4000-8000-000000000001",
      },
    });
  },
);

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("missing listen address");
  writeFileSync(resolve(options["port-file"]), `${address.port}\n`, { mode: 0o600 });
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
