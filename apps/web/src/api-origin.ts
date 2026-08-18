export function resolveWebApiOrigin({
  origin,
  override,
}: {
  origin: string;
  override?: string;
}): string {
  const candidate = override ?? origin;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Web API URL must be an HTTP(S) origin");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(
      "Web API URL must be an HTTP(S) origin without credentials, path, query or hash",
    );
  }
  return parsed.origin;
}
