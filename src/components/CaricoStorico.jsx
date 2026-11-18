import { useState } from 'react';
import { doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { audit } from '../lib/db';
import { Sheet, Button, Alert, Badge, useToast } from './ui';
import { fmtShort, capitalize, toDate } from '../lib/format';
import { errorText } from '../pages/Rosa';
import { rowsFromFile, entriesFromRows, planHistory } from '../lib/srpeImport';

const WHY = {
  noattendance: 'presenze non ancora registrate dal mister: si importa dopo',
  nosession: 'nessun allenamento in calendario quel giorno',
  many: 'più allenamenti quel giorno: importa dalla seduta',
  nomatch: 'nessun nome abbinato ai presenti',
  novotes: 'nessun RPE nel file'
};

/**
 * Lo storico del preparatore in un colpo solo: il file (.xlsx o .csv) con
 * più giorni si divide per data, ogni giorno va sulla seduta di quel giorno
 * (solo se il mister ha registrato le presenze) e si salva tutto insieme.
 * Nelle sedute già compilate si aggiornano solo i giocatori del file.
 */
export default function CaricoStorico({ sessions, loads, names, user, club, onClose }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [skip, setSkip] = useState({});

  const plans = result ? planHistory(result.entries, { sessions, loads, names }) : [];
  const ready = plans.filter((p) => p.status === 'ready' && !skip[p.date]);

  const read = async (f) => {
    setError(''); setSkip({}); setBusy(true); setFile(f.name);
    try {
      const r = entriesFromRows(await rowsFromFile(f));
      if (!r.dates.length) throw new Error('Nel file non c\'è una colonna con la data (Data o Giorno): per una sola seduta usa «Importa elenco» dalla seduta.');
      setResult(r);
    } catch (e) {
      setResult(null);
      setError(e.message || 'File non leggibile.');
    }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true);
    try {
      const batch = writeBatch(db);
      ready.forEach((p) => batch.set(doc(db, 'trainingLoad', p.session.id), {
        eventId: p.session.id, date: toDate(p.session.date), seasonId: club.season || '',
        minutes: p.doc.minutes, players: p.doc.players,
        updatedBy: user.uid, updatedByName: user.name || '', updatedAt: serverTimestamp()
      }));
      await batch.commit();
      const votes = ready.reduce((a, p) => a + p.ok, 0);
      toast(`Storico importato: ${ready.length} ${ready.length === 1 ? 'seduta' : 'sedute'}, ${votes} voti`);
      audit(user, 'load.import', 'trainingLoad', { file, sedute: ready.length, voti: votes }).catch(() => {});
      setBusy(false);
      onClose();
      return;
    } catch (e) {
      toast(errorText(e), 'error');
    }
    setBusy(false);
  };

  return (
    <Sheet title="Importa lo storico" onClose={onClose}>
      <p style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 0 }}>
        Il foglio del preparatore con più allenamenti (.xlsx o .csv, con Giocatore, RPE, Durata o Minuti e la data):
        ogni giorno va sulla seduta di quel giorno, solo dove il mister ha registrato le presenze.
        Nelle sedute già compilate si aggiornano solo i giocatori del file.
      </p>
      <label className="btn btn--secondary" style={{ cursor: 'pointer' }}>
        📄 {file ? 'Scegli un altro file' : 'Scegli il file'}
        <input type="file" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(f); }} />
      </label>
      {file && <p style={{ fontSize: 13, color: 'var(--muted)' }}>📄 {file}</p>}
      {busy && !result && <p style={{ fontSize: 13 }}>Leggo…</p>}
      {error && <Alert level="error">{error}</Alert>}

      {result && (
        <>
          <div className="plist" style={{ marginTop: 10 }}>
            {plans.map((p) => {
              const on = p.status === 'ready' && !skip[p.date];
              return (
                <div key={p.date} className="prow prow--card" style={{ gap: 6, minHeight: 0, opacity: p.status === 'ready' ? 1 : 0.65 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 100%', minWidth: 0 }}>
                    {p.status === 'ready' ? (
                      <input type="checkbox" checked={on} aria-label={`Importa ${fmtShort(p.date)}`} style={{ width: 20, height: 20 }}
                        onChange={() => setSkip((s) => ({ ...s, [p.date]: !s[p.date] }))} />
                    ) : <span aria-hidden="true" style={{ width: 20, textAlign: 'center' }}>–</span>}
                    <span className="prow__body">
                      <span className="prow__name">{capitalize(fmtShort(p.date))}</span>
                      <span className="prow__meta">
                        <span>{p.status === 'ready'
                          ? `${p.ok} voti${p.replaced ? `, ${p.replaced} aggiornati` : ''}${p.doc.minutes ? ` · durata ${p.doc.minutes}′` : ''}`
                          : `${p.votes} RPE nel file · ${WHY[p.status]}`}</span>
                      </span>
                    </span>
                    {p.status === 'ready' && <Badge tone={p.unmatched.length || p.errors.length ? 'orange' : 'green'}>{p.ok}/{p.votes}</Badge>}
                  </div>
                  {p.status === 'ready' && (p.unmatched.length > 0 || p.absentRows.length > 0 || p.errors.length > 0) && (
                    <div style={{ fontSize: 12, color: 'var(--orange)', flex: '1 1 100%', paddingLeft: 30 }}>
                      {p.unmatched.length > 0 && <div>Non abbinati: {p.unmatched.join(', ')} (completa dalla seduta)</div>}
                      {p.absentRows.length > 0 && <div>Assenti per il mister, non contano: {p.absentRows.join(', ')}</div>}
                      {p.errors.map((x) => <div key={x}>{x}</div>)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {!plans.length && <Alert level="warn">Nessun giorno con dati nel file.</Alert>}
          <div className="btnrow" style={{ marginTop: 12 }}>
            <Button disabled={busy || !ready.length} onClick={save}>
              {busy ? 'Salvo…' : `Salva ${ready.length} ${ready.length === 1 ? 'seduta' : 'sedute'}`}
            </Button>
            <Button variant="ghost" onClick={onClose}>Annulla</Button>
          </div>
        </>
      )}
    </Sheet>
  );
}
