import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useClub } from '../lib/db';
import { Button, Field, Input, Alert, Loading } from '../components/ui';

export default function Login() {
  const { user, loading, login, resetPassword, authError } = useAuth();
  const { club } = useClub();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (loading) return <Loading />;
  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    await login(email.trim(), password);
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

        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="username" required placeholder="nome@esempio.it" />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password" required minLength={6} />
        </Field>

        <Button type="submit" block disabled={busy}>{busy ? 'Accesso in corso…' : 'Accedi'}</Button>
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button type="button" className="btn btn--ghost btn--sm" style={{ border: 'none' }}
            onClick={async () => { if (email.trim() && (await resetPassword(email.trim()))) setSent(true); }}>
            Password dimenticata
          </button>
        </div>
      </form>
    </div>
  );
}
