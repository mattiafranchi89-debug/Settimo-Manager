// Web Push senza librerie: cifratura del contenuto (RFC 8291, aes128gcm) e
// firma VAPID (RFC 8292) con WebCrypto, disponibile sia nei Worker Cloudflare
// sia in Node 20+ (per i test).

const enc = new TextEncoder();

export function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export function bytesToB64url(bytes) {
  let bin = '';
  new Uint8Array(bytes).forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  parts.forEach((p) => { out.set(p, o); o += p.length; });
  return out;
};

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
// HKDF con un solo blocco di espansione (bastano sempre ≤ 32 byte).
async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

/** Cifra `payload` per un'iscrizione del browser ({ p256dh, auth } in base64url). */
export async function encryptPayload(payload, { p256dh, auth }, { salt, serverKeys } = {}) {
  const uaPublic = b64urlToBytes(p256dh);
  const authSecret = b64urlToBytes(auth);
  salt = salt || crypto.getRandomValues(new Uint8Array(16));
  serverKeys = serverKeys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, serverKeys.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const plain = concat(typeof payload === 'string' ? enc.encode(payload) : payload, new Uint8Array([2]));
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain));

  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** Chiave privata VAPID da `d` (segreto) e dalla chiave pubblica non compressa. */
export async function importVapidKey(publicKeyB64, privateD) {
  const pub = b64urlToBytes(publicKeyB64);
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)), d: privateD
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export async function vapidHeader(endpoint, { publicKey, privateKey, subject }) {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const part = (o) => bytesToB64url(enc.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud, exp, sub: subject })}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, enc.encode(unsigned));
  return `vapid t=${unsigned}.${bytesToB64url(sig)}, k=${publicKey}`;
}

/** Invia una notifica. Restituisce lo stato HTTP del servizio push (201 = ok, 404/410 = iscrizione scaduta). */
export async function sendPush(sub, payload, vapid) {
  const body = await encryptPayload(JSON.stringify(payload), sub);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: payload.urgent ? 'high' : 'normal'
    },
    body
  });
  return res.status;
}
