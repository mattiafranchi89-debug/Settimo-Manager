import { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail
} from 'firebase/auth';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, configMissing } from './firebase';
import { can } from './permissions';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);       // { uid, email, name, role, playerId, active }
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    if (configMissing) { setLoading(false); return; }
    let unsubProfile = null;
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      if (unsubProfile) { unsubProfile(); unsubProfile = null; }
      if (!fbUser) { setUser(null); setLoading(false); return; }
      unsubProfile = onSnapshot(
        doc(db, 'users', fbUser.uid),
        async (snap) => {
          // First access: register the user as pending so an administrator
          // can see them in Impostazioni and assign a role.
          if (!snap.exists()) {
            try {
              await setDoc(doc(db, 'users', fbUser.uid), {
                name: fbUser.displayName || fbUser.email,
                email: fbUser.email, role: 'player', active: false, createdAt: serverTimestamp()
              });
            } catch (e) { console.warn('profilo non creato', e); }
          }
          const p = snap.data() || {};
          setUser({
            uid: fbUser.uid,
            email: fbUser.email,
            name: p.name || fbUser.email,
            role: p.role || 'player',
            playerId: p.playerId || null,
            active: p.active !== false
          });
          setLoading(false);
        },
        () => {
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
    case 'auth/network-request-failed': return 'Connessione assente. Controlla la rete.';
    default: return 'Accesso non riuscito. Riprova.';
  }
}
