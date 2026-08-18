import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { AccountSummary, DeviceLoginMetadata } from "@tashan/contracts";
import { OrgSpaceApiError, type OrgSpaceClient } from "@tashan/sdk";

type SessionState =
  | { status: "restoring"; account?: never }
  | { status: "anonymous"; account?: never }
  | { status: "authenticated"; account: AccountSummary };

interface SessionActions {
  login(username: string, password: string): Promise<void>;
  register(username: string, password: string): ReturnType<OrgSpaceClient["register"]>;
  logout(): Promise<void>;
  startPhoneVerification(phone: string): ReturnType<OrgSpaceClient["startPhoneVerification"]>;
  confirmPhoneVerification(challengeId: string, code: string): Promise<void>;
}

export type SessionContextValue = SessionState & SessionActions;

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

function mutationKey(action: string): string {
  return `web-${action}-${crypto.randomUUID()}`;
}

export function SessionProvider({
  children,
  sdk,
  device,
}: {
  children: ReactNode;
  sdk: OrgSpaceClient;
  device: DeviceLoginMetadata;
}) {
  const [state, setState] = useState<SessionState>({ status: "restoring" });

  useEffect(() => {
    let active = true;
    void sdk
      .refresh()
      .then(async () => {
        if (!active) return;
        const identity = await sdk.whoami();
        if (active) setState({ status: "authenticated", account: identity.account });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof OrgSpaceApiError && error.code === "AUTH_REQUIRED") {
          setState({ status: "anonymous" });
          return;
        }
        setState({ status: "anonymous" });
      });
    return () => {
      active = false;
    };
  }, [sdk]);

  const login = useCallback(
    async (username: string, password: string) => {
      const result = await sdk.login({ username, password, device });
      setState({ status: "authenticated", account: result.account });
    },
    [device, sdk],
  );
  const register = useCallback(
    (username: string, password: string) =>
      sdk.register({ username, password }, { idempotencyKey: mutationKey("register") }),
    [sdk],
  );
  const logout = useCallback(async () => {
    await sdk.logout();
    setState({ status: "anonymous" });
  }, [sdk]);
  const startPhoneVerification = useCallback(
    (phone: string) =>
      sdk.startPhoneVerification(
        { phone },
        { idempotencyKey: mutationKey("phone-verification-start") },
      ),
    [sdk],
  );
  const confirmPhoneVerification = useCallback(
    async (challengeId: string, code: string) => {
      const result = await sdk.confirmPhoneVerification(
        { challengeId, code },
        { idempotencyKey: mutationKey("phone-verification-confirm") },
      );
      setState((current) =>
        current.status === "authenticated"
          ? {
              status: "authenticated",
              account: {
                ...current.account,
                phone: result.phone,
                phoneVerifiedAt: result.verifiedAt,
              },
            }
          : current,
      );
    },
    [sdk],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      ...state,
      login,
      register,
      logout,
      startPhoneVerification,
      confirmPhoneVerification,
    }),
    [confirmPhoneVerification, login, logout, register, startPhoneVerification, state],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === undefined) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
