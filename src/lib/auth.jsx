import { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  createUserWithEmailAndPassword, updateProfile
} from 'firebase/auth';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, configMissing } from './firebase';
import { trackVisit } from './usage';
import { can } from './permissions';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);       // { uid, email, name, role, playerId, active }
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  // Un guasto nella lettura del profilo (regole, quota, rete) viene comunque
  // mostrato come "account non attivo": senza questo, sembra un problema di
  // permessi anche quando in realtà Firestore non ha risposto.
  const [profileError, setProfileError] = useState(null);
  // Da dove arriva il profilo letto: serve a distinguere "non attivato" da
  // "server non raggiungibile", che a schermo sembrerebbero identici.
  const [profileInfo, setProfileInfo] = useState(null);

  useEffect(() => {
    if (configMissing) { setLoading(false); return; }
    let unsubProfile = null;
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      if (unsubProfile) { unsubProfile(); unsubProfile = null; }
      if (!fbUser) { setUser(null); setProfileInfo(null); setLoading(false); return; }
      const ref = doc(db, 'users', fbUser.uid);
      unsubProfile = onSnapshot(
        ref,
        // Serve sapere quando il server conferma il dato, non solo quando cambia.
        { includeMetadataChanges: true },
        async (snap) => {
          setProfileError(null);
          const fromCache = snap.metadata.fromCache;
          const exists = snap.exists();
          const p = snap.data() || {};
          setProfileInfo({ fromCache, exists, active: p.active, role: p.role });

          // Primo accesso: si registra il profilo in attesa solo quando è il
          // server a confermare che non esiste. Dalla sola cache locale non si
          // può saperlo, e scriverlo comunque bloccherebbe account già attivi.
          if (!exists && !fromCache) {
            try {
              await setDoc(ref, {
                name: fbUser.displayName || fbUser.email,
                email: fbUser.email, role: 'player', active: false, createdAt: serverTimestamp()
              });
            } catch (e) { console.warn('profilo non creato', e); }
          }
          const profile = {
            uid: fbUser.uid,
            email: fbUser.email,
            name: p.name || fbUser.email,
            role: p.role || 'player',
            playerId: p.playerId || null,
            active: exists && p.active !== false
          };
          setUser(profile);
          setLoading(false);
          if (!fromCache) trackVisit(profile);
        },
        (e) => {
          setProfileError(e);
          setUser({ uid: fbUser.uid, email: fbUser.email, name: fbUser.email, role: 'player', active: false });
          setLoading(false);
        }
      );
    });
    return () => { unsub(); if (unsubProfile) unsubProfile(); };
  }, []);

  const value = {
    user,
    loading,
    authError,
    profileError,
    profileInfo,
    can: (perm) => can(user?.role, perm),
    login: async (email, password) => {
      setAuthError(null);
      try {
        await signInWithEmailAndPassword(auth, email, password);
        return true;
      } catch (e) {
        setAuthError(mapAuthError(e.code));
        return false;
      }
    },
    /** Anyone can register; an administrator then assigns the role. */
    register: async (name, email, password) => {
      setAuthError(null);
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name });
        await setDoc(doc(db, 'users', cred.user.uid), {
          name, email, role: 'player', active: false, createdAt: serverTimestamp()
        });
        return true;
      } catch (e) {
        setAuthError(mapAuthError(e.code));
        return false;
      }
    },
    resetPassword: async (email) => {
      try { await sendPasswordResetEmail(auth, email); return true; }
      catch (e) { setAuthError(mapAuthError(e.code)); return false; }
    },
    logout: () => signOut(auth)
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

function mapAuthError(code) {
  switch (code) {
    case 'auth/invalid-email': return 'Indirizzo email non valido.';
    case 'auth/user-disabled': return 'Account disattivato. Contatta un amministratore.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential': return 'Email o password non corretti.';
    case 'auth/too-many-requests': return 'Troppi tentativi. Riprova tra qualche minuto.';
    case 'auth/email-already-in-use': return 'Esiste già un account con questa email: prova ad accedere.';
    case 'auth/weak-password': return 'Password troppo debole: usa almeno 6 caratteri.';
    case 'auth/operation-not-allowed': return 'Registrazione non abilitata sul progetto Firebase.';
    case 'auth/network-request-failed': return 'Connessione assente. Controlla la rete.';
    default: return 'Accesso non riuscito. Riprova.';
  }
}
