export type AuthenticatedClientChannel = "web" | "cli";
export type RecordedActorSource = AuthenticatedClientChannel | "ai_via_cli";

export interface AuditActorContext {
  actorSource: RecordedActorSource;
  reportedActorSource: string | null;
}

export function deriveAuditActorContext(
  authenticatedChannel: AuthenticatedClientChannel,
  reportedActorSource?: string,
): AuditActorContext {
  return {
    actorSource:
      authenticatedChannel === "cli" && reportedActorSource === "ai_via_cli"
        ? "ai_via_cli"
        : authenticatedChannel,
    reportedActorSource: reportedActorSource ?? null,
  };
}
