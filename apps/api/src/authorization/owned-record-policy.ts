export type OwnedRecordRole = "org_owner" | "org_admin" | "member";

export class OwnedRecordUnavailableError extends Error {
  public constructor() {
    super("record is unavailable");
    this.name = "OwnedRecordUnavailableError";
  }
}

export class OwnedOrganizationRecordPolicy {
  public requireAccess(
    actor: {
      accountId: string;
      organizationId: string;
      role: OwnedRecordRole;
      active?: boolean;
    },
    record: { organizationId: string; ownerAccountId: string },
  ): "owner" | "administrator" {
    if (actor.active === false || actor.organizationId !== record.organizationId) {
      throw new OwnedRecordUnavailableError();
    }
    if (actor.role === "org_owner" || actor.role === "org_admin") return "administrator";
    if (actor.accountId === record.ownerAccountId) return "owner";
    throw new OwnedRecordUnavailableError();
  }
}
