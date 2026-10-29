// Optional cloud account (Supabase): sign in with a 6-digit code sent by email, then keep the
// progress and the profile in sync across devices. Plain REST calls, no client library.
// The publishable key is meant to ship in the app; row level security limits every user to
// their own rows (see supabase/migrations).
const URL = "https://izthfajqnazsgdhflcel.supabase.co";
const KEY = "sb_publishable_Bgk_qw6d9GZurZKNSXLFAQ_rj2FQJ61";
const SESSION = "kp-session";

let session = (() => { try { return JSON.parse(localStorage.getItem(SESSION)); } catch { return null; } })();
function save(s) {
  session = s && { access_token: s.access_token, refresh_token: s.refresh_token, user: { id: s.user.id, email: s.user.email },
    expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + (s.expires_in ?? 3600) };
  try { session ? localStorage.setItem(SESSION, JSON.stringify(session)) : localStorage.removeItem(SESSION); } catch {}
}

async function call(path, { method = "GET", body, token, prefer } = {}) {
  const headers = { apikey: KEY, "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(URL + path, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.msg || data?.message || data?.error_description || `Error ${res.status}`);
    err.status = res.status; err.code = data?.error_code ?? data?.code;
    throw err;
  }
  return data;
}

export const user = () => session?.user ?? null;

// A valid access token, refreshed when it is about to expire; null when signed out.
async function token() {
  if (!session) return null;
  if (session.expires_at * 1000 - Date.now() > 60_000) return session.access_token;
  try {
    save(await call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: session.refresh_token } }));
  } catch (e) {
    if (e.status === 400 || e.status === 401) save(null); // the refresh token is gone: sign in again
    throw e;
  }
  return session.access_token;
}

export const sendCode = email => call("/auth/v1/otp", { method: "POST", body: { email, create_user: true } });
export async function verifyCode(email, code) {
  save(await call("/auth/v1/verify", { method: "POST", body: { type: "email", email, token: code } }));
  return user();
}
export async function signOut() {
  try { const t = await token(); if (t) await call("/auth/v1/logout", { method: "POST", token: t }); } catch {}
  save(null);
}

// The saved progress document, or null if this account has none yet.
export async function pullProgress() {
  const rows = await call("/rest/v1/progress?select=data,updated_at", { token: await token() });
  return rows?.[0] ?? null;
}
export async function pushProgress(data) {
  await call("/rest/v1/progress", { method: "POST", token: await token(), prefer: "resolution=merge-duplicates,return=minimal",
    body: { user_id: user().id, data, updated_at: new Date().toISOString() } });
}

export async function pullProfile() {
  const rows = await call("/rest/v1/profiles?select=display_name,daily_goal,target_level,target_date,updated_at", { token: await token() });
  return rows?.[0] ?? null;
}
export async function pushProfile(p) {
  await call("/rest/v1/profiles", { method: "POST", token: await token(), prefer: "resolution=merge-duplicates,return=minimal",
    body: { user_id: user().id, display_name: p.name || null, daily_goal: p.goal, target_level: p.target || null,
      target_date: p.targetDate || null, updated_at: p.updatedAt ?? new Date().toISOString() } });
}
