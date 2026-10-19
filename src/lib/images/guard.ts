import { lookup as dnsLookup } from "node:dns/promises";

/**
 * SSRF guard for the few server-side fetches the image waterfall makes (CR-010). The server only ever fetches a URL
 * that Qloo returned (a venue website, or an image found on it): http(s) only, ports 80/443 only, no credentials, and
 * never a loopback, private, link-local or otherwise internal address (checked on every redirect hop too).
 */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export type HostLookup = (hostname: string) => Promise<string[]>;

export const defaultLookup: HostLookup = async (hostname) => (await dnsLookup(hostname, { all: true })).map((entry) => entry.address);

/** True for addresses that must never be fetched. Accepts IPv4 and IPv6 text forms. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped?.[1]) return isPrivateAddress(mapped[1]);
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
    );
  }
  if (ip.includes(":")) {
    return ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || /^fe[89ab]/.test(ip) || ip.startsWith("ff");
  }
  return true; // not an address we understand
}

const INTERNAL_NAMES = /(^|\.)(localhost|local|internal|localdomain|home|lan|corp)$/;

export interface GuardOptions {
  lookup?: HostLookup;
  /** Tests only: allow 127.0.0.1 / localhost over http (the local mock server). */
  allowLoopback?: boolean;
}

/** Parse and vet a URL before fetching it. Throws UnsafeUrlError, never returns an unsafe URL. */
export async function assertPublicUrl(raw: string, options: GuardOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("not a URL");
  }
  const loopback = options.allowLoopback === true && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("protocol");
  if (url.username || url.password) throw new UnsafeUrlError("credentials");
  if (!loopback && url.port !== "" && url.port !== "80" && url.port !== "443") throw new UnsafeUrlError("port");
  if (loopback) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (INTERNAL_NAMES.test(host) || !host.includes(".") && !host.includes(":")) throw new UnsafeUrlError("internal host");
  const literal = /^[\d.]+$/.test(host) || host.includes(":");
  if (literal) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError("private address");
    return url;
  }
  let addresses: string[];
  try {
    addresses = await (options.lookup ?? defaultLookup)(host);
  } catch {
    throw new UnsafeUrlError("host does not resolve");
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new UnsafeUrlError("private address");
  return url;
}

export interface SafeFetchOptions extends GuardOptions {
  fetchImpl?: typeof fetch;
  timeoutMs: number;
  maxRedirects?: number;
}

/** fetch with the guard applied to the first URL and every redirect, one overall timeout, no cookies. */
export async function safeFetch(rawUrl: string, init: RequestInit, options: SafeFetchOptions): Promise<Response> {
  const { fetchImpl = fetch, timeoutMs, maxRedirects = 3 } = options;
  const signal = AbortSignal.timeout(timeoutMs);
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicUrl(current, options);
    const response = await fetchImpl(url.toString(), { ...init, redirect: "manual", signal, credentials: "omit", cache: "no-store" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new UnsafeUrlError("redirect without location");
      current = new URL(location, url).toString();
      continue;
    }
    return response;
  }
  throw new UnsafeUrlError("too many redirects");
}
