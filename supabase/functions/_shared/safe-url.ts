import { HttpError } from "./http.ts";

const PRIVATE_HOSTS = new Set(["localhost", "localhost.localdomain", "0.0.0.0", "::", "::1"]);

function isPrivateIPv4(value: string) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || a >= 224;
}

function isPrivateIPv6(value: string) {
  const ip = value.toLowerCase().replace(/^\[|\]$/g, "");
  return ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") ||
    /^fe[89ab]/.test(ip) || ip.startsWith("ff") || ip.startsWith("2001:db8:") ||
    (ip.startsWith("::ffff:") && isPrivateIPv4(ip.slice(7)));
}

function blockedAddress(value: string) {
  return isPrivateIPv4(value) || isPrivateIPv6(value);
}

export async function assertSafePublicUrl(input: string) {
  let url: URL;
  try { url = new URL(input); } catch { throw new HttpError(400, "Invalid URL", "invalid_url"); }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new HttpError(400, "Only HTTP and HTTPS URLs are allowed", "invalid_url_protocol");
  }
  if (url.username || url.password) throw new HttpError(400, "URL credentials are not allowed", "url_credentials");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || PRIVATE_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".local") || blockedAddress(host)) {
    throw new HttpError(400, "Private network URLs are not allowed", "private_url");
  }

  let addresses: string[] = [];
  try {
    const [v4, v6] = await Promise.all([
      Deno.resolveDns(host, "A").catch(() => [] as string[]),
      Deno.resolveDns(host, "AAAA").catch(() => [] as string[]),
    ]);
    addresses = [...v4, ...v6];
  } catch {
    throw new HttpError(400, "URL host could not be resolved", "unresolvable_url");
  }
  if (!addresses.length) throw new HttpError(400, "URL host could not be resolved", "unresolvable_url");
  if (addresses.some(blockedAddress)) throw new HttpError(400, "Private network URLs are not allowed", "private_url");
  return url;
}

export async function fetchPublicHtml(input: string, maxRedirects = 5) {
  let url = await assertSafePublicUrl(input);
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent": "BewerbungenTracker/1.0 (+https://brbw.vercel.app)",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === maxRedirects) throw new HttpError(422, "Too many redirects", "redirect_failed");
      url = await assertSafePublicUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new HttpError(422, `Website returned HTTP ${response.status}`, "upstream_failed");
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) {
      throw new HttpError(422, "URL does not point to an HTML page", "not_html");
    }
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > 2_000_000) throw new HttpError(413, "Website is too large", "upstream_too_large");
    const html = await response.text();
    if (new TextEncoder().encode(html).byteLength > 2_000_000) {
      throw new HttpError(413, "Website is too large", "upstream_too_large");
    }
    return { url: url.href, html };
  }
  throw new HttpError(422, "Website could not be loaded", "upstream_failed");
}
