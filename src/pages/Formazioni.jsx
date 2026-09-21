import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, setDocument, serverTimestamp, where, limit } from '../lib/db';
import { Card, Button, Field, Input, Select, Badge, Empty, Loading, useToast, Alert, Textarea, Sheet } from '../components/ui';
import { buildLineupMessage, copyText, shareMessage } from '../lib/callup';
import { errorText } from './Rosa';
import { fmtShort, sortPlayers, shortName, toDate } from '../lib/format';
import { MODULES } from '../lib/modules';
import { GROUPS, groupOf } from '../lib/format';
/** Ordinamento in memoria: la query filtra per tipo, senza indici da creare. */
const byDateDesc = (list) => [...list].sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0));

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
  // I numeri valgono per la singola gara: in Prima Categoria cambiano di domenica in domenica.
  const [numbers, setNumbers] = useState({});

  useEffect(() => {
    if (!saved) { setSlots({}); return; }
    setModule(saved.module || club.defaultModule);
    setSlots(saved.slots || {});
    setCaptain(saved.captain || '');
    setNotes(saved.notes || '');
    setNumbers(saved.numbers || {});
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

  /** Primo numero libero, così non si devono ricordare quelli già dati. */
  const freeNumber = (preferred) => {
    const taken = new Set(Object.values(numbers).map(Number).filter(Boolean));
    if (preferred && !taken.has(preferred)) return String(preferred);
    for (let i = 1; i <= 99; i++) if (!taken.has(i)) return String(i);
    return '';
  };

  const setNumber = (playerId, value) => {
    const v = String(value).replace(/\D/g, '').slice(0, 2);
    setNumbers((n) => {
      const next = { ...n };
      if (v === '' || v === '0') delete next[playerId]; else next[playerId] = v;
      return next;
    });
  };

  /** Numeri usati da più di un giocatore: in distinta verrebbero respinti. */
  const duplicates = useMemo(() => {
    const seen = {}, dup = new Set();
    Object.entries(numbers).forEach(([id, n]) => { if (seen[n]) dup.add(n); seen[n] = id; });
    return dup;
  }, [numbers]);

  /**
   * Numerazione classica: 1 al portiere, poi i titolari nell'ordine del modulo
   * e infine la panchina. Si corregge a mano dove serve.
   */
  const autoNumber = () => {
    const result = {};
    let next = 2;
    const gkSlot = slotList.find((sl) => sl.label === 'POR' && slots[sl.id]);
    if (gkSlot) result[slots[gkSlot.id]] = '1';
    slotList.forEach((sl) => {
      const id = slots[sl.id];
      if (id && !result[id]) result[id] = String(next++);
    });
    bench.forEach((p) => { if (!result[p.id]) result[p.id] = String(next++); });
    setNumbers(result);
    toast('Numeri assegnati: correggi quelli che vuoi diversi');
  };

  /** Assegna il giocatore e propone subito un numero, se non ne ha già uno. */
  const assign = (playerId) => {
    const slotLabel = slotList.find((x) => x.id === picking)?.label;
    setSlots((v) => {
      const next = { ...v };
      // Se giocava altrove, libera quella posizione invece di duplicarlo.
      Object.keys(next).forEach((k) => { if (next[k] === playerId) next[k] = ''; });
      next[picking] = playerId;
      return next;
    });
    if (!numbers[playerId]) {
      setNumbers((n) => ({ ...n, [playerId]: freeNumber(slotLabel === 'POR' ? 1 : null) }));
    }
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
    byId, bench, captain, numbers
  }) : ''), [club, match, module, slotList, slots, byId, bench, captain, numbers]);

  const save = async () => {
    await setDocument('lineups', eventId, {
      eventId, module, slots, captain, notes, numbers,
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
                {p ? (numbers[p.id] || s.label) : '+'}
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
          <Button size="sm" variant="secondary" onClick={autoNumber} disabled={!starters.length}>Numera 1-11</Button>
          <Button size="sm" variant="ghost" onClick={() => { setSlots({}); setNumbers({}); setPicking(null); }}>Svuota</Button>
        </div>

        {duplicates.size > 0 && (
          <Alert level="error">
            Numero {[...duplicates].join(', ')} assegnato a più giocatori: correggilo prima di inviare la formazione.
          </Alert>
        )}

        <p><small>Tocca una posizione sul campo o un nome per cambiare giocatore. Il numero si scrive nella casella a sinistra, la fascia da capitano con la Ⓒ.</small></p>
            <div className="plist">
              {slotList.map((s) => {
                const p = byId[slots[s.id]];
                return (
                  <div key={s.id} className="prow">
                    {p ? (
                      <Input aria-label={`Numero di ${p.fullName}`} value={numbers[p.id] || ''}
                        onChange={(e) => setNumber(p.id, e.target.value)}
                        inputMode="numeric" placeholder="–"
                        style={{
                          width: 52, minHeight: 40, padding: '6px 4px', textAlign: 'center', fontWeight: 700,
                          borderColor: duplicates.has(numbers[p.id]) ? 'var(--red)' : undefined
                        }} />
                    ) : <span className="prow__num">{s.label}</span>}
                    <span className="prow__body" onClick={() => setPicking(s.id)} style={{ cursor: 'pointer' }}>
                      <span className="prow__name" style={p ? undefined : { color: 'var(--muted)' }}>
                        {p ? p.fullName : 'da assegnare'}
                      </span>
                      {p && <span className="prow__meta"><span>{s.label}</span></span>}
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
            {bench.length > 0 && (
              <>
                <div className="grouphead" style={{ marginTop: 16 }}>Panchina <small>{bench.length}</small></div>
                <div className="plist">
                  {bench.map((b) => (
                    <div key={b.id} className="prow">
                      <Input aria-label={`Numero di ${b.fullName}`} value={numbers[b.id] || ''}
                        onChange={(e) => setNumber(b.id, e.target.value)}
                        inputMode="numeric" placeholder="–"
                        style={{
                          width: 52, minHeight: 40, padding: '6px 4px', textAlign: 'center', fontWeight: 700,
                          borderColor: duplicates.has(numbers[b.id]) ? 'var(--red)' : undefined
                        }} />
                      <span className="prow__body">
                        <span className="prow__name">{b.fullName}</span>
                        <span className="prow__meta"><span>{b.position}</span></span>
                      </span>
                      <button className="iconbtn" aria-label="Capitano"
                        onClick={() => setCaptain(captain === b.id ? '' : b.id)}
                        style={captain === b.id ? { borderColor: 'var(--red)', color: 'var(--red)' } : undefined}>
                        Ⓒ
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div style={{ marginTop: 14 }}>
              <Field label="Note gara">
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>
      </Card>

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
          {slots[picking] && (
            <Field label="Numero di maglia" hint="Proposto il primo libero: cambialo se serve.">
              <Input value={numbers[slots[picking]] || ''} onChange={(e) => setNumber(slots[picking], e.target.value)}
                inputMode="numeric" placeholder="10" maxLength={2} />
            </Field>
          )}
          {slots[picking] && duplicates.has(numbers[slots[picking]]) && (
            <Alert level="error">Il numero {numbers[slots[picking]]} è già assegnato a un altro giocatore.</Alert>
          )}
          <Button block onClick={() => setPicking(null)}>Fatto</Button>
        </Sheet>
      )}

      <Card title="Messaggio per la distinta" className="noprint">
        <p><small>Da mandare a chi compila la distinta con il tool della società, anche a distanza di giorni dalla convocazione. Non contiene i numeri di documento: quelli restano nell'app, nella scheda del giocatore.</small></p>
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

    </>
  );
}
