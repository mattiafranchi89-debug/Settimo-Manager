import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAuth } from '../lib/auth';
import { Card, Button, Alert, Badge, Loading } from '../components/ui';

const OK = (v) => <Badge tone="green">{v}</Badge>;
const KO = (v) => <Badge tone="red">{v}</Badge>;

export default function Diagnostica() {
  const { user } = useAuth();
  const [profile, setProfile] = useState({ loading: true });
  const [tests, setTests] = useState([]);
  const [busy, setBusy] = useState(false);

  const projectId = auth.app.options.projectId;
  const uid = auth.currentUser?.uid;

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        setProfile({ loading: false, exists: snap.exists(), data: snap.exists() ? snap.data() : null });
      } catch (e) {
        setProfile({ loading: false, error: `${e.code || ''} ${e.message}` });
      }
    })();
  }, [uid]);

  const run = async () => {
    setBusy(true);
    const out = [];
    const attempt = async (label, fn) => {
      try { await fn(); out.push({ label, ok: true, msg: 'scrittura riuscita' }); }
      catch (e) { out.push({ label, ok: false, msg: `${e.code || 'errore'} — ${e.message}` }); }
    };
    await attempt('Scrittura su players (serve ruolo admin)', () =>
      setDoc(doc(db, 'players', '_diagnostica'), { fullName: '_TEST', position: 'CC', active: false, createdAt: serverTimestamp() }));
    await attempt('Scrittura su config/club (serve ruolo admin)', () =>
      setDoc(doc(db, 'config', 'club'), { diagnosticaAt: serverTimestamp() }, { merge: true }));
    await attempt('Scrittura su auditLogs (basta essere attivo)', () =>
      setDoc(doc(db, 'auditLogs', `_diagnostica_${Date.now()}`), { action: 'diagnostica', userId: uid, at: serverTimestamp() }));
    try { await deleteDoc(doc(db, 'players', '_diagnostica')); } catch { /* ignorabile */ }
    setTests(out);
    setBusy(false);
  };

  if (profile.loading) return <Loading />;

  const d = profile.data || {};
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

  return (
    <>
      <div className="pagehead"><div><h1>Diagnostica</h1><p>Serve solo a capire perché una scrittura viene rifiutata</p></div></div>

      <Card title="Collegamento">
        <table className="data" style={{ minWidth: 0 }}>
          <tbody>
            <tr><th>Progetto Firebase</th><td><strong>{projectId}</strong></td></tr>
            <tr><th>Email</th><td>{auth.currentUser?.email}</td></tr>
            <tr><th>UID attuale</th><td style={{ wordBreak: 'break-all' }}>{uid}</td></tr>
          </tbody>
        </table>
        <Alert level="info">Le regole vanno pubblicate nel progetto <strong>{projectId}</strong>. Se nella console Firebase vedi un nome diverso, stai lavorando sul progetto sbagliato.</Alert>
      </Card>

      <Card title="Documento users/{uid}">
        {profile.error && <Alert level="error">Lettura fallita: {profile.error}</Alert>}
        {!profile.error && !profile.exists && (
          <Alert level="error">Il documento non esiste. L'ID del documento deve essere identico all'UID qui sopra.</Alert>
        )}
        {profile.exists && (
          <>
            <table className="data" style={{ minWidth: 0 }}>
              <thead><tr><th>Campo</th><th>Valore</th><th>Tipo</th></tr></thead>
              <tbody>
                {Object.entries(d).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td style={{ wordBreak: 'break-all' }}>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
                    <td>{typeOf(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="stack" style={{ marginTop: 12 }}>
              <div className="spread"><span>role è esattamente "admin"</span>{d.role === 'admin' ? OK('sì') : KO(`no: "${d.role}"`)}</div>
              <div className="spread"><span>active non è false</span>{d.active !== false ? OK('ok') : KO('è false')}</div>
              <div className="spread"><span>active è un booleano</span>{typeof d.active === 'boolean' ? OK('sì') : KO(typeOf(d.active))}</div>
            </div>
          </>
        )}
      </Card>

      <Card title="Prova di scrittura">
        <p>Esegue tre scritture reali e mostra l'errore esatto restituito da Firebase.</p>
        <Button onClick={run} disabled={busy}>{busy ? 'Eseguo…' : 'Esegui la prova'}</Button>
        {tests.length > 0 && (
          <div className="stack" style={{ marginTop: 12 }}>
            {tests.map((t) => (
              <div key={t.label} className={`alert alert--${t.ok ? 'ok' : 'error'}`}>
                <span aria-hidden="true">{t.ok ? '✅' : '⛔'}</span>
                <div><strong>{t.label}</strong><br />{t.msg}</div>
              </div>
            ))}
            {tests.every((t) => !t.ok) && (
              <Alert level="warn">Nessuna scrittura passa: le regole attive nel progetto {projectId} non sono quelle aggiornate, oppure la pubblicazione non è andata a buon fine.</Alert>
            )}
            {tests.some((t) => t.ok) && tests.some((t) => !t.ok) && (
              <Alert level="warn">Alcune scritture passano: le regole ci sono, ma il tuo ruolo non è riconosciuto come amministratore.</Alert>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
