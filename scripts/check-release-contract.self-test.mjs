import { strict as assert } from "node:assert";

import { checkDistributionContract, checkReleaseContract } from "./check-release-contract.mjs";

const version = "0.1.0-alpha.3";
const release = {
  schemaVersion: 2,
  version,
  nodeVersion: "24.14.0",
  repository: "TashanGKD/tashan-orgspace",
  apiUrl: "https://orgspace.tashan.chat",
  distributionBaseUrl: "https://orgspace.tashan.chat/downloads/orgspace",
  skillAsset: `tashan-orgspace-skill-v${version}.tar.gz`,
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
const workflow = `
          platform: darwin-arm64
          platform: darwin-x64
          platform: linux-x64
      - run: node scripts/build-cli-release.mjs --output-dir dist
      - run: node scripts/build-skill-release.mjs --output-dir dist
      - run: test "$(find dist -maxdepth 1 -name '*.tar.gz' -type f | wc -l)" -eq 4
      - run: test "$(find dist -maxdepth 1 -name '*.sha256' -type f | wc -l)" -eq 4
        name: skill
      - run: curl https://orgspace.tashan.chat/v1/health
      - run: gh release create
`;
const installer = `distribution_base=$(json_string distributionBaseUrl)
case $platform in
  darwin-arm64 | darwin-x64 | linux-x64) ;;
esac
`;

function changed(value, update) {
  return Object.assign(clone(value), update);
}

function withVersion(value, nextVersion) {
  const copy = clone(value);
  copy.version = nextVersion;
  copy.skillAsset = `tashan-orgspace-skill-v${nextVersion}.tar.gz`;
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
assert.equal(checkDistributionContract(release, workflow, installer), undefined);
assert.throws(
  () =>
    checkDistributionContract(
      release,
      workflow.replace("          platform: linux-x64\n", ""),
      installer,
    ),
  /release workflow platform matrix mismatch/,
);
assert.throws(
  () => checkDistributionContract(release, workflow, installer.replace(" | linux-x64", "")),
  /installer platform allowlist mismatch/,
);
assert.throws(
  () =>
    checkDistributionContract(
      release,
      workflow.replace("      - run: node scripts/build-skill-release.mjs --output-dir dist\n", ""),
      installer,
    ),
  /release workflow missing: node scripts\/build-skill-release\.mjs/,
);
assert.throws(
  () => checkDistributionContract(release, workflow.replace("-eq 4", "-eq 3"), installer),
  /release workflow missing: test.*tar\.gz/,
);
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
for (const distributionBaseUrl of [
  "http://orgspace.tashan.chat/downloads/orgspace",
  "https://user@orgspace.tashan.chat/downloads/orgspace",
  "https://orgspace.tashan.chat/downloads/other",
]) {
  assert.throws(
    () => checkReleaseContract(changed(release, { distributionBaseUrl }), cliPackage, skillRelease),
    /release distributionBaseUrl must be the OrgSpace HTTPS download origin/,
  );
}
assert.throws(
  () =>
    checkReleaseContract(
      changed(release, { skillAsset: "../tashan-orgspace-skill-v0.1.0-alpha.3.tar.gz" }),
      cliPackage,
      skillRelease,
    ),
  /invalid release Skill asset/,
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
