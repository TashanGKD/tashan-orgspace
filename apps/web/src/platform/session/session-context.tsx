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
  login(phone: string, password: string): Promise<void>;
  register(input: {
    phone: string;
    challengeId: string;
    code: string;
    password: string;
  }): Promise<void>;
  sendVerificationCode(
    phone: string,
    purpose: "register" | "password_reset",
  ): ReturnType<OrgSpaceClient["sendVerificationCode"]>;
  resetPassword(input: {
    phone: string;
    challengeId: string;
    code: string;
    newPassword: string;
  }): Promise<void>;
  logout(): Promise<void>;
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
    async (phone: string, password: string) => {
      const result = await sdk.login({ phone, password, device });
      setState({ status: "authenticated", account: result.account });
    },
    [device, sdk],
  );
  const register = useCallback(
    async (input: { phone: string; challengeId: string; code: string; password: string }) => {
      const result = await sdk.register(
        { ...input, device },
        { idempotencyKey: mutationKey("register") },
      );
      setState({ status: "authenticated", account: result.account });
    },
    [device, sdk],
  );
  const logout = useCallback(async () => {
    await sdk.logout();
    setState({ status: "anonymous" });
  }, [sdk]);
  const sendVerificationCode = useCallback(
    (phone: string, purpose: "register" | "password_reset") =>
      sdk.sendVerificationCode(
        { phone, purpose },
        { idempotencyKey: mutationKey("verification-send") },
      ),
    [sdk],
  );
  const resetPassword = useCallback(
    async (input: { phone: string; challengeId: string; code: string; newPassword: string }) => {
      await sdk.resetPassword(input, {
        idempotencyKey: mutationKey("password-reset"),
      });
      setState({ status: "anonymous" });
    },
    [sdk],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      ...state,
      login,
      register,
      sendVerificationCode,
      resetPassword,
      logout,
    }),
    [login, logout, register, resetPassword, sendVerificationCode, state],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === undefined) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
