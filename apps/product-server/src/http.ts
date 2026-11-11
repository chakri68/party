export { json } from "@games/server/policy";

export const SESSION_COOKIE = "cp_session";
export const OAUTH_COOKIE = "cp_oauth";

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function setCookie(name: string, value: string, maxAgeSeconds: number, path = "/"): string {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=${path}; Max-Age=${maxAgeSeconds}`;
}

export function clearCookie(name: string, path = "/"): string {
  return setCookie(name, "", 0, path);
}

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

/** Only same-site paths: starts with one "/", never "//" or "/\" (browsers read both as another host). */
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || next.length > 500) return "/account";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/account";
  if (/[\u0000-\u001f\u007f]/.test(next)) return "/account";
  return next;
}

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}
