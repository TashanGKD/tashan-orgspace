import {
  NotificationEventType,
  NotificationPolicyPublishRequest,
  NotificationPreferenceUpdateRequest,
  NotificationRules,
} from "@tashan/contracts";
import { AuthError } from "../auth/auth-errors.js";
import type { TransactionClient } from "../db/transaction.js";
import { requireOrganizationMembership } from "../organizations/authorization.js";

const rules = NotificationRules.parse({
  approval_requested: { sms: "immediate" },
  emergency: { sms: "immediate" },
  ordinary_task: { sms: "optional" },
  deadline_one_hour: { sms: "mandatory" },
  meeting_one_hour: { sms: "mandatory" },
  daily_summary: { sms: "preference" },
  partner_follow_up: { sms: "mandatory" },
});
interface PolicyRow {
  id: string;
  organization_id: string;
  version: number;
  timezone: string;
  rules: typeof rules;
  published_at: Date;
}
export class NotificationPolicyService {
  private publicRow(row: PolicyRow, organizationVersion: number) {
    return {
      id: row.id,
      organizationId: row.organization_id,
      policyVersion: row.version,
      organizationVersion,
      timezone: row.timezone,
      rules: NotificationRules.parse(row.rules),
      publishedAt: row.published_at.toISOString(),
    };
  }
  private async admin(tx: TransactionClient, accountId: string, organizationId: string) {
    try {
      await requireOrganizationMembership(tx, accountId, organizationId, [
        "org_owner",
        "org_admin",
      ]);
    } catch {
      throw new AuthError("NOTIFICATION_FORBIDDEN", "notification policy is unavailable");
    }
  }
  public async ensureDefault(tx: TransactionClient, accountId: string, organizationId: string) {
    await this.admin(tx, accountId, organizationId);
    const [org] = await tx<
      { notification_policy_version: number }[]
    >`select notification_policy_version from organizations where id=${organizationId} for update`;
    if (!org) throw new AuthError("NOTIFICATION_FORBIDDEN", "organization unavailable");
    let version = org.notification_policy_version;
    if (version === 0) {
      version = 1;
      await tx`insert into notification_policy_versions(organization_id,version,timezone,rules,published_by_account_id)values(${organizationId},1,'Asia/Shanghai',${tx.json(rules)},${accountId})`;
      await tx`update organizations set notification_policy_version=1,updated_at=now() where id=${organizationId}`;
    }
    const [row] = await tx<
      PolicyRow[]
    >`select * from notification_policy_versions where organization_id=${organizationId} and version=${version}`;
    if (!row) throw new Error("notification policy missing");
    return this.publicRow(row, version);
  }
  public async publish(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    raw: unknown,
  ) {
    const input = NotificationPolicyPublishRequest.parse(raw);
    await this.admin(tx, accountId, organizationId);
    const [org] = await tx<
      { notification_policy_version: number }[]
    >`select notification_policy_version from organizations where id=${organizationId} for update`;
    if (!org) throw new AuthError("NOTIFICATION_FORBIDDEN", "organization unavailable");
    if (org.notification_policy_version !== input.expectedVersion)
      throw new AuthError("NOTIFICATION_VERSION_CONFLICT", "notification policy changed");
    const version = org.notification_policy_version + 1;
    const [row] = await tx<
      PolicyRow[]
    >`insert into notification_policy_versions(organization_id,version,timezone,rules,published_by_account_id)values(${organizationId},${version},${input.timezone},${tx.json(rules)},${accountId})returning *`;
    await tx`update organizations set notification_policy_version=${version},updated_at=now() where id=${organizationId}`;
    if (!row) throw new Error("notification policy insert failed");
    return this.publicRow(row, version);
  }
  public async setPreference(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    raw: unknown,
  ) {
    const input = NotificationPreferenceUpdateRequest.parse(raw);
    await requireOrganizationMembership(tx, accountId, organizationId);
    await tx`insert into notification_preferences(organization_id,account_id,daily_summary_enabled)values(${organizationId},${accountId},${input.dailySummaryEnabled})on conflict(organization_id,account_id)do update set daily_summary_enabled=excluded.daily_summary_enabled,updated_at=now()`;
    return { organizationId, accountId, ...input };
  }
  public async getPreference(tx: TransactionClient, accountId: string, organizationId: string) {
    await requireOrganizationMembership(tx, accountId, organizationId);
    const [row] = await tx<
      { daily_summary_enabled: boolean }[]
    >`select daily_summary_enabled from notification_preferences where organization_id=${organizationId} and account_id=${accountId}`;
    return {
      organizationId,
      accountId,
      dailySummaryEnabled: row?.daily_summary_enabled ?? true,
    };
  }
  public async getPolicy(tx: TransactionClient, accountId: string, organizationId: string) {
    return this.ensureDefault(tx, accountId, organizationId);
  }
  public async resolve(
    tx: TransactionClient,
    accountId: string,
    organizationId: string,
    eventTypeInput: unknown,
    explicitSms: boolean,
  ) {
    const eventType = NotificationEventType.parse(eventTypeInput);
    await requireOrganizationMembership(tx, accountId, organizationId);
    const [preference] = await tx<
      { daily_summary_enabled: boolean }[]
    >`select daily_summary_enabled from notification_preferences where organization_id=${organizationId} and account_id=${accountId}`;
    const sms =
      eventType === "ordinary_task"
        ? explicitSms
        : eventType === "daily_summary"
          ? (preference?.daily_summary_enabled ?? true)
          : true;
    return { inApp: true, sms, eventType };
  }
}
