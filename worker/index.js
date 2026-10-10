// Worker Cloudflare: serve il sito statico e, sotto /api, invia le notifiche
// push. Non ha credenziali proprie su Firebase: legge utenti e iscrizioni con
// il token di chi ha salvato, quindi valgono le stesse regole Firestore
// dell'app (solo lo staff può far partire notifiche agli altri).

import { importVapidKey, sendPush } from './webpush.js';

const STAFF = ['admin', 'head_coach', 'assistant_coach', 'athletic_trainer', 'gk_coach', 'team_manager'];
// Chi riceve cosa: «staff» è la gestione della squadra, «all» comprende i giocatori.
const AUDIENCE = {
  staff: new Set([...STAFF, 'sporting_director']),
  all: new Set([...STAFF, 'sporting_director', 'readonly', 'player'])
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (url.pathname === '/api/push-key' && request.method === 'GET') {
        return json({ key: env.VAPID_PUBLIC_KEY || null, ready: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) });
      }
      if (url.pathname === '/api/notify' && request.method === 'POST') return await notify(request, env);
      return json({ error: 'not_found' }, 404);
    } catch (e) {
      return json({ error: 'internal', message: String(e?.message || e) }, 500);
    }
  }
};

async function notify(request, env) {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return json({ error: 'push_not_configured' }, 503);
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const projectId = env.FIREBASE_PROJECT_ID;
  const claims = await verifyFirebaseToken(token, projectId);
  if (!claims) return json({ error: 'unauthorized' }, 401);

  const input = await request.json().catch(() => ({}));
  const payload = {
    title: String(input.title || 'Settimo Milanese').slice(0, 80),
    body: String(input.body || '').slice(0, 240),
    url: typeof input.url === 'string' && input.url.startsWith('/') ? input.url.slice(0, 300) : '/',
    tag: String(input.tag || '').slice(0, 80) || undefined,
    urgent: !!input.urgent
  };
  const fs = firestore(projectId, token);

  const me = await fs.get(`users/${claims.sub}`);
  if (!me || me.active === false) return json({ error: 'forbidden' }, 403);

  let subs;
  let recipients;
  if (input.test) {
    // Prova: solo sui dispositivi di chi la chiede.
    subs = await fs.query('pushSubs', 'uid', claims.sub);
    recipients = subs;
  } else {
    if (!STAFF.includes(me.role)) return json({ error: 'forbidden' }, 403);
    const audience = AUDIENCE[input.audience] || AUDIENCE.staff;
    const [users, all] = await Promise.all([fs.list('users'), fs.list('pushSubs')]);
    const byUid = new Map(users.map((u) => [u.__id, u]));
    subs = all;
    recipients = all.filter((s) => {
      const u = byUid.get(s.uid);
      return s.uid !== claims.sub && u && u.active !== false && audience.has(u.role || 'player');
    });
  }

  const vapid = {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: await importVapidKey(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY),
    subject: env.VAPID_SUBJECT || 'https://settimo-manager.mattia-franchi89.workers.dev'
  };

  let sent = 0, failed = 0, removed = 0;
  await Promise.all(recipients.map(async (s) => {
    try {
      const status = await sendPush(s, payload, vapid);
      if (status >= 200 && status < 300) sent++;
      else {
        failed++;
        // Iscrizione scaduta o revocata dal telefono: si toglie.
        if (status === 404 || status === 410) {
          if (await fs.remove(`pushSubs/${s.__id}`)) removed++;
        }
      }
    } catch { failed++; }
  }));
  return json({ sent, failed, removed, candidates: recipients.length, total: subs.length });
}

/* ---------------- token Firebase ---------------- */

let jwksCache = { keys: null, until: 0 };
async function googleKeys() {
  if (jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys;
  const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  const { keys } = await res.json();
  const maxAge = Number((res.headers.get('Cache-Control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  jwksCache = { keys, until: Date.now() + maxAge * 1000 };
  return keys;
}

const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))
));

export async function verifyFirebaseToken(token, projectId) {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const header = b64urlJson(h);
    const claims = b64urlJson(p);
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== 'RS256') return null;
    if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (!claims.sub || claims.exp < now || claims.iat > now + 300) return null;
    const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, new TextEncoder().encode(`${h}.${p}`));
    return ok ? claims : null;
  } catch {
    return null;
  }
}

/* ---------------- Firestore REST con il token dell'utente ---------------- */

function decode(fields = {}) {
  const val = (v) => {
    if ('stringValue' in v) return v.stringValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('nullValue' in v) return null;
    if ('timestampValue' in v) return v.timestampValue;
    if ('mapValue' in v) return decode(v.mapValue.fields);
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
    return undefined;
  };
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, val(v)]));
}

function firestore(projectId, token) {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const headers = { Authorization: `Bearer ${token}` };
  const toDoc = (d) => ({ __id: d.name.split('/').pop(), ...decode(d.fields) });
  return {
    async get(path) {
      const r = await fetch(`${base}/${path}`, { headers });
      return r.ok ? toDoc(await r.json()) : null;
    },
    async list(collection) {
      const out = [];
      let pageToken = '';
      do {
        const r = await fetch(`${base}/${collection}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`, { headers });
        if (!r.ok) throw new Error(`Firestore ${collection}: ${r.status}`);
        const j = await r.json();
        (j.documents || []).forEach((d) => out.push(toDoc(d)));
        pageToken = j.nextPageToken || '';
      } while (pageToken);
      return out;
    },
    async query(collection, field, value) {
      const r = await fetch(`${base}:runQuery`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: {
          from: [{ collectionId: collection }],
          where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } }
        } })
      });
      if (!r.ok) throw new Error(`Firestore ${collection}: ${r.status}`);
      return (await r.json()).filter((x) => x.document).map((x) => toDoc(x.document));
    },
    async remove(path) {
      const r = await fetch(`${base}/${path}`, { method: 'DELETE', headers });
      return r.ok;
    }
  };
}
