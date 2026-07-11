import dns from 'node:dns/promises';
import net from 'node:net';
import { AppError } from './errors.js';

function ipv4Number(address: string): number | undefined {
  if (!net.isIPv4(address)) return undefined;
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0;
}

function inCidr(address: string, base: string, prefix: number): boolean {
  const value = ipv4Number(address);
  const network = ipv4Number(base);
  if (value === undefined || network === undefined) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (network & mask);
}

export function isPrivateOrReservedIp(address: string): boolean {
  if (net.isIPv4(address)) {
    return [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
      ['224.0.0.0', 4], ['240.0.0.0', 4]
    ].some(([base, prefix]) => inCidr(address, base as string, prefix as number));
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return isPrivateOrReservedIp(mapped);
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd')
      || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')
      || normalized.startsWith('2001:db8:');
  }
  return true;
}

export async function assertSafeOutboundUrl(rawUrl: string, allowPrivate = false): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError('invalid_url', 422, 'The URL is invalid.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new AppError('unsupported_url_protocol', 422);
  if (url.username || url.password) throw new AppError('url_credentials_not_allowed', 422);
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    if (!allowPrivate) throw new AppError('private_network_url_not_allowed', 403);
    return url;
  }
  let literal: string[];
  try {
    literal = net.isIP(hostname) ? [hostname] : (await dns.lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
  } catch {
    throw new AppError('dns_resolution_failed', 422, 'The hostname could not be resolved.');
  }
  if (literal.length === 0) throw new AppError('dns_resolution_failed', 422);
  if (!allowPrivate && literal.some(isPrivateOrReservedIp)) throw new AppError('private_network_url_not_allowed', 403);
  return url;
}

export async function fetchWithValidatedRedirects(
  rawUrl: string,
  init: RequestInit,
  options: { timeoutMs: number; maxRedirects?: number; allowPrivate?: boolean }
): Promise<Response> {
  let current = rawUrl;
  const maxRedirects = options.maxRedirects ?? 3;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const url = await assertSafeOutboundUrl(current, options.allowPrivate === true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('outbound_timeout')), options.timeoutMs);
    timer.unref();
    try {
      const signals = [controller.signal, ...(init.signal ? [init.signal] : [])];
      const response = await fetch(url, { ...init, redirect: 'manual', signal: signals.length === 1 ? controller.signal : AbortSignal.any(signals) });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return response;
        if (redirect === maxRedirects) throw new AppError('too_many_redirects', 422);
        current = new URL(location, url).toString();
        continue;
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new AppError('too_many_redirects', 422);
}

export async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new AppError('web_response_too_large', 413);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
