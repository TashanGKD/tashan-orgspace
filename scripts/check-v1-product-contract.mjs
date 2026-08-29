import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const unique = (values) => new Set(values);
const difference = (left, right) => [...left].filter((value) => !right.has(value)).sort();
function same(label, expected, actual) {
  const missing = difference(expected, actual),
    extra = difference(actual, expected);
  if (missing.length || extra.length)
    throw new Error(
      `${label} drift; missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"}`,
    );
}
export function checkV1ProductContract(input) {
  const capabilities = unique(input.capabilities.map((item) => item.id));
  if (capabilities.size !== input.capabilities.length) throw new Error("duplicate capability ID");
  const apiExpected = new Set([...capabilities].filter((id) => id !== "chat.event.stream"));
  same("API capability", apiExpected, unique(input.api));
  same("SDK capability", capabilities, new Set(Object.keys(input.sdk)));
  same("CLI capability", capabilities, new Set(Object.keys(input.cli)));
  same("Skill capability", capabilities, unique(input.skill));
  same("audit label", capabilities, new Set(Object.keys(input.audit)));
  const requiredWeb = unique(
    input.capabilities.filter((item) => item.web === "required").map((item) => item.id),
  );
  same("Web capability", requiredWeb, unique(input.web.map((item) => item.capabilityId)));
  for (const module of input.modules) {
    for (const id of module.capabilities)
      if (!capabilities.has(id))
        throw new Error(`module has unknown capability: ${module.id}:${id}`);
    if (module.status === "coming_soon" && module.capabilities.length)
      throw new Error(`coming-soon module binds capability: ${module.id}`);
    if (module.status === "available" && module.capabilities.length === 0)
      throw new Error(`available module has no capability: ${module.id}`);
  }
  for (const event of input.domainEvents) {
    const producer = input.files[event.producer],
      consumer = input.files[event.consumer];
    if (producer === undefined || !producer.includes(event.producerToken ?? event.eventType))
      throw new Error(`DomainEvent producer drift: ${event.eventType}`);
    if (consumer === undefined || !consumer.includes(event.consumerToken ?? event.eventType))
      throw new Error(`DomainEvent consumer drift: ${event.eventType}`);
  }
  return {
    capabilities: capabilities.size,
    modules: input.modules.length,
    domainEvents: input.domainEvents.length,
  };
}
function json(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}
function repositoryInput() {
  const capabilities = json("packages/capabilities/src/phase0-capabilities.json");
  const ids = new Set(capabilities.map((item) => item.id));
  const routeDirectory = resolve(root, "apps/api/src/routes");
  const routeText = readdirSync(routeDirectory)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => readFileSync(resolve(routeDirectory, name), "utf8"))
    .join("\n");
  const api = [...ids].filter((id) => routeText.includes(`"${id}"`));
  const sdkText = readFileSync(resolve(root, "packages/sdk/src/client.test.ts"), "utf8");
  const sdk = Object.fromEntries(
    [...sdkText.matchAll(/"([a-z]+(?:\.[a-z]+)+)":\s*"([A-Za-z0-9]+)"/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  const domainEvents = json("packages/contracts/src/v1-domain-events.json");
  const files = {};
  for (const event of domainEvents)
    for (const path of [event.producer, event.consumer]) {
      const absolute = resolve(root, path);
      if (!existsSync(absolute)) throw new Error(`DomainEvent file missing: ${path}`);
      files[path] = readFileSync(absolute, "utf8");
    }
  return {
    capabilities,
    api,
    sdk,
    cli: json("apps/cli/src/capability-bindings.json"),
    web: json("apps/web/src/capability-surfaces.json"),
    skill: json("skill/tashan-orgspace/capability-references.json").capabilities,
    audit: json("apps/web/src/content/audit-action-labels.json"),
    modules: json("apps/web/src/product-modules.json"),
    domainEvents,
    files,
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = checkV1ProductContract(repositoryInput());
  console.log(
    `check-v1-product-contract: PASS (${result.capabilities} capabilities, ${result.modules} modules, ${result.domainEvents} DomainEvents)`,
  );
}
