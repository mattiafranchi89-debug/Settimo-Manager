import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, setDocument, serverTimestamp, where, limit } from '../lib/db';
import { Card, Button, Field, Input, Select, Badge, Empty, Loading, useToast, Alert, Textarea, Sheet } from '../components/ui';
import { buildLineupMessage, copyText, shareMessage, whatsappLink, callupFor } from '../lib/callup';
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
  // Il portale LND chiede capitano e vice come due campi distinti.
  const [vice, setVice] = useState('');
  const [notes, setNotes] = useState('');
  // I numeri valgono per la singola gara: in Prima Categoria cambiano di domenica in domenica.
  const [numbers, setNumbers] = useState({});

  useEffect(() => {
    if (!saved) { setSlots({}); return; }
    setModule(saved.module || club.defaultModule);
    setSlots(saved.slots || {});
    setCaptain(saved.captain || '');
    setVice(saved.vice || '');
    setNotes(saved.notes || '');
    setNumbers(saved.numbers || {});
  }, [saved, club.defaultModule]);

  const match = matches.find((m) => m.id === eventId);
  const callup = useMemo(() => callupFor(callups, eventId, { drafts: true }), [callups, eventId]);
  const pool = useMemo(() => {
    const ids = callup?.players;
    return sortPlayers(ids ? players.filter((p) => ids.includes(p.id)) : players);
  }, [players, callup]);

  const slotList = MODULES[module] || MODULES['4-3-1-2'];
  const starters = Object.values(slots).filter(Boolean);
  const bench = pool.filter((p) => !starters.includes(p.id));
  const byId = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p])), [players]);
  // Una formazione salvata prima di cambiare la convocazione può tenere in campo
  // chi non è più convocato: va segnalato, non tolto in silenzio.
  const notCalled = callup ? starters.filter((id) => !callup.players?.includes(id)).map((id) => byId[id]).filter(Boolean) : [];

  const [picking, setPicking] = useState(null);

  // Due modi di fare la stessa formazione: «Rapida» (lista, per il mister dal
  // telefono) e «Campo» (modulo e posizioni). Salvano lo stesso documento.
  const [mode, setModeState] = useState(() => {
    try { return localStorage.getItem('sm-lineup-mode') || (user?.role === 'head_coach' ? 'rapida' : 'campo'); }
    catch { return 'rapida'; }
  });
  const setMode = (m) => { setModeState(m); try { localStorage.setItem('sm-lineup-mode', m); } catch { /* ignorabile */ } };

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

  /**
   * Le due fasce si escludono a vicenda: dare la Ⓒ a chi era vice libera la Ⓥ,
   * così non si arriva al portale con lo stesso nome nei due campi.
   */
  const toggleCaptain = (id) => {
    setCaptain((c) => (c === id ? '' : id));
    setVice((v) => (v === id ? '' : v));
  };
  const toggleVice = (id) => {
    setVice((v) => (v === id ? '' : id));
    setCaptain((c) => (c === id ? '' : c));
  };

  /** Le due fasce, accanto al nome: stessa riga in campo e in panchina. */
  const fasce = (id) => (
    <>
      <button className="iconbtn" aria-label="Capitano" aria-pressed={captain === id}
        onClick={(e) => { e.stopPropagation(); toggleCaptain(id); }}
        style={captain === id ? { borderColor: 'var(--red)', color: 'var(--red)' } : undefined}>
        Ⓒ
      </button>
      <button className="iconbtn" aria-label="Vice capitano" aria-pressed={vice === id}
        onClick={(e) => { e.stopPropagation(); toggleVice(id); }}
        style={vice === id ? { borderColor: 'var(--blue)', color: 'var(--blue)' } : undefined}>
        Ⓥ
      </button>
    </>
  );

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
    byId, bench, captain, vice, numbers
  }) : ''), [club, match, module, slotList, slots, byId, bench, captain, vice, numbers]);

  const save = async () => {
    await setDocument('lineups', eventId, {
      eventId, module, slots, captain, vice, notes, numbers,
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
        {mode === 'campo' && (
          <Field label="Modulo">
            <Select value={module} onChange={(e) => { setModule(e.target.value); setSlots({}); }} options={Object.keys(MODULES)} />
          </Field>
        )}
        {!callup && <Alert level="info">Nessuna convocazione collegata: puoi scegliere fra tutti i giocatori in rosa.</Alert>}
        {notCalled.length > 0 && (
          <Alert level="warn">
            Non convocat{notCalled.length === 1 ? 'o' : 'i'} ma in formazione: {notCalled.map((p) => p.fullName).join(', ')}.
            Tocca la posizione sul campo per sostituirl{notCalled.length === 1 ? 'o' : 'i'}.
          </Alert>
        )}
      </div>

      <div className="subtabs noprint" style={{ marginTop: 4 }}>
        {[['rapida', 'Rapida'], ['campo', 'Campo e modulo']].map(([k, l]) => (
          <button key={k} className={`subtab${mode === k ? ' subtab--on' : ''}`} onClick={() => setMode(k)}
            style={{ border: 0, background: mode === k ? undefined : 'none', cursor: 'pointer' }}>{l}</button>
        ))}
      </div>

      {mode === 'rapida' && match && (
        <Rapida pool={pool} slots={slots} setSlots={setSlots} slotList={slotList}
          numbers={numbers} setNumbers={setNumbers} captain={captain} vice={vice}
          toggleCaptain={toggleCaptain} toggleVice={toggleVice}
          club={club} match={match} lineupMessage={lineupMessage} save={save} toast={toast} />
      )}

      {mode === 'campo' && <>
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

        <p><small>Tocca una posizione sul campo o un nome per cambiare giocatore. Il numero si scrive nella casella a sinistra, la fascia da capitano con la Ⓒ, quella da vice con la Ⓥ.</small></p>
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
                    {p && fasce(p.id)}
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
                      {fasce(b.id)}
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

      </>}

      {mode === 'campo' && <Card title="Messaggio per la distinta" className="noprint">
        <p><small>Da mandare a chi compila la distinta con il tool della società, anche a distanza di giorni dalla convocazione. Non contiene i numeri di documento: quelli restano nell'app, nella scheda del giocatore.</small></p>
        <div className="msgbox">{lineupMessage}</div>
        <div className="btnrow" style={{ marginTop: 12 }}>
          <Button disabled={!starters.length}
            onClick={async () => {
              try {
                await save();
                const phone = (club.distintaPhone || '').replace(/\D/g, '');
                if (phone) window.open(whatsappLink(phone, lineupMessage), '_blank', 'noopener');
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
      </Card>}

    </>
  );
}

/* =====================================================================
   Modalità rapida: lista dei convocati, un tocco per il titolare,
   numeri automatici che si cambiano scambiandoli. Pensata per il telefono.
   ===================================================================== */

// Posizioni del modulo preferite per ogni ruolo: il titolare scelto dalla
// lista finisce in un posto coerente, così la vista «Campo» resta sensata.
const PREFERRED = {
  POR: ['POR'], DC: ['DC'], TD: ['TD', 'DC'], TS: ['TS', 'DC'],
  CC: ['CC', 'MZ', 'TRQ'], TRQ: ['TRQ', 'CC', 'MZ'], ES: ['ED', 'ES', 'MZ', 'AD', 'AS'],
  ATT: ['ATT', 'PC', 'AD', 'AS', 'TRQ']
};

function Rapida({ pool, slots, setSlots, slotList, numbers, setNumbers, captain, vice, toggleCaptain, toggleVice, club, match, lineupMessage, save, toast }) {
  const [editing, setEditing] = useState(null);
  const [sending, setSending] = useState(false);
  const starterIds = new Set(Object.values(slots).filter(Boolean));
  const starters = sortPlayers(pool.filter((p) => starterIds.has(p.id)));
  const bench = sortPlayers(pool.filter((p) => !starterIds.has(p.id)));
  const hasGk = starters.some((p) => p.position === 'POR');

  // Ogni convocato ha sempre un numero: titolari 1-11 (1 al portiere), panchina dal 12.
  useEffect(() => {
    const taken = new Set(Object.values(numbers).map(Number).filter(Boolean));
    const next = { ...numbers };
    let changed = false;
    const free = (from, to) => { for (let i = from; i <= to; i++) if (!taken.has(i)) { taken.add(i); return String(i); } return ''; };
    [...starters, ...bench].forEach((p) => {
      if (next[p.id]) return;
      const n = starterIds.has(p.id) ? (p.position === 'POR' ? free(1, 1) || free(2, 11) : free(2, 11) || free(1, 11)) : free(12, 40);
      if (n) { next[p.id] = n; changed = true; }
    });
    if (changed) setNumbers(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, slots]);

  const toggleStarter = (p) => {
    if (starterIds.has(p.id)) {
      setSlots((v) => Object.fromEntries(Object.entries(v).map(([k, id]) => [k, id === p.id ? '' : id])));
      // Torna in panchina con un numero da panchina.
      const n = Number(numbers[p.id]);
      if (n && n <= 11) setNumbers((x) => { const y = { ...x }; delete y[p.id]; return y; });
      return;
    }
    if (starterIds.size >= 11) { toast('Hai già 11 titolari: togline uno prima', 'error'); return; }
    const empty = slotList.filter((sl) => !slots[sl.id]);
    const prefs = PREFERRED[p.position] || [];
    const slot = prefs.map((l) => empty.find((sl) => sl.label === l)).find(Boolean)
      || empty.find((sl) => (p.position === 'POR') === (sl.label === 'POR'))
      || empty[0];
    if (!slot) return;
    setSlots((v) => ({ ...v, [slot.id]: p.id }));
    const n = Number(numbers[p.id]);
    if (!n || n > 11) setNumbers((x) => { const y = { ...x }; delete y[p.id]; return y; });
  };

  /** Il numero scelto, se è già di un altro, passa a lui il numero vecchio: niente doppioni. */
  const pickNumber = (p, n) => {
    const value = String(n);
    setNumbers((x) => {
      const y = { ...x };
      const other = Object.keys(y).find((id) => y[id] === value && id !== p.id);
      if (other) y[other] = x[p.id] || '';
      y[p.id] = value;
      return y;
    });
  };

  const renumber = () => {
    const result = {};
    let next = 2;
    const gk = starters.find((p) => p.position === 'POR');
    if (gk) result[gk.id] = '1'; else next = 1;
    starters.filter((p) => p !== gk).forEach((p) => { result[p.id] = String(next++); });
    let b = 12;
    bench.forEach((p) => { result[p.id] = String(b++); });
    setNumbers(result);
    toast('Numerati per ruolo: titolari 1-11, panchina dal 12');
  };

  const send = async () => {
    setSending(true);
    try {
      await save();
      const phone = (club.distintaPhone || '').replace(/\D/g, '');
      if (phone) window.open(whatsappLink(phone, lineupMessage), '_blank', 'noopener');
      else await shareMessage(lineupMessage, 'Formazione');
    } catch (e) { toast(errorText(e), 'error'); }
    setSending(false);
  };

  const Row = ({ p, starter }) => (
    <div className="prow" style={starter ? { borderColor: 'var(--red)', background: 'var(--red-soft)' } : undefined}>
      <button onClick={() => setEditing(p)} aria-label={`Numero di ${p.fullName}: ${numbers[p.id] || 'nessuno'}`}
        style={{ width: 44, height: 44, borderRadius: 10, border: 0, flex: '0 0 auto', cursor: 'pointer',
          background: starter ? 'var(--red)' : 'var(--ink)', color: '#fff', fontFamily: 'var(--display)', fontSize: 19, fontWeight: 700 }}>
        {numbers[p.id] || '–'}
      </button>
      <button onClick={() => toggleStarter(p)} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 0, padding: '6px 0', font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
        <span className="prow__name" style={{ display: 'block' }}>
          {p.fullName}{captain === p.id ? ' Ⓒ' : vice === p.id ? ' Ⓥ' : ''}
        </span>
        <span className="prow__meta"><span>{p.position}</span>{p.injury?.active && <span>🩹 infortunato</span>}</span>
      </button>
      <button onClick={() => toggleStarter(p)} className="chip" style={{ minHeight: 36, padding: '6px 12px', ...(starter ? { background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' } : {}) }}>
        {starter ? 'Titolare' : '+ Titolare'}
      </button>
    </div>
  );

  return (
    <div className="noprint">
      <Alert level="info">
        Tocca un nome per metterlo <b>titolare</b>. Il numero si assegna da solo: tocca il riquadro col numero per cambiarlo o dare la fascia.
      </Alert>

      <div className="grouphead">Titolari <small>{starters.length}/11</small></div>
      {starters.length === 0
        ? <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>Nessun titolare ancora: scegli dalla lista dei convocati qui sotto.</p>
        : <div className="plist">{[...starters].sort((a, b) => (Number(numbers[a.id]) || 99) - (Number(numbers[b.id]) || 99)).map((p) => <Row key={p.id} p={p} starter />)}</div>}

      <div className="grouphead">{starters.length ? 'Panchina' : 'Convocati'} <small>{bench.length}</small></div>
      <div className="plist">{bench.map((p) => <Row key={p.id} p={p} />)}</div>

      <div className="btnrow" style={{ marginTop: 10 }}>
        <Button size="sm" variant="ghost" onClick={renumber} disabled={!starters.length}>Rinumera per ruolo</Button>
      </div>

      {/* Barra fissa sopra le schede in basso: stato e invio sempre a portata di pollice. */}
      <div style={{ position: 'sticky', bottom: 'calc(var(--tabbar-h) + 10px + env(safe-area-inset-bottom))', marginTop: 16, zIndex: 20 }}>
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ flex: 1, fontSize: 13.5 }}>
            <b style={{ color: starters.length === 11 ? 'var(--green)' : 'var(--red)' }}>{starters.length}/11</b> titolari
            {starters.length > 0 && !hasGk && <div style={{ color: 'var(--red)', fontSize: 12 }}>Manca il portiere</div>}
            {starters.length === 11 && !captain && <div style={{ color: 'var(--muted)', fontSize: 12 }}>Capitano non indicato</div>}
          </div>
          <Button disabled={starters.length !== 11 || sending} onClick={send}>
            {club.distintaPhone ? `Invia a ${club.distintaNome || 'distinta'}` : 'Invia formazione'}
          </Button>
        </div>
      </div>

      {editing && (
        <Sheet title={editing.fullName} onClose={() => setEditing(null)}>
          <p style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 0 }}>
            Scegli il numero. Se è già di un altro, i due numeri si scambiano.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
            {Array.from({ length: Math.max(25, pool.length + 5) }, (_, i) => String(i + 1)).map((n) => {
              const owner = pool.find((p) => numbers[p.id] === n && p.id !== editing.id);
              const mine = numbers[editing.id] === n;
              return (
                <button key={n} onClick={() => { pickNumber(editing, n); setEditing(null); }}
                  style={{ minHeight: 48, borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 17,
                    border: `2px solid ${mine ? 'var(--red)' : 'var(--line)'}`,
                    background: mine ? 'var(--red)' : owner ? 'var(--grey-50, #f3f3f3)' : 'var(--surface)',
                    color: mine ? '#fff' : owner ? 'var(--muted)' : 'var(--ink)' }}>
                  {n}
                  {owner && <span style={{ display: 'block', fontSize: 9.5, fontWeight: 600 }}>{owner.fullName.split(' ')[0].slice(0, 8)}</span>}
                </button>
              );
            })}
          </div>
          <div className="btnrow" style={{ marginTop: 14 }}>
            <Button variant={captain === editing.id ? 'primary' : 'secondary'} onClick={() => toggleCaptain(editing.id)}>Ⓒ Capitano</Button>
            <Button variant={vice === editing.id ? 'primary' : 'secondary'} onClick={() => toggleVice(editing.id)}>Ⓥ Vice</Button>
            <Button variant="ghost" onClick={() => { toggleStarter(editing); setEditing(null); }}>
              {starterIds.has(editing.id) ? 'Metti in panchina' : 'Metti titolare'}
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
