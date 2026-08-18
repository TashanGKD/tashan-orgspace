import * as ipaddr from "ipaddr.js";

const MAX_FORWARDED_ADDRESSES = 20;

function parseAddress(rawAddress: string): ipaddr.IPv4 | ipaddr.IPv6 {
  const address = ipaddr.parse(rawAddress.trim());
  if (address.kind() === "ipv6") {
    const ipv6 = address as ipaddr.IPv6;
    if (ipv6.isIPv4MappedAddress()) return ipv6.toIPv4Address();
  }
  return address;
}

export function normalizeIpAddress(rawAddress: string): string {
  return parseAddress(rawAddress).toString();
}

function isTrusted(address: ipaddr.IPv4 | ipaddr.IPv6, trustedProxies: readonly string[]): boolean {
  return trustedProxies.some((cidr) => {
    const [range, prefix] = ipaddr.parseCIDR(cidr);
    return address.kind() === range.kind() && address.match(range, prefix);
  });
}

export interface ResolveClientIpInput {
  peer: string;
  forwardedFor?: string;
  trustedProxies: readonly string[];
}

export interface ResolvedClientIp {
  clientIp: string;
  proxyChain: string[];
}

export function validateTrustedProxyCidrs(cidrs: readonly string[]): void {
  for (const cidr of cidrs) ipaddr.parseCIDR(cidr);
}

export function resolveClientIp(input: ResolveClientIpInput): ResolvedClientIp {
  const peer = parseAddress(input.peer);
  const peerText = peer.toString();
  if (!isTrusted(peer, input.trustedProxies) || input.forwardedFor === undefined) {
    return { clientIp: peerText, proxyChain: [] };
  }

  const forwarded = input.forwardedFor.split(",").map((part) => part.trim());
  if (
    forwarded.length === 0 ||
    forwarded.length > MAX_FORWARDED_ADDRESSES ||
    forwarded.some((address) => address === "")
  ) {
    return { clientIp: peerText, proxyChain: [] };
  }

  let normalizedForwarded: string[];
  try {
    normalizedForwarded = forwarded.map(normalizeIpAddress);
  } catch {
    return { clientIp: peerText, proxyChain: [] };
  }

  const completeChain = [...normalizedForwarded, peerText];
  const trustedSuffix: string[] = [];
  for (let index = completeChain.length - 1; index >= 0; index -= 1) {
    const address = completeChain[index];
    if (address === undefined) break;
    if (!isTrusted(parseAddress(address), input.trustedProxies)) {
      return { clientIp: address, proxyChain: trustedSuffix.reverse() };
    }
    trustedSuffix.push(address);
  }

  const leftmost = completeChain[0];
  return { clientIp: leftmost ?? peerText, proxyChain: trustedSuffix.reverse().slice(1) };
}
