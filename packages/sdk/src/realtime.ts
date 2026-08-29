export function encodeRealtimeAccessToken(token: string) {
  if (!/^[\x21-\x7e]+$/.test(token) || token.length > 16_384)
    throw new Error("realtime access token is invalid");
  return btoa(token).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
