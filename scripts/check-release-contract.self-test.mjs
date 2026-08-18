import { strict as assert } from "node:assert";

import { checkReleaseContract } from "./check-release-contract.mjs";

const version = "0.1.0-alpha.1";
const release = {
  schemaVersion: 1,
  version,
  nodeVersion: "24.14.0",
  repository: "TashanGKD/tashan-orgspace",
  apiUrl: "https://orgspace.tashan.chat",
  platforms: [
    { id: "darwin-arm64", asset: `torg-v${version}-darwin-arm64.tar.gz` },
    { id: "darwin-x64", asset: `torg-v${version}-darwin-x64.tar.gz` },
    { id: "linux-x64", asset: `torg-v${version}-linux-x64.tar.gz` },
  ],
};
const cliPackage = { version };
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const skillRelease = clone(release);

function changed(value, update) {
  return Object.assign(clone(value), update);
}

function withVersion(value, nextVersion) {
  const copy = clone(value);
  copy.version = nextVersion;
  copy.platforms = copy.platforms.map((platform) => ({
    ...platform,
    asset: `torg-v${nextVersion}-${platform.id}.tar.gz`,
  }));
  return copy;
}

assert.deepEqual(checkReleaseContract(release, cliPackage, skillRelease), {
  version,
  platforms: 3,
  violations: 0,
});
assert.throws(
  () => checkReleaseContract(release, { version: "0.1.0-alpha.2" }, skillRelease),
  /CLI version mismatch/,
);
assert.throws(
  () => checkReleaseContract(release, cliPackage, withVersion(skillRelease, "0.1.0")),
  /Skill release metadata mismatch: version/,
);
assert.throws(
  () =>
    checkReleaseContract(
      changed(release, { apiUrl: "http://orgspace.tashan.chat" }),
      cliPackage,
      skillRelease,
    ),
  /release apiUrl must be an HTTPS origin/,
);
assert.throws(
  () =>
    checkReleaseContract(
      changed(release, { repository: "Example/other" }),
      cliPackage,
      skillRelease,
    ),
  /release repository must be TashanGKD\/tashan-orgspace/,
);
assert.throws(
  () =>
    checkReleaseContract(
      changed(release, { platforms: [...release.platforms, release.platforms[0]] }),
      cliPackage,
      skillRelease,
    ),
  /duplicate release platform: darwin-arm64/,
);
assert.throws(
  () =>
    checkReleaseContract(
      changed(release, {
        platforms: [{ id: "darwin-arm64", asset: "../torg-v0.1.0-alpha.1-darwin-arm64.tar.gz" }],
      }),
      cliPackage,
      skillRelease,
    ),
  /invalid release asset for darwin-arm64/,
);
assert.throws(
  () =>
    checkReleaseContract(
      changed(release, {
        platforms: [{ id: "freebsd-x64", asset: `torg-v${version}-freebsd-x64.tar.gz` }],
      }),
      cliPackage,
      skillRelease,
    ),
  /unsupported release platform: freebsd-x64/,
);
assert.throws(
  () => checkReleaseContract({ ...release, mutableLatest: true }, cliPackage, skillRelease),
  /unknown release field: mutableLatest/,
);

console.log("check-release-contract.self-test: PASS");
