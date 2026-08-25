import { strict as assert } from "node:assert";

import { checkPhoneAuthSurface } from "./check-phone-auth-surface.mjs";

const required = ["auth.verification.send", "auth.password.reset", "auth.register", "auth.login"];

const registry = required.map((id) => ({ id }));
const cliBindings = Object.fromEntries(required.map((id) => [id, `command for ${id}`]));
const webSurfaces = required.map((capabilityId) => ({ capabilityId }));
const skillReferences = { version: 1, capabilities: required };
const activeSources = {
  "apps/cli/src/commands/auth.ts": '.requiredOption("--phone <phone>")',
  "apps/api/src/auth/account-repository.ts": "where phone_e164 = $1",
};
const safeSkill = `
Use hidden prompts for both secrets.

\`\`\`bash
torg auth login --phone <phone>
torg auth code-send --phone <phone> --purpose register
torg auth register --phone <phone> --challenge <challenge-id>
\`\`\`
`;

function check(overrides = {}) {
  return checkPhoneAuthSurface({
    registry,
    cliBindings,
    webSurfaces,
    skillReferences,
    activeSources,
    skillAuthentication: safeSkill,
    ...overrides,
  });
}

assert.throws(
  () =>
    check({
      activeSources: {
        ...activeSources,
        "apps/cli/src/commands/auth.ts": '.requiredOption("--username <username>")',
      },
    }),
  /legacy username auth option/,
);
assert.throws(
  () =>
    check({
      activeSources: {
        ...activeSources,
        "apps/api/src/auth/account-repository.ts": "where username = $1",
      },
    }),
  /legacy username authentication lookup/,
);
assert.throws(
  () =>
    check({
      webSurfaces: webSurfaces.filter(({ capabilityId }) => capabilityId !== "auth.password.reset"),
    }),
  /missing Web phone-auth surface: auth.password.reset/,
);
assert.throws(() => {
  const withoutLogin = { ...cliBindings };
  delete withoutLogin["auth.login"];
  check({ cliBindings: withoutLogin });
}, /missing CLI phone-auth binding: auth.login/);
assert.throws(
  () =>
    check({
      skillAuthentication: `\`\`\`bash\ntorg auth login --phone <phone> --password <password>\n\`\`\``,
    }),
  /secret-bearing Skill command option: --password/,
);
assert.throws(
  () =>
    check({
      skillAuthentication: `\`\`\`bash\ntorg auth register --code <code>\n\`\`\``,
    }),
  /secret-bearing Skill command option: --code/,
);
assert.doesNotThrow(() => check());

console.log("check-phone-auth-surface.self-test: PASS");
