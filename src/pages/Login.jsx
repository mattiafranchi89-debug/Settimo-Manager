import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useBranding } from '../lib/db';
import { Button, Field, Input, Alert, Loading } from '../components/ui';

export default function Login() {
  const { user, loading, login, register, resetPassword, authError } = useAuth();
  const club = useBranding();
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [registered, setRegistered] = useState(false);

  if (loading) return <Loading />;
  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    if (mode === 'login') {
      await login(email.trim(), password);
    } else if (await register(name.trim(), email.trim(), password, code)) {
      setRegistered(true);
    }
    setBusy(false);
  };

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <img className="login__logo" src={club.logoUrl} alt="" onError={(e) => { e.currentTarget.src = '/logo-fallback.svg'; }} />
        <h1 className="login__title">{club.clubName}</h1>
        <p className="login__sub">Team Manager · Stagione {club.season}</p>

        {authError && <Alert level="error">{authError}</Alert>}
        {sent && <Alert level="ok">Ti abbiamo inviato il link per reimpostare la password.</Alert>}
        {registered && (
          <Alert level="ok">
            Account creato. Un responsabile deve abilitarti: riceverai accesso a breve, poi entra con queste credenziali.
          </Alert>
        )}

        {!registered && (
          <>
            {mode === 'register' && (
              <Field label="Nome e cognome">
                <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={3} placeholder="Mario Rossi" />
              </Field>
            )}
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="username" required placeholder="nome@esempio.it" />
            </Field>
            <Field label="Password" hint={mode === 'register' ? 'Almeno 6 caratteri.' : undefined}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={6} />
            </Field>
            {mode === 'register' && (
              <Field label="Codice società" hint="Te lo comunica un responsabile della squadra.">
                <Input value={code} onChange={(e) => setCode(e.target.value)} required
                  autoCapitalize="characters" placeholder="es. SETTIMO2627" />
              </Field>
            )}

            <Button type="submit" block disabled={busy}>
              {busy ? 'Attendi…' : mode === 'login' ? 'Accedi' : 'Crea account'}
            </Button>
          </>
        )}

        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button type="button" className="btn btn--ghost btn--sm" style={{ border: 'none' }}
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setRegistered(false); }}>
            {mode === 'login' ? 'Non hai un account? Registrati' : 'Hai già un account? Accedi'}
          </button>
        </div>

        {mode === 'login' && (
          <div style={{ textAlign: 'center' }}>
            <button type="button" className="btn btn--ghost btn--sm" style={{ border: 'none' }}
              onClick={async () => { if (email.trim() && (await resetPassword(email.trim()))) setSent(true); }}>
              Password dimenticata
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
