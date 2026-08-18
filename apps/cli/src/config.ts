import { z } from "zod";

const CliEnvironment = z.enum(["development", "production"]);

export function resolveCliConfig(environment: Record<string, string | undefined>) {
  const runtime = CliEnvironment.parse(environment.TORG_ENV ?? "development");
  const configuredUrl = environment.TORG_API_URL?.trim();
  if (runtime === "production" && (configuredUrl === undefined || configuredUrl === "")) {
    throw new Error("TORG_API_URL is required in production");
  }
  const apiUrl = configuredUrl || "http://127.0.0.1:4110";
  const parsed = new URL(apiUrl);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error("TORG_API_URL must be an HTTP(S) URL without embedded credentials");
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new Error("TORG_API_URL must not contain a query or hash");
  }
  if (runtime === "production" && parsed.protocol !== "https:") {
    throw new Error("production TORG_API_URL must use HTTPS");
  }
  return {
    runtime,
    apiUrl: parsed.toString().replace(/\/$/, ""),
    credentialFile: environment.TORG_CREDENTIAL_FILE?.trim() || undefined,
  };
}
