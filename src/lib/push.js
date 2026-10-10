// Iscrizione del telefono alle notifiche push. L'iscrizione (indirizzo del
// servizio push + chiavi pubbliche del browser) sta in Firestore, in
// pushSubs/{id}, e la legge il worker quando deve inviare.

import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from './firebase';

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** iPhone/iPad: le notifiche funzionano solo con l'app aggiunta alla schermata Home. */
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('service worker non registrato', e));
  });
}

const subId = async (endpoint) => {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(hash).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
};

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function registration() {
  return (await navigator.serviceWorker.getRegistration('/')) || navigator.serviceWorker.register('/sw.js');
}

/** 'unsupported' | 'ios-home' | 'denied' | 'on' | 'off' */
export async function pushStatus() {
  if (!pushSupported()) return isIos() && !isStandalone() ? 'ios-home' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && (await reg.pushManager.getSubscription());
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

async function saveSubscription(sub) {
  const json = sub.toJSON();
  const user = auth.currentUser;
  if (!user) throw new Error('Accesso necessario');
  await setDoc(doc(db, 'pushSubs', await subId(json.endpoint)), {
    uid: user.uid,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    device: navigator.userAgent.slice(0, 160),
    updatedAt: serverTimestamp()
  });
}

export async function enablePush() {
  if (!pushSupported()) throw new Error(isIos() ? 'Su iPhone aggiungi prima l\'app alla schermata Home.' : 'Questo browser non supporta le notifiche.');
  const res = await fetch('/api/push-key', { cache: 'no-store' });
  const { key, ready } = res.ok ? await res.json() : {};
  if (!key) throw new Error('Il servizio notifiche non è raggiungibile.');
  if (!ready) throw new Error('Il servizio notifiche non è ancora configurato (manca la chiave segreta in Cloudflare).');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permesso negato: abilitalo dalle impostazioni del telefono.');

  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // Se la chiave del server è cambiata, l'iscrizione vecchia non vale più.
  const current = sub?.options?.applicationServerKey;
  if (sub && current && b64url(current) !== key) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(key) });
  await saveSubscription(sub);
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && (await reg.pushManager.getSubscription());
  if (!sub) return;
  try { await deleteDoc(doc(db, 'pushSubs', await subId(sub.endpoint))); } catch { /* già rimossa */ }
  await sub.unsubscribe();
}

/** Ad ogni apertura riallinea l'iscrizione: il telefono può rinnovarla da solo. */
export async function refreshPushSubscription() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted' || !auth.currentUser) return;
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) await saveSubscription(sub);
  } catch { /* non bloccante */ }
}

export async function sendTestPush() {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch('/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ test: true, title: 'Settimo · Prova', body: 'Le notifiche funzionano su questo telefono ✅', url: '/impostazioni' })
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `errore ${res.status}`);
  return out;
}
