import { strict as assert } from "node:assert";

import { checkUserFacingCopy } from "./check-user-facing-copy.mjs";

const valid = {
  capabilities: [{ id: "organization.member.add" }, { id: "audit.list" }],
  auditLabels: {
    "organization.member.add": "添加组织成员",
    "audit.list": "查看操作记录",
  },
  sources: [{ path: "page.tsx", text: "查看和添加组织成员" }],
};
const clone = (value) => JSON.parse(JSON.stringify(value));

assert.deepEqual(checkUserFacingCopy(valid), { capabilities: 2, violations: 0 });

assert.throws(
  () =>
    checkUserFacingCopy({
      ...valid,
      sources: [{ path: "page.tsx", text: "在统一资源视图中管理" }],
    }),
  /prohibited user-facing phrase: 资源视图/,
);

const missing = clone(valid);
delete missing.auditLabels["organization.member.add"];
assert.throws(() => checkUserFacingCopy(missing), /missing audit label: organization.member.add/);

const raw = clone(valid);
raw.auditLabels["organization.member.add"] = "organization.member.add";
assert.throws(
  () => checkUserFacingCopy(raw),
  /audit label must be human-readable: organization.member.add/,
);

const english = clone(valid);
english.auditLabels["organization.member.add"] = "ORGANIZATION MEMBER ADD";
assert.throws(
  () => checkUserFacingCopy(english),
  /audit label must contain user-facing language: organization.member.add/,
);

const trailing = clone(valid);
trailing.auditLabels["organization.member.add"] = "organization.member.add ";
assert.throws(
  () => checkUserFacingCopy(trailing),
  /audit label must not contain surrounding whitespace: organization.member.add/,
);

assert.throws(
  () =>
    checkUserFacingCopy({
      ...valid,
      sources: [{ path: "page.tsx", text: "正在恢复安全会话…" }],
    }),
  /prohibited user-facing phrase: 正在恢复安全会话/,
);

console.log("check-user-facing-copy.self-test: PASS");
