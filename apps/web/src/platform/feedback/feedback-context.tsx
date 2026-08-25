import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { OrgSpaceApiError } from "@tashan/sdk";

export interface PublicFeedback {
  kind: "error" | "notice";
  message: string;
  requestId?: string;
}

interface FeedbackContextValue {
  feedback: PublicFeedback | undefined;
  clear(): void;
  showError(error: unknown): void;
  showNotice(message: string): void;
}

const FeedbackContext = createContext<FeedbackContextValue | undefined>(undefined);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [feedback, setFeedback] = useState<PublicFeedback>();
  const value = useMemo<FeedbackContextValue>(
    () => ({
      feedback,
      clear: () => setFeedback(undefined),
      showError: (error) =>
        setFeedback(
          error instanceof OrgSpaceApiError
            ? { kind: "error", message: error.message, requestId: error.requestId }
            : { kind: "error", message: "请求没有完成，请稍后重试。" },
        ),
      showNotice: (message) => setFeedback({ kind: "notice", message }),
    }),
    [feedback],
  );
  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}

export function useFeedback(): FeedbackContextValue {
  const value = useContext(FeedbackContext);
  if (value === undefined) throw new Error("useFeedback must be used inside FeedbackProvider");
  return value;
}

export function GlobalFeedback() {
  const { feedback } = useFeedback();
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedback?.kind === "error") errorRef.current?.focus();
  }, [feedback]);

  if (feedback === undefined) return null;
  if (feedback.kind === "notice") {
    return (
      <div aria-live="polite" className="global-message success-message" role="status">
        {feedback.message}
      </div>
    );
  }
  return (
    <div
      aria-live="assertive"
      className="global-message error-message"
      ref={errorRef}
      role="alert"
      tabIndex={-1}
    >
      <span>{feedback.message}</span>
      {feedback.requestId === undefined ? null : <code>{feedback.requestId}</code>}
    </div>
  );
}
