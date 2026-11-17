import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useClub, useCollection, audit } from '../lib/db';
import { Sheet, Button, Field, Input, Alert, Loading, useToast } from './ui';
import { fmtShort, fmtLong, capitalize, toDate } from '../lib/format';
import { errorText } from '../pages/Rosa';
import { can } from '../lib/permissions';
import { RPE_VALUES, RPE_LABELS, validRpe, validMinutes, parseNum, presentIds, loadable, statusLabel } from '../lib/srpe';

const num = (v, d = 1) => (v == null ? '–' : v.toLocaleString('it-IT', { maximumFractionDigits: d }));
const str = (v) => (v == null ? '' : String(v));

/** Il documento salvato come stato del modulo (tutto testo, come negli input). */
const toForm = (load) => ({
  minutes: str(load?.minutes),
  players: Object.fromEntries(Object.entries(load?.players || {}).map(([pid, e]) => [pid, { rpe: str(e.rpe), minutes: str(e.minutes), note: e.note || '' }]))
});

/**
 * Carico di una seduta (sRPE): per ogni presente secondo le presenze del
 * mister, l'RPE da 0 a 10 e, se diversi dalla durata della seduta, i suoi
 * minuti. Il carico (TL) è RPE × minuti. Si può salvare a metà e completare
 * dopo: chi non ha ancora risposto resta «voto mancante».
 */
export default function CaricoSheet({ session, user, onClose }) {
  const toast = useToast();
  const { club } = useClub();
  const { data: squad } = useCollection('players');
  const names = useMemo(() => Object.fromEntries(squad.map((p) => [p.id, p.fullName])), [squad]);

  // undefined = in lettura; null = ancora nulla di salvato.
  const [load, setLoad] = useState(undefined);
  const [readError, setReadError] = useState(null);
  useEffect(() => onSnapshot(doc(db, 'trainingLoad', session.id),
    (snap) => { setLoad(snap.exists() ? snap.data() : null); setReadError(null); },
    (e) => setReadError(e)), [session.id]);

  // Si segue ciò che arriva (anche da un altro telefono) finché non si tocca nulla.
  const [form, setForm] = useState(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!touched && load !== undefined) setForm(toForm(load)); }, [load, touched]);
  const [open, setOpen] = useState({});
  const [busy, setBusy] = useState(false);

  const present = useMemo(() => presentIds(session).sort((a, b) => (names[a] || '').localeCompare(names[b] || '', 'it')), [session, names]);
  const away = (session.attendanceSummary?.players || []).filter((pid) => !present.includes(pid));
  const title = `Carico · ${fmtShort(session.date)}`;

  if (!loadable(session)) {
    return (
      <Sheet title={title} onClose={onClose}>
        <Alert level="info">
          {session.cancelled ? 'Seduta annullata: non c\'è carico da registrare.'
            : 'Le presenze di questa seduta non sono ancora registrate. Il carico si compila sui presenti segnati dal mister: appena le salva, qui trovi la lista.'}
        </Alert>
        <Button variant="ghost" onClick={onClose}>Chiudi</Button>
      </Sheet>
    );
  }
  if (readError) {
    return (
      <Sheet title={title} onClose={onClose}>
        <Alert level="error">Non riesco a leggere il carico già salvato ({errorText(readError)}). Non salvo nulla per non sovrascriverlo: riprova fra poco.</Alert>
        <Button variant="ghost" onClick={onClose}>Chiudi</Button>
      </Sheet>
    );
  }
  if (!form) return <Sheet title={title} onClose={onClose}><Loading /></Sheet>;

  const edit = (fn) => { setTouched(true); setForm((f) => fn(structuredClone(f))); };
  const setP = (pid, k, v) => edit((f) => { f.players[pid] = { ...(f.players[pid] || {}), [k]: v }; return f; });

  const sessionMin = parseNum(form.minutes);
  const minErr = form.minutes.trim() !== '' && !validMinutes(sessionMin);
  const entries = present.map((pid) => {
    const f = form.players[pid] || {};
    const rpe = parseNum(f.rpe);
    const own = parseNum(f.minutes);
    const ownErr = (f.minutes || '').trim() !== '' && !validMinutes(own);
    const minutes = validMinutes(own) ? own : validMinutes(sessionMin) ? sessionMin : null;
    return { pid, f, rpe: validRpe(rpe) ? rpe : null, own: validMinutes(own) ? own : null, ownErr, minutes, tl: validRpe(rpe) && minutes != null ? rpe * minutes : null };
  });
  const votes = entries.filter((e) => e.rpe != null);
  const tls = entries.map((e) => e.tl).filter((v) => v != null);
  const invalid = minErr || entries.some((e) => e.ownErr);

  const save = async () => {
    setBusy(true);
    try {
      const players = {};
      entries.forEach((e) => {
        const x = {};
        if (e.rpe != null) x.rpe = e.rpe;
        if (e.own != null && e.own !== sessionMin) x.minutes = e.own;
        const note = (e.f.note || '').trim().slice(0, 300);
        if (note) x.note = note;
        if (Object.keys(x).length) players[e.pid] = x;
      });
      await setDoc(doc(db, 'trainingLoad', session.id), {
        eventId: session.id, date: toDate(session.date), seasonId: club.season || '',
        minutes: validMinutes(sessionMin) ? sessionMin : null, players,
        updatedBy: user.uid, updatedByName: user.name || '', updatedAt: serverTimestamp()
      });
      toast(`Carico salvato: ${votes.length} voti su ${present.length} presenti`);
      audit(user, 'load.save', session.id, { voti: votes.length, presenti: present.length }).catch((e) => console.warn('registro non aggiornato', e));
      setBusy(false);
      onClose();
      return;
    } catch (e) {
      toast(errorText(e), 'error');
    }
    setBusy(false);
  };

  return (
    <Sheet title={title} onClose={onClose}>
      <p style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 0 }}>
        {capitalize(fmtLong(session.date))} · {present.length} presenti secondo le presenze
      </p>
      <Field label="Durata della seduta (minuti)" error={minErr ? 'Da 1 a 300 minuti, senza decimali' : null}
        hint="Vale per tutti. Per chi è entrato tardi o uscito prima: ✎ e i suoi minuti.">
        <Input inputMode="numeric" value={form.minutes} placeholder="es. 78"
          onChange={(e) => edit((f) => { f.minutes = e.target.value; return f; })} />
      </Field>

      <div className="chiprow">
        <span className={`badge badge--${votes.length === present.length ? 'green' : 'orange'}`}>Voti: {votes.length}/{present.length}</span>
        <span className="badge badge--grey">RPE medio {num(votes.length ? votes.reduce((a, e) => a + e.rpe, 0) / votes.length : null)}</span>
        <span className="badge badge--grey">TL medio {num(tls.length ? tls.reduce((a, b) => a + b, 0) / tls.length : null, 0)}</span>
      </div>

      <div className="plist">
        {entries.map(({ pid, f, rpe, own, ownErr, tl }) => {
          const name = names[pid] || 'Giocatore non più in rosa';
          return (
            <div key={pid} className="prow prow--card" style={{ gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 100%', minWidth: 0 }}>
                <span className="prow__body">
                  <span className="prow__name" style={{ whiteSpace: 'normal' }}>{name}</span>
                  <span className="prow__meta">
                    {rpe == null ? <span style={{ color: 'var(--orange)', fontWeight: 600 }}>Voto mancante</span>
                      : <span>{RPE_LABELS[Math.round(rpe)]}{tl != null ? ` · TL ${num(tl)}` : ' · manca la durata'}</span>}
                    {own != null && <span>{own}′ propri</span>}
                    {f.note && <span>📝</span>}
                  </span>
                </span>
                <select className="select" aria-label={`RPE di ${name}`} value={f.rpe ?? ''}
                  style={{ width: 76, flex: '0 0 auto', paddingLeft: 8, paddingRight: 4 }}
                  onChange={(e) => setP(pid, 'rpe', e.target.value)}>
                  <option value="">RPE</option>
                  {RPE_VALUES.map((v) => <option key={v} value={String(v)}>{num(v)}</option>)}
                </select>
                <button className="iconbtn" aria-label={`Minuti e nota di ${name}`} aria-expanded={!!open[pid]}
                  style={{ width: 40, height: 46 }} onClick={() => setOpen((o) => ({ ...o, [pid]: !o[pid] }))}>✎</button>
              </div>
              {(open[pid] || ownErr) && (
                <div className="row2" style={{ flex: '1 1 100%' }}>
                  <Field label="Minuti suoi" error={ownErr ? 'Da 1 a 300' : null}>
                    <Input inputMode="numeric" value={f.minutes || ''} placeholder={form.minutes || 'min'}
                      onChange={(e) => setP(pid, 'minutes', e.target.value)} />
                  </Field>
                  <Field label="Nota">
                    <Input value={f.note || ''} maxLength={300} onChange={(e) => setP(pid, 'note', e.target.value)} />
                  </Field>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {away.length > 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 10 }}>
          {/* Il motivo dell'assenza (giustificato, infortunato) solo a chi gestisce le presenze. */}
          Non presenti: {away.map((pid) => `${names[pid] || 'giocatore non più in rosa'}${can(user.role, 'attendance.write') ? ` (${statusLabel(session.attendanceSummary.absent?.[pid]).toLowerCase()})` : ''}`).join(', ')}.
          Se qualcuno manca o è di troppo, va corretto nelle presenze.
        </p>
      )}

      <div className="btnrow" style={{ marginTop: 12 }}>
        <Button onClick={save} disabled={busy || invalid}>{busy ? 'Salvo…' : `Salva (${votes.length}/${present.length} voti)`}</Button>
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)' }}>
        RPE: 0 riposo · 1 molto, molto facile · 2 facile · 3 moderato · 4 piuttosto duro · 5–6 duro · 7–9 molto duro · 10 massimale.
        Si chiede circa 30 minuti dopo la fine della seduta.
      </p>
    </Sheet>
  );
}
