import { useMemo, useState } from 'react';
import { useCollection, updateDocument, serverTimestamp, where, audit } from '../lib/db';
import { Button, Select, Sheet, Alert, Badge } from './ui';
import { readStoredReferto, ourSide, proposals } from '../lib/referto';
import { staffOptions, samePerson, roleFromText, STAFF_ROLES } from '../lib/staffDiscipline';
import { seasonStart, fmtShort, toDate } from '../lib/format';

/**
 * Rilegge tutti i referti già caricati tra gli allegati delle partite della
 * stagione e ne prende solo i provvedimenti allo staff (sezione «Provvedimenti»).
 * Niente si scrive senza conferma: per ogni partita si vede cosa è stato letto,
 * si sceglie la persona e si inserisce nella scheda gara, senza doppioni.
 */
export default function StaffRefertiScan({ club, user, onClose, toast }) {
  const { data: files } = useCollection('matchFiles', useMemo(() => [where('slot', '==', 'referto')], []));
  const { data: matches } = useCollection('events', useMemo(() => [where('type', '==', 'match'), where('seasonId', '==', club.season || '')], [club.season]));
  const { data: sheets } = useCollection('matchStats', useMemo(() => [where('date', '>=', seasonStart(club.season))], [club.season]));
  const staff = useMemo(() => staffOptions(club), [club]);
  const [rows, setRows] = useState(null);
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);

  const byMatch = useMemo(() => Object.fromEntries(matches.map((m) => [m.id, m])), [matches]);
  const sheetOf = (id) => sheets.find((s) => (s.eventId || s.id) === id);
  // Solo partite di questa stagione già giocate, dalla più vecchia.
  const todo = useMemo(() => files
    .filter((f) => byMatch[f.eventId] && f.url && (toDate(byMatch[f.eventId].date) || 0) < new Date())
    .sort((a, b) => toDate(byMatch[a.eventId].date) - toDate(byMatch[b.eventId].date)), [files, byMatch]);

  const run = async () => {
    setBusy(true);
    const out = [];
    for (let i = 0; i < todo.length; i++) {
      const f = todo[i];
      const match = byMatch[f.eventId];
      setProgress(`${i + 1} di ${todo.length}: ${match.opponent || ''}`);
      if (f.kind === 'link' || !/^image\//.test(f.contentType || '') || /heic/i.test(f.contentType || '')) {
        out.push({ match, error: f.kind === 'link' ? 'è un link esterno, non un file' : 'formato non leggibile (serve una foto JPG o PNG)' });
        continue;
      }
      try {
        const data = await readStoredReferto(f);
        if (!data?.leggibile) { out.push({ match, error: 'referto non leggibile' }); continue; }
        const side = ourSide(data, club.clubName, match);
        const items = proposals(data, side, {}, staff).filter((x) => x.type === 'staff');
        const have = (sheetOf(match.id)?.events || []).filter((e) => e.type === 'staff');
        // Già in scheda (stessa persona, stesso cartellino): non si propone di nuovo.
        const used = new Set();
        items.forEach((x) => {
          const k = have.findIndex((e, j) => !used.has(j) && e.card === x.card && samePerson(e.staffName || '', x.staffName));
          if (k >= 0) { used.add(k); x.already = true; }
        });
        out.push({ match, items, on: Object.fromEntries(items.map((x) => [x.key, !x.already])) });
      } catch (e) {
        out.push({ match, error: e.message || 'lettura non riuscita' });
      }
      setRows([...out]);
    }
    setRows(out);
    setProgress(null);
    setBusy(false);
  };

  const update = (mi, key, patch) => setRows((list) => list.map((r, i) => (i !== mi ? r : { ...r, items: r.items.map((x) => (x.key === key ? { ...x, ...patch } : x)) })));
  const toggle = (mi, key, v) => setRows((list) => list.map((r, i) => (i !== mi ? r : { ...r, on: { ...r.on, [key]: v } })));
  const chosen = (rows || []).map((r) => ({ ...r, pick: (r.items || []).filter((x) => r.on?.[x.key] && !x.already) }));
  const total = chosen.reduce((a, r) => a + (sheetOf(r.match.id) ? r.pick.length : 0), 0);

  const apply = async () => {
    setBusy(true);
    let n = 0;
    try {
      for (const r of chosen) {
        const sheet = sheetOf(r.match.id);
        if (!sheet || !r.pick.length) continue;
        const add = r.pick.map((x) => ({ id: Math.random().toString(36).slice(2), type: 'staff', card: x.card, staffName: x.staffName, ...(x.staffRole ? { staffRole: x.staffRole } : {}), minute: null, source: 'referto' }));
        await updateDocument('matchStats', sheet.id, { events: [...(sheet.events || []), ...add], updatedBy: user.uid, updatedAt: serverTimestamp() });
        n += add.length;
      }
      await audit(user, 'staff.referti', 'matchStats', { added: n });
      toast(`${n} cartellin${n === 1 ? 'o' : 'i'} dello staff inserit${n === 1 ? 'o' : 'i'} nelle schede gara`);
      onClose();
    } catch (e) {
      toast(`Inserimento non riuscito: ${e.message || e}`, 'error');
    }
    setBusy(false);
  };

  return (
    <Sheet title="Cartellini dello staff dai referti" onClose={busy ? () => {} : onClose}>
      {!rows && (
        <>
          <p style={{ fontSize: 14 }}>
            Rileggo {todo.length === 1 ? 'il referto caricato' : `i ${todo.length} referti caricati`} nelle partite giocate di questa stagione e prendo solo la sezione «Provvedimenti» (tecnici e dirigenti).
            Prima di inserire qualcosa nelle schede ti mostro cosa ho letto.
          </p>
          <p><small>Ogni referto richiede qualche secondo. Le foto in PDF o HEIC e i link esterni non si possono rileggere.</small></p>
          <div className="btnrow">
            <Button disabled={busy || !todo.length} onClick={run}>{busy ? progress || 'Leggo…' : `Rileggi ${todo.length === 1 ? 'il referto' : `${todo.length} referti`}`}</Button>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Annulla</Button>
          </div>
        </>
      )}
      {rows && (
        <>
          {busy && progress && <Alert level="info">Sto leggendo il referto {progress}…</Alert>}
          <div className="stack" style={{ gap: 10 }}>
            {rows.map((r, mi) => {
              const sheet = sheetOf(r.match.id);
              return (
                <div key={r.match.id} className="card" style={{ padding: 10, margin: 0 }}>
                  <div className="spread" style={{ fontSize: 14 }}>
                    <b>{r.match.opponent}</b>
                    <small style={{ color: 'var(--muted)' }}>{fmtShort(r.match.date)} · {r.match.competition}</small>
                  </div>
                  {r.error && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>⚠️ {r.error}</div>}
                  {r.items && !r.items.length && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Nessun provvedimento allo staff sul referto.</div>}
                  {r.items?.length > 0 && !sheet && <div style={{ fontSize: 13, color: 'var(--red)', marginTop: 4 }}>Scheda gara non compilata: aprila e carica lì il referto.</div>}
                  {r.items?.length > 0 && sheet && !sheet.closed && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>Scheda ancora aperta: conta quando la chiudi.</div>}
                  {(r.items || []).map((x) => (
                    <div key={x.key} style={{ marginTop: 8, opacity: x.already || !r.on[x.key] ? 0.55 : 1 }}>
                      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, fontWeight: 600 }}>
                        <input type="checkbox" disabled={x.already || !sheet} checked={!x.already && !!r.on[x.key]} onChange={(e) => toggle(mi, x.key, e.target.checked)} />
                        {x.card === 'rossa' ? '🟥 Espulsione' : '🟨 Ammonizione'}
                        {x.already && <Badge tone="grey">già in scheda</Badge>}
                      </label>
                      <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '2px 0 4px' }}>Sul referto: {x.name}{x.qualifica ? ` · ${x.qualifica}` : ''}</div>
                      {!x.already && sheet && (
                        <Select value={x.staffKey || ''} style={{ minHeight: 38, padding: '4px 8px', fontSize: 13.5 }}
                          onChange={(e) => {
                            const o = staff.find((p) => p.k === e.target.value);
                            update(mi, x.key, o ? { staffKey: o.k, staffName: o.name, staffRole: o.role } : { staffKey: '', staffName: x.name, staffRole: roleFromText(x.qualifica) });
                          }}>
                          <option value="">{x.name} ({STAFF_ROLES[roleFromText(x.qualifica)] || 'come sul referto'})</option>
                          {staff.map((o) => <option key={o.k} value={o.k}>{o.name} · {o.label}</option>)}
                        </Select>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          {!busy && (
            <div className="btnrow" style={{ marginTop: 12 }}>
              <Button disabled={!total} onClick={apply}>{total ? `Inserisci nelle schede (${total})` : 'Niente da inserire'}</Button>
              <Button variant="ghost" onClick={onClose}>Chiudi</Button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
