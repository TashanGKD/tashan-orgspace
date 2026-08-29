import { describe, expect, test } from "vitest";
import { PartnerCreateRequest, PartnerListQuery, PartnerTransferRequest } from "./partners.js";

describe("partner contracts", () => {
  test("requires a contact name and accepts approved contact fields", () => {
    expect(
      PartnerCreateRequest.parse({
        name: "张三",
        organizationName: "某研究院",
        department: "科研处",
        jobTitle: "处长",
        phone: "13812345678",
        wechat: "zhangsan",
        email: "z@example.com",
        address: "北京市",
        cooperationStage: "contacting",
        tags: ["科研"],
        notes: "会后跟进",
      }),
    ).toMatchObject({ name: "张三", cooperationStage: "contacting" });
    expect(() => PartnerCreateRequest.parse({ name: " ", cooperationStage: "lead" })).toThrow();
  });
  test("requires explicit all scope and optimistic transfer version", () => {
    expect(PartnerListQuery.parse({ owner: "all" })).toMatchObject({ owner: "all" });
    expect(
      PartnerTransferRequest.parse({
        accountId: "84ecfe2e-c11a-4a56-8735-934955bef834",
        expectedVersion: 2,
      }),
    ).toMatchObject({ expectedVersion: 2 });
  });
});
