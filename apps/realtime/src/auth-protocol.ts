export function accessTokenFromProtocols(raw: string | undefined) {
  if (!raw) throw new Error("realtime protocol is required");
  const protocols = raw.split(",").map((value) => value.trim());
  if (protocols.filter((value) => value === "torg.realtime.v1").length !== 1)
    throw new Error("realtime protocol is invalid");
  const tokens = protocols.filter((value) => value.startsWith("torg.token."));
  if (tokens.length !== 1) throw new Error("exactly one realtime token is required");
  const encoded = tokens[0]!.slice("torg.token.".length);
  if (!/^[A-Za-z0-9_-]{20,22000}$/.test(encoded)) throw new Error("realtime token is invalid");
  const token = Buffer.from(encoded, "base64url").toString("utf8");
  if (token.length > 16_384 || token.split(".").length !== 3)
    throw new Error("realtime token is invalid");
  return token;
}
