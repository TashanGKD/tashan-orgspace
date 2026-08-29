import { checkV1ProductContract } from "./check-v1-product-contract.mjs";

const capabilities = [
  { id: "thing.read", web: "required" },
  { id: "thing.write", web: "deferred" },
  { id: "chat.event.stream", web: "deferred" },
];
const base = {
  capabilities,
  api: ["thing.read", "thing.write"],
  sdk: { "thing.read": "readThing", "thing.write": "writeThing", "chat.event.stream": "stream" },
  cli: {
    "thing.read": "thing get",
    "thing.write": "thing set",
    "chat.event.stream": "chat event stream",
  },
  web: [{ capabilityId: "thing.read" }],
  skill: capabilities.map((item) => item.id),
  audit: { "thing.read": "Read", "thing.write": "Write", "chat.event.stream": "Stream" },
  modules: [
    { id: "thing", status: "available", capabilities: ["thing.read"] },
    { id: "future", status: "coming_soon", capabilities: [] },
  ],
  domainEvents: [{ eventType: "thing.created", producer: "producer.ts", consumer: "consumer.ts" }],
  files: { "producer.ts": 'eventType: "thing.created"', "consumer.ts": 'case "thing.created"' },
};
checkV1ProductContract(base);
function rejects(label, mutate, expected) {
  const value = JSON.parse(JSON.stringify(base));
  mutate(value);
  try {
    checkV1ProductContract(value);
  } catch (error) {
    if (error instanceof Error && error.message.includes(expected)) return;
    throw error;
  }
  throw new Error(`${label} did not fail`);
}
rejects("API", (v) => v.api.pop(), "API capability drift");
rejects("SDK", (v) => delete v.sdk["thing.read"], "SDK capability drift");
rejects("CLI", (v) => delete v.cli["thing.read"], "CLI capability drift");
rejects("Web", (v) => v.web.pop(), "Web capability drift");
rejects("Skill", (v) => v.skill.pop(), "Skill capability drift");
rejects("audit", (v) => delete v.audit["thing.read"], "audit label drift");
rejects("module", (v) => v.modules[1].capabilities.push("thing.read"), "coming-soon module");
rejects("producer", (v) => (v.files["producer.ts"] = ""), "DomainEvent producer drift");
rejects("consumer", (v) => (v.files["consumer.ts"] = ""), "DomainEvent consumer drift");
console.log("check-v1-product-contract.self-test: PASS");
