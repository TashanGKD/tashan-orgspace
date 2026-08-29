import { describe, expect, test } from "vitest";

import { registerAndVerify, runCliScenario } from "./support/flows.js";

describe("file authorization", () => {
  test("enforces personal, organization and folder boundaries through the CLI", async () => {
    const alice = await registerAndVerify("files-auth-alice", "+8613800138411");
    const bob = await registerAndVerify("files-auth-bob", "+8613800138412");
    const result = await runCliScenario<{
      personalSpacesDistinct: boolean;
      publicChildId: string;
      adminMetadata: { entry: { effectiveRole: string } };
      adminDownload: { exitCode: number; stderr: string };
      managerRecovered: boolean;
      editorChildId: string;
      editorCannotManage: { exitCode: number; stderr: string };
      viewerReadId: string;
      viewerCannotWrite: { exitCode: number; stderr: string };
      personalIsolation: { exitCode: number; stderr: string };
      crossOrganization: { exitCode: number; stderr: string };
      removedMember: { exitCode: number; stderr: string };
    }>({ type: "files-authorization", alice, bob });

    expect(result.personalSpacesDistinct).toBe(true);
    expect(result.publicChildId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.adminMetadata.entry.effectiveRole).toBe("viewer");
    expect(result.adminDownload).toMatchObject({ exitCode: 1 });
    expect(result.adminDownload.stderr).toContain("FILE_FORBIDDEN");
    expect(result.managerRecovered).toBe(true);
    expect(result.editorChildId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.editorCannotManage).toMatchObject({ exitCode: 1 });
    expect(result.editorCannotManage.stderr).toContain("FILE_FORBIDDEN");
    expect(result.viewerReadId).toMatch(/^[0-9a-f-]{36}$/);
    for (const denial of [
      result.viewerCannotWrite,
      result.personalIsolation,
      result.crossOrganization,
      result.removedMember,
    ]) {
      expect(denial.exitCode).toBe(1);
      expect(denial.stderr).toMatch(/FILE_FORBIDDEN|SPACE_FORBIDDEN/);
    }
  });
});
