import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, setDocument, serverTimestamp, where, orderBy, limit } from '../lib/db';
import { Card, Button, Field, Select, Badge, Empty, Loading, useToast, Alert, Textarea, Sheet } from '../components/ui';
import { buildLineupMessage, copyText, shareMessage } from '../lib/callup';
import { errorText } from './Rosa';
import { fmtShort, fmtTime, fmtLong, capitalize, sortPlayers, shortName, toDate } from '../lib/format';
import { MODULES } from '../lib/modules';
import { GROUPS, groupOf } from '../lib/format';
/** Ordinamento in memoria: la query filtra per tipo, senza indici da creare. */
const byDateDesc = (list) => [...list].sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0));

import { readDocumentNumbers } from '../lib/players';
import { renderDistintaImage, shareImage } from '../lib/distintaImage';

export default function Formazioni() {
  const { user } = useAuth();
  const { club } = useClub();
  const toast = useToast();

  // Filtrando per tipo, gli allenamenti non tolgono più spazio alle partite.
  const eventsQ = useMemo(() => [where('type', '==', 'match'), limit(120)], []);
  const { data: allEvents, loading } = useCollection('events', eventsQ);
  const matches = useMemo(() => byDateDesc(allEvents), [allEvents]);
  const { data: players } = useCollection('players', useMemo(() => [where('active', '==', true)], []));
  const { data: callups } = useCollection('callups');

  const [params] = useSearchParams();
  const [eventId, setEventId] = useState(params.get('event') || '');
  useEffect(() => {
    if (eventId || !matches.length) return;
    const upcoming = [...matches].reverse().find((m) => (toDate(m.date) || 0) >= new Date());
    setEventId((upcoming || matches[0]).id);
  }, [matches, eventId]);

  const { data: lineups } = useCollection('lineups');
  const saved = lineups.find((l) => l.id === eventId);

  const [module, setModule] = useState(club.defaultModule || '4-3-1-2');
  const [slots, setSlots] = useState({});
  const [captain, setCaptain] = useState('');
  const [notes, setNotes] = useState('');
  const [docs, setDocs] = useState({});

  useEffect(() => {
    if (!saved) { setSlots({}); return; }
    setModule(saved.module || club.defaultModule);
    setSlots(saved.slots || {});
    setCaptain(saved.captain || '');
    setNotes(saved.notes || '');
  }, [saved, club.defaultModule]);

  const match = matches.find((m) => m.id === eventId);
  const callup = callups.find((c) => c.eventId === eventId);
  const pool = useMemo(() => {
    const ids = callup?.players;
    return sortPlayers(ids ? players.filter((p) => ids.includes(p.id)) : players);
  }, [players, callup]);

  const slotList = MODULES[module] || MODULES['4-3-1-2'];
  const starters = Object.values(slots).filter(Boolean);
  const bench = pool.filter((p) => !starters.includes(p.id));
  const byId = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p])), [players]);

  const [picking, setPicking] = useState(null);

  /** Assegna il giocatore alla posizione scelta e passa alla prima libera. */
  const assign = (playerId) => {
    setSlots((v) => {
      const next = { ...v };
      // Se giocava altrove, libera quella posizione invece di duplicarlo.
      Object.keys(next).forEach((k) => { if (next[k] === playerId) next[k] = ''; });
      next[picking] = playerId;
      return next;
    });
    setPicking(null);
  };

  /** Riempie le posizioni libere con chi ha il ruolo corrispondente. */
  const autoFill = () => {
    const wanted = { POR: ['POR'], TD: ['TD'], TS: ['TS'], DC: ['DC'], MZ: ['CC', 'ES'], CC: ['CC'], TRQ: ['TRQ', 'CC'], ATT: ['ATT'], ED: ['ES', 'TD'], ES: ['ES', 'TS'], AD: ['ATT', 'ES'], AS: ['ATT', 'ES'], PC: ['ATT'] };
    setSlots((v) => {
      const next = { ...v };
      const taken = new Set(Object.values(next).filter(Boolean));
      slotList.forEach((s) => {
        if (next[s.id]) return;
        const roles = wanted[s.label] || [];
        const pick = sortPlayers(pool).find((p) => !taken.has(p.id) && !p.injury?.active && roles.includes(p.position));
        if (pick) { next[s.id] = pick.id; taken.add(pick.id); }
      });
      return next;
    });
    setPicking(null);
  };

  const lineupMessage = useMemo(() => (match ? buildLineupMessage({
    club, match, module,
    slots: slotList.map((s) => ({ label: s.label, playerId: slots[s.id] })),
    byId, bench, captain
  }) : ''), [club, match, module, slotList, slots, byId, bench, captain]);

  const save = async () => {
    await setDocument('lineups', eventId, {
      eventId, module, slots, captain, notes,
      starters, bench: bench.map((p) => p.id),
      updatedBy: user.uid, updatedAt: serverTimestamp()
    });
    toast('Formazione salvata');
  };

  if (loading) return <Loading />;
  if (!matches.length) return <Card><Empty title="Nessuna partita">Aggiungi una gara per costruire la formazione.</Empty></Card>;

  return (
    <>
      <div className="pagehead noprint">
        <div><h1>Formazione</h1><p>{starters.length}/11 titolari · {bench.length} in panchina</p></div>
        <Button size="sm" onClick={save}>Salva</Button>
      </div>

      <div className="noprint">
        <Field label="Partita">
          <Select value={eventId} onChange={(e) => setEventId(e.target.value)}>
            {matches.map((m) => (
              <option key={m.id} value={m.id}>{fmtShort(m.date)} — {m.opponent}</option>
            ))}
          </Select>
        </Field>
        <Field label="Modulo">
          <Select value={module} onChange={(e) => { setModule(e.target.value); setSlots({}); }} options={Object.keys(MODULES)} />
        </Field>
        {!callup && <Alert level="info">Nessuna convocazione collegata: puoi scegliere fra tutti i giocatori in rosa.</Alert>}
      </div>

      {/* Si tocca una posizione sul campo, poi il giocatore: niente menu a tendina. */}
      <div className="pitch noprint">
        <div className="pitch__line" /><div className="pitch__circle" />
        {slotList.map((s) => {
          const p = byId[slots[s.id]];
          const active = picking === s.id;
          return (
            <button className="slot" key={s.id} style={{ left: `${s.x}%`, top: `${s.y}%` }}
              onClick={() => setPicking(active ? null : s.id)}
              aria-label={p ? `${s.label}: ${p.fullName}` : `${s.label} libero`}>
              <span className={`slot__shirt ${active ? 'slot__shirt--active' : ''} ${p ? '' : 'slot__shirt--empty'}`}>
                {p ? s.label : '+'}
              </span>
              <span className="slot__name">{p ? shortName(p.fullName) : s.label}</span>
            </button>
          );
        })}
      </div>

      <Card className="noprint" title="Undici titolare"
        action={<Badge tone={starters.length === 11 ? 'green' : 'orange'}>{starters.length}/11</Badge>}>

        <div className="btnrow" style={{ marginBottom: 12 }}>
          <Button size="sm" variant="secondary" onClick={autoFill}>Compila per ruolo</Button>
          <Button size="sm" variant="ghost" onClick={() => { setSlots({}); setPicking(null); }}>Svuota</Button>
        </div>

        <p><small>Tocca una posizione sul campo per assegnarla. Il capitano si sceglie toccando la fascia.</small></p>
            <div className="plist">
              {slotList.map((s) => {
                const p = byId[slots[s.id]];
                return (
                  <div key={s.id} className="prow" onClick={() => setPicking(s.id)} style={{ cursor: 'pointer' }}>
                    <span className="prow__num">{s.label}</span>
                    <span className="prow__body">
                      <span className="prow__name" style={p ? undefined : { color: 'var(--muted)' }}>
                        {p ? p.fullName : 'da assegnare'}
                      </span>
                    </span>
                    {p && (
                      <button className="iconbtn" aria-label="Capitano"
                        onClick={(e) => { e.stopPropagation(); setCaptain(captain === p.id ? '' : p.id); }}
                        style={captain === p.id ? { borderColor: 'var(--red)', color: 'var(--red)' } : undefined}>
                        Ⓒ
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14 }}>
              <Field label="Note gara">
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>
      </Card>

      <div className="noprint btnrow" style={{ marginBottom: 12 }}>
        <Button size="sm" variant="ghost"
          onClick={async () => setDocs(await readDocumentNumbers([...starters, ...bench.map((p) => p.id)]))}>
          Carica numeri documento nella distinta
        </Button>
        <Button size="sm" variant="secondary" disabled={!starters.length}
          onClick={async () => {
            try {
              const blob = await renderDistintaImage({
                club, match, module, captain, docs,
                starters: slotList.filter((s) => slots[s.id]).map((s) => ({ id: slots[s.id], role: s.label, name: byId[slots[s.id]]?.fullName || '' })),
                bench, logoUrl: club.logoUrl
              });
              const r = await shareImage(blob, `distinta-${(match?.opponent || 'gara').replace(/\s+/g, '-')}.png`);
              if (r !== 'cancelled') toast(r === 'shared' ? 'Distinta condivisa' : 'Distinta scaricata come immagine');
            } catch (e) { toast('Immagine non generata: ' + (e.message || ''), 'error'); }
          }}>
          🖼 Distinta come immagine
        </Button>
      </div>

      {picking && (
        <Sheet title={`Posizione ${slotList.find((s) => s.id === picking)?.label}`} onClose={() => setPicking(null)}>
          <Field label="Giocatore" hint="Chi è già schierato altrove viene spostato in questa posizione.">
            <Select value={slots[picking] || ''} onChange={(e) => { if (e.target.value) assign(e.target.value); else { setSlots((v) => ({ ...v, [picking]: '' })); setPicking(null); } }}>
              <option value="">— libera la posizione —</option>
              {GROUPS.map((g) => {
                const list = sortPlayers(pool.filter((p) => groupOf(p.position) === g.key));
                if (!list.length) return null;
                return (
                  <optgroup key={g.key} label={`${g.emoji} ${g.label}`}>
                    {list.map((p) => {
                      const usedIn = slotList.find((x) => slots[x.id] === p.id && x.id !== picking);
                      return (
                        <option key={p.id} value={p.id}>
                          {p.fullName}{usedIn ? ` — ora ${usedIn.label}` : ''}{p.injury?.active ? ' — infortunato' : ''}
                        </option>
                      );
                    })}
                  </optgroup>
                );
              })}
            </Select>
          </Field>
          <Button variant="ghost" block onClick={() => setPicking(null)}>Chiudi</Button>
        </Sheet>
      )}

      <Card title="Messaggio per la distinta" className="noprint">
        <p><small>Da mandare a chi compila la distinta, anche a distanza di giorni dalla convocazione. Non contiene i numeri di documento: quelli restano nell'app.</small></p>
        <div className="msgbox">{lineupMessage}</div>
        <div className="btnrow" style={{ marginTop: 12 }}>
          <Button disabled={!starters.length}
            onClick={async () => {
              try {
                await save();
                const phone = (club.distintaPhone || '').replace(/\D/g, '');
                if (phone) window.open(`https://wa.me/${phone}?text=${encodeURIComponent(lineupMessage)}`, '_blank', 'noopener');
                else await shareMessage(lineupMessage, 'Formazione');
              } catch (e) { toast(errorText(e), 'error'); }
            }}>
            {club.distintaPhone
              ? `Invia a ${club.distintaNome || club.distintaPhone}`
              : 'Invia formazione'}
          </Button>
          <Button variant="secondary" onClick={async () => { await copyText(lineupMessage); toast('Messaggio copiato'); }}>Copia</Button>
        </div>
        {club.distintaPhone ? (
          <Alert level="info">
            Il messaggio apre la chat con il numero {club.distintaPhone}. Nome e numero si cambiano in Impostazioni → Invio dei messaggi.
          </Alert>
        ) : (
          <Alert level="info">Imposta il numero WhatsApp in Impostazioni → Invio dei messaggi per inviarla direttamente invece che dal menu di condivisione.</Alert>
        )}
      </Card>

      <Distinta docs={docs} club={club} match={match} slotList={slotList} slots={slots} byId={byId} bench={bench} captain={captain} module={module} notes={notes} />
    </>
  );
}

function Distinta({ docs = {}, club, match, slotList, slots, byId, bench, captain, module, notes }) {
  if (!match) return null;
  return (
    <Card title="Distinta gara" action={<span className="noprint"><Button size="sm" variant="secondary" onClick={() => window.print()}>Stampa / PDF</Button></span>}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', borderBottom: '3px solid var(--red)', paddingBottom: 10, marginBottom: 12 }}>
        <img src={club.logoUrl} alt="" style={{ height: 48 }} onError={(e) => { e.currentTarget.src = '/logo.png'; }} />
        <div>
          <div style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 700, textTransform: 'uppercase' }}>{club.clubName}</div>
          <small>{club.teamName} · {club.season} · Modulo {module}</small>
        </div>
      </div>

      <table className="data" style={{ minWidth: 0, marginBottom: 12 }}>
        <tbody>
          <tr><th>Gara</th><td>{match.home === false ? `${match.opponent} — ${club.clubName}` : `${club.clubName} — ${match.opponent}`}</td></tr>
          <tr><th>Competizione</th><td>{match.competition}</td></tr>
          <tr><th>Data e ora</th><td>{capitalize(fmtLong(match.date))} · {fmtTime(match.date)}</td></tr>
          <tr><th>Campo</th><td>{match.venue}</td></tr>
        </tbody>
      </table>

      <h3>Titolari</h3>
      <table className="data" style={{ minWidth: 0 }}>
        <thead><tr><th>Ruolo</th><th>Giocatore</th><th>Documento</th></tr></thead>
        <tbody>
          {slotList.map((s) => {
            const p = byId[slots[s.id]];
            return (
              <tr key={s.id}>
                <td>{s.label}</td>
                <td>{p ? p.fullName : '—'} {captain && p?.id === captain ? <Badge tone="red">C</Badge> : null}</td>
                <td>{p ? (docs[p.id] || '') : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3 style={{ marginTop: 14 }}>Panchina</h3>
      <table className="data" style={{ minWidth: 0 }}>
        <tbody>{bench.map((p) => <tr key={p.id}><td style={{ width: 46 }}>{p.position}</td><td>{p.fullName}</td><td>{docs[p.id] || ''}</td></tr>)}</tbody>
      </table>

      <table className="data" style={{ minWidth: 0, marginTop: 14 }}>
        <tbody>
          <tr><th>Allenatore</th><td>{club.staff?.head_coach || '—'}</td></tr>
          <tr><th>Vice allenatore</th><td>{club.staff?.assistant_coach || '—'}</td></tr>
          <tr><th>Dirigente accompagnatore</th><td>{club.staff?.team_manager || '—'}</td></tr>
        </tbody>
      </table>

      {notes && <p style={{ marginTop: 10 }}><strong>Note:</strong> {notes}</p>}

      <div style={{ display: 'flex', gap: 30, marginTop: 26 }}>
        <div style={{ flex: 1, borderTop: '1px solid var(--line)', paddingTop: 6 }}><small>Firma dirigente</small></div>
        <div style={{ flex: 1, borderTop: '1px solid var(--line)', paddingTop: 6 }}><small>Firma capitano</small></div>
      </div>

      <p style={{ marginTop: 14 }}><small>Documento interno di supporto. Non sostituisce la distinta ufficiale prevista dal regolamento della competizione.</small></p>
    </Card>
  );
}
