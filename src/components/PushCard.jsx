import { useEffect, useState } from 'react';
import { Card, Button, Alert, useToast } from './ui';
import { pushStatus, enablePush, disablePush, sendTestPush } from '../lib/push';

const DISMISS_KEY = 'sm-push-banner-dismissed';

const HINT = {
  'ios-home': 'Su iPhone le notifiche arrivano solo se l\'app è sulla schermata Home: in Safari tocca Condividi → «Aggiungi a Home», poi apri l\'app da lì e torna qui.',
  unsupported: 'Questo browser non supporta le notifiche. Prova con Chrome su Android o con l\'app aggiunta alla Home su iPhone.',
  denied: 'Le notifiche sono bloccate per questo sito: riattivale dalle impostazioni del browser o del telefono, poi ricarica la pagina.'
};

/**
 * Attivazione delle notifiche sul telefono. `compact` è il richiamo in home,
 * che si nasconde una volta attivate o se l'utente lo chiude.
 */
export default function PushCard({ compact = false, staff = true }) {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => { pushStatus().then(setStatus).catch(() => setStatus('unsupported')); }, []);

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message || 'Operazione non riuscita', 'error'); }
    setStatus(await pushStatus().catch(() => status));
    setBusy(false);
  };

  if (!status) return null;
  const what = staff
    ? 'Ricevi un avviso quando qualcuno dello staff salva convocazioni, partite, presenze, formazioni, schede e multe.'
    : 'Ricevi un avviso per convocazioni, partite, risultati e allenamenti.';

  if (compact) {
    if (dismissed || status === 'on' || status === 'unsupported' || status === 'denied') return null;
    return (
      <Alert level="info">
        <div style={{ fontWeight: 600 }}>🔔 Attiva le notifiche sul telefono</div>
        <div style={{ fontSize: 13.5 }}>{status === 'ios-home' ? HINT['ios-home'] : what}</div>
        <div className="btnrow" style={{ marginTop: 8 }}>
          {status === 'off' && <Button size="sm" disabled={busy} onClick={() => run(enablePush, 'Notifiche attivate')}>Attiva</Button>}
          <Button size="sm" variant="ghost" onClick={() => { setDismissed(true); try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignorabile */ } }}>Non ora</Button>
        </div>
      </Alert>
    );
  }

  return (
    <Card title="🔔 Notifiche sul telefono">
      <p style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 0 }}>{what} Vale per questo dispositivo.</p>
      {HINT[status] && <Alert level={status === 'denied' ? 'warn' : 'info'}>{HINT[status]}</Alert>}
      {status === 'off' && <Button disabled={busy} onClick={() => run(enablePush, 'Notifiche attivate')}>Attiva su questo telefono</Button>}
      {status === 'on' && (
        <div className="btnrow">
          <Button variant="secondary" disabled={busy} onClick={() => run(sendTestPush, 'Notifica di prova inviata')}>Invia una prova</Button>
          <Button variant="ghost" disabled={busy} onClick={() => run(disablePush, 'Notifiche disattivate')}>Disattiva</Button>
        </div>
      )}
    </Card>
  );
}
