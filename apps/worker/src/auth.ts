/**
 * Optional accounts.
 *
 * Signing in is a convenience, never a requirement: nothing in the game asks
 * whether you have an account, and every mode is playable without one. What an
 * account buys you is a high score that survives changing browser or device,
 * and a name and picture that come with you.
 *
 * The shape is deliberately small:
 *
 *   - Google is the only identity provider. It is free, everyone has one, and
 *     it means this codebase never handles a password.
 *   - A session is a signed cookie, not a stored record. Verifying one is a
 *     single HMAC, so the common case touches no storage at all.
 *   - Profiles live in a Durable Object keyed by the Google subject id. There
 *     is no user database to migrate, back up or leak.
 *
 * Nothing here runs unless the deployment has been given credentials. Until
 * then `/api/auth/config` reports the feature as unavailable and the client
 * simply does not offer it.
 */

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

/** Google credentials, or null when this deployment has not been given any. */
export function googleConfig(env: Env): GoogleConfig | null {
  const clientId = (env.GOOGLE_CLIENT_ID ?? '').trim();
  const clientSecret = (env.GOOGLE_CLIENT_SECRET ?? '').trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isLocalHost(url: URL): boolean {
  return (
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]' ||
    url.hostname.endsWith('.localhost')
  );
}

/**
 * Whether the "sign in as a local test user" shortcut is available.
 *
 * Two conditions, both required: no Google credentials are configured, and the
 * request arrived on a loopback hostname. A deployed Worker is reached through
 * its own domain, so this can never be true in production — and configuring
 * Google, which production must do to have sign-in at all, turns it off as
 * well. It exists so the account flow can be exercised locally without asking
 * anyone to register an OAuth client first.
 */
export function devLoginAllowed(env: Env, url: URL): boolean {
  return googleConfig(env) === null && isLocalHost(url);
}

/**
 * The key sessions are signed with.
 *
 * Production must set SESSION_SECRET. Locally, where the only sessions that
 * exist belong to the dev-login user, a fixed development key is used instead
 * so `wrangler dev` needs no setup.
 */
function sessionSecret(env: Env, url: URL): string | null {
  const secret = (env.SESSION_SECRET ?? '').trim();
  if (secret) return secret;
  if (devLoginAllowed(env, url)) return 'close-enough-local-development-key';
  return null;
}

/** True when this deployment can issue sessions at all. */
export function authAvailable(env: Env, url: URL): boolean {
  return sessionSecret(env, url) !== null && (googleConfig(env) !== null || devLoginAllowed(env, url));
}

/* ------------------------------------------------------------------ *
 * Signing
 * ------------------------------------------------------------------ */

const encoder = new TextEncoder();

function base64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  return base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await hmacKey(secret);
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

/** Constant-time-ish compare via the platform's own verify. */
async function verify(secret: string, payload: string, signature: string): Promise<boolean> {
  try {
    const key = await hmacKey(secret);
    return await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64url(signature),
      encoder.encode(payload),
    );
  } catch {
    return false;
  }
}

async function seal(secret: string, value: unknown): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify(value)));
  return `${payload}.${await sign(secret, payload)}`;
}

async function unseal<T>(secret: string, token: string | null): Promise<T | null> {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  if (!(await verify(secret, payload, token.slice(dot + 1)))) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as T;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Cookies
 * ------------------------------------------------------------------ */

export const SESSION_COOKIE = 'ce_session';
const OAUTH_COOKIE = 'ce_oauth';
const SESSION_DAYS = 30;

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function cookie(name: string, value: string, url: URL, maxAgeSeconds: number): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  // Loopback development is served over plain http, where a Secure cookie is
  // accepted by some browsers and silently dropped by others.
  if (url.protocol === 'https:') parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, url: URL): string {
  return cookie(name, '', url, 0);
}

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

export interface Session {
  /** Durable Object name for this user's profile. */
  uid: string;
  /** Issued at, epoch ms. */
  iat: number;
  /** Expires at, epoch ms. */
  exp: number;
}

export async function issueSession(env: Env, url: URL, uid: string): Promise<string | null> {
  const secret = sessionSecret(env, url);
  if (!secret) return null;
  const now = Date.now();
  const session: Session = { uid, iat: now, exp: now + SESSION_DAYS * 86_400_000 };
  return cookie(SESSION_COOKIE, await seal(secret, session), url, SESSION_DAYS * 86_400);
}

export async function readSession(request: Request, env: Env, url: URL): Promise<Session | null> {
  const secret = sessionSecret(env, url);
  if (!secret) return null;
  const session = await unseal<Session>(secret, readCookie(request, SESSION_COOKIE));
  if (!session || typeof session.uid !== 'string' || !session.uid) return null;
  if (typeof session.exp !== 'number' || session.exp < Date.now()) return null;
  return session;
}

/* ------------------------------------------------------------------ *
 * The Google round trip
 * ------------------------------------------------------------------ */

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const OAUTH_TTL_SECONDS = 600;

interface OAuthState {
  state: string;
  /** Where to send the browser afterwards. Same-origin paths only. */
  next: string;
}

export function redirectUri(url: URL): string {
  return `${url.origin}/api/auth/google/callback`;
}

/** Start the flow: remember a one-time state, then hand off to Google. */
export async function beginGoogleSignIn(env: Env, url: URL): Promise<Response | null> {
  const config = googleConfig(env);
  const secret = sessionSecret(env, url);
  if (!config || !secret) return null;

  const state = base64url(crypto.getRandomValues(new Uint8Array(18)));
  const raw = url.searchParams.get('next') ?? '/';
  // Only ever bounce back into this app: an absolute URL here would make the
  // sign-in link an open redirect.
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';

  const authorize = new URL(GOOGLE_AUTH);
  authorize.searchParams.set('client_id', config.clientId);
  authorize.searchParams.set('redirect_uri', redirectUri(url));
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', 'openid profile email');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('prompt', 'select_account');

  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.toString(),
      'set-cookie': cookie(
        OAUTH_COOKIE,
        await seal(secret, { state, next } satisfies OAuthState),
        url,
        OAUTH_TTL_SECONDS,
      ),
    },
  });
}

export interface GoogleIdentity {
  /** Google's stable subject id. Never shown to anyone. */
  sub: string;
  name: string;
  email?: string;
  picture?: string;
}

export interface CallbackResult {
  identity: GoogleIdentity;
  next: string;
}

/**
 * Finish the flow.
 *
 * The id token is read without verifying its signature, which is correct here
 * and only here: it was just fetched over TLS directly from Google's token
 * endpoint, so its provenance is already established. (A token that arrived
 * any other way would have to be verified against Google's JWKS.)
 */
export async function completeGoogleSignIn(
  request: Request,
  env: Env,
  url: URL,
): Promise<CallbackResult | { error: string }> {
  const config = googleConfig(env);
  const secret = sessionSecret(env, url);
  if (!config || !secret) return { error: 'Sign-in is not configured.' };

  const stored = await unseal<OAuthState>(secret, readCookie(request, OAUTH_COOKIE));
  const state = url.searchParams.get('state');
  if (!stored || !state || stored.state !== state) {
    return { error: 'That sign-in link has expired. Try again.' };
  }

  const code = url.searchParams.get('code');
  if (!code) return { error: url.searchParams.get('error') ?? 'Sign-in was cancelled.' };

  const response = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri(url),
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) return { error: 'Google refused the sign-in. Try again.' };

  const body = (await response.json().catch(() => null)) as { id_token?: string } | null;
  const idToken = body?.id_token;
  if (!idToken) return { error: 'Google did not return an identity.' };

  const claims = decodeJwtPayload(idToken);
  if (!claims || typeof claims.sub !== 'string') return { error: 'Google identity was unreadable.' };

  return {
    identity: {
      sub: claims.sub,
      name: typeof claims.name === 'string' ? claims.name : 'Player',
      email: typeof claims.email === 'string' ? claims.email : undefined,
      picture: typeof claims.picture === 'string' ? claims.picture : undefined,
    },
    next: stored.next,
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64url(parts[1]))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function clearOAuthCookie(url: URL): string {
  return clearCookie(OAUTH_COOKIE, url);
}

/* ------------------------------------------------------------------ *
 * Avatars
 * ------------------------------------------------------------------ */

/** Anything larger than this is refused rather than stored. */
export const MAX_AVATAR_BYTES = 40_000;
const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Validate a data-URL avatar.
 *
 * Only raster image types, only base64, only small. Returning the string
 * unchanged (rather than re-encoding) is safe because it is never interpreted
 * as anything but an <img> source, and the type list excludes SVG — which can
 * carry script.
 */
export function validAvatar(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_AVATAR_BYTES) return null;
  const match = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match || !AVATAR_TYPES.includes(match[1])) return null;
  return value;
}

/**
 * Copy the Google profile picture into the account.
 *
 * Stored rather than hot-linked so the page makes no third-party requests, and
 * so a later change at Google cannot break or silently swap someone's avatar.
 * Failure is fine: the initials avatar is always there as a fallback.
 */
export async function fetchAvatar(pictureUrl: string | undefined): Promise<string | null> {
  if (!pictureUrl || !pictureUrl.startsWith('https://')) return null;
  try {
    const response = await fetch(pictureUrl, { cf: { cacheTtl: 3600 } } as RequestInit);
    if (!response.ok) return null;
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!AVATAR_TYPES.includes(type)) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    // base64 inflates by about a third; check against the stored size.
    if (bytes.byteLength * 1.4 > MAX_AVATAR_BYTES) return null;
    return `data:${type};base64,${base64(bytes)}`;
  } catch {
    return null;
  }
}
