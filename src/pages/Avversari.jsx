import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, setDocument, serverTimestamp, where, limit } from '../lib/db';
import { Card, Kpi, Button, Field, Input, Select, Textarea, Sheet, Badge, Empty, Loading, Alert, useToast } from '../components/ui';
import { capitalize, fmtDate, fmtLong, fmtShort, fmtTime, toDate } from '../lib/format';
import { can } from '../lib/permissions';
import {
  SCOUT_ROLES, scoutId, sameTeam, isoDay, parseRoster, mergeRoster, parseResults, mergeResults, sortResults,
  outcome, formOf, rosterSummary, sortRoster, playerAge, birthYearOf, headToHead, buildScoutInsights,
  shareText, fmtDay, autoVisible, applyAuto, applyGirone, gironeRow, teamTitle, shortTeam, buildSuggestions, ourForm
} from '../lib/scouting';
import { buildInsights, squadAlerts } from '../lib/insights';
import { compBucket } from '../lib/discipline';
import { useAutoOpponent, useGirone } from '../lib/crl';
import { parseTuttocampo } from '../lib/tuttocampoPaste';

/**
 * Scheda dell'avversario: classifica, forma, rosa, squalificati e note per
 * preparare la partita. I dati arrivano dai comunicati CRL oppure si incollano:
 * «Incolla da Tuttocampo» legge il testo che l'utente copia dalla pagina della
 * squadra. L'app non scarica nulla da siti esterni.
 * Classifica e risultati delle squadre di Prima Categoria girone A arrivano
 * da soli da public/data/girone.json (estratto dai comunicati CRL).
 */
export default function Avversari() {
  const { user } = useAuth();
  const { club } = useClub();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const canWrite = can(user?.role, 'scouting.write');

  const matchQ = useMemo(() => [where('type', '==', 'match'), limit(150)], []);
  const { data: matches, loading: loadingMatches } = useCollection('events', matchQ);
  const { data: scouts, loading: loadingScouts, error } = useCollection('scouting');

  const now = useMemo(() => new Date(), []);
  const { data: autoData } = useAutoOpponent();
  const auto = autoVisible(autoData, now) ? autoData : null;
  const { data: girone } = useGirone();
  const upcoming = useMemo(
    () => matches.filter((m) => toDate(m.date) >= now).sort((a, b) => toDate(a.date) - toDate(b.date)),
    [matches, now]
  );

  // Le squadre da proporre: prima i prossimi avversari, poi le schede già fatte.
  const options = useMemo(() => {
    const names = [];
    const add = (n) => { if (n && !names.some((x) => sameTeam(x, n) || scoutId(x) === scoutId(n))) names.push(n); };
    if (auto) add(auto.next.opponent);
    upcoming.slice(0, 4).forEach((m) => add(m.opponent));
    [...scouts].sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0)).forEach((s) => add(s.name));
    return names;
  }, [upcoming, scouts, auto]);

  const name = params.get('nome') || options[0] || '';
  const id = name ? scoutId(name) : null;
  const saved = useMemo(() => {
    const found = scouts.find((s) => s.id === id) || scouts.find((s) => sameTeam(s.name, name));
    return found || { id, name };
  }, [scouts, id, name]);
  const docId = saved.id || id;
  // L'aggiornamento automatico si somma a quanto inserito a mano, già da subito.
  const autoHere = auto && sameTeam(auto.next.opponent, name) ? auto : null;
  // Una volta salvato (o modificato) nella scheda, l'aggiornamento non si risomma:
  // così ciò che si toglie a mano resta tolto.
  const autoApplied = !!autoHere && saved.autoAppliedAt === autoHere.generatedAt;
  // Classifica e risultati del girone si sommano sempre: arrivano da ogni nuovo comunicato.
  const scout = useMemo(
    () => applyGirone(autoApplied ? saved : applyAuto(saved, autoHere), girone),
    [saved, autoHere, autoApplied, girone]
  );

  const match = useMemo(() => {
    const ev = upcoming.find((m) => sameTeam(m.opponent || '', name));
    if (ev || !autoHere) return ev;
    const n = autoHere.next;
    return { home: n.home, date: new Date(`${n.date}T${n.time || '15:00'}:00`), competition: n.competition, venue: n.venue };
  }, [upcoming, name, autoHere]);
  const h2h = useMemo(() => headToHead(matches, name), [matches, name]);
  const ref = match ? toDate(match.date) : now;
  const insights = useMemo(() => buildScoutInsights(scout, { match, ref, h2h }), [scout, match, ref, h2h]);

  // I nostri numeri entrano nei suggerimenti: forma, diffidati e squalificati.
  const { data: ourPlayers } = useCollection('players', useMemo(() => [where('active', '==', true)], []));
  const us = useMemo(() => {
    const ins = buildInsights({ players: ourPlayers, club });
    const al = squadAlerts(ourPlayers, ins, match ? compBucket(match.competition || '') : null);
    const nm = (p) => p.fullName.split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).slice(0, 2).join(' ');
    return { form: ourForm(matches), diffidati: al.diffidati.map(nm), squalificati: al.squalificati.map(nm) };
  }, [ourPlayers, matches, club, match]);
  const tips = useMemo(() => buildSuggestions(scout, { match, us }), [scout, match, us]);
  const [details, setDetails] = useState(false);

  const [adding, setAdding] = useState(false);
  const [pastingTc, setPastingTc] = useState(false);
  // Stesso girone, stesse domeniche: la giornata N dell'avversario si gioca
  // nel weekend della nostra N-esima partita di campionato.
  const roundDates = useMemo(() => matches
    .filter((m) => compBucket(m.competition || '') === 'campionato' && toDate(m.date))
    .sort((a, b) => toDate(a.date) - toDate(b.date))
    .map((m) => toDate(m.date)), [matches]);

  const save = async (patch, message = 'Scheda aggiornata') => {
    try {
      await setDocument('scouting', docId, {
        name: scout.name || name, ...patch,
        // Le schede modificate partono dai dati già arricchiti: l'aggiornamento è ormai incluso.
        ...(autoHere ? { autoAppliedAt: autoHere.generatedAt } : {}),
        updatedAt: serverTimestamp(), updatedBy: user?.name || user?.email || ''
      });
      toast(message);
      return true;
    } catch (e) {
      toast(e?.code?.includes('permission-denied')
        ? 'Firestore ha rifiutato il salvataggio: vanno pubblicate le regole aggiornate (sezione «scouting»).'
        : `Salvataggio non riuscito (${e?.code || e?.message}).`, 'error');
      return false;
    }
  };

  const share = async () => {
    const text = shareText(scout, { match, insights, ref, clubName: club.clubName });
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Riepilogo copiato: incollalo su WhatsApp'); }
    } catch (e) {
      if (e?.name !== 'AbortError') {
        try { await navigator.clipboard.writeText(text); toast('Riepilogo copiato: incollalo su WhatsApp'); }
        catch { toast('Copia non riuscita su questo dispositivo', 'error'); }
      }
    }
  };

  if (loadingMatches || loadingScouts) return <Loading />;

  return (
    <>
      <div className="pagehead">
        <div><h1>Avversari</h1><p>Scheda per preparare la partita</p></div>
        {canWrite && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>＋ Squadra</Button>}
      </div>

      {error && (
        <Alert level="error">
          Non riesco a leggere le schede avversari ({error.code || error.message}). Se è «permission-denied», vanno
          pubblicate in Firebase le regole aggiornate con la sezione «scouting».
        </Alert>
      )}

      {options.length > 1 && (
        <div className="chiprow" style={{ marginBottom: 12 }}>
          {options.map((n) => (
            <button key={n} className={`chip ${scoutId(n) === id ? 'chip--on' : ''}`} onClick={() => setParams({ nome: n })}>{n}</button>
          ))}
        </div>
      )}

      {!name ? (
        <Card>
          <Empty title="Nessun avversario in calendario"
            action={canWrite && <Button onClick={() => setAdding(true)}>Crea una scheda</Button>}>
            Inserisci le prossime partite oppure crea a mano la scheda di una squadra.
          </Empty>
        </Card>
      ) : (
        <>
          <OpponentCard scout={scout} name={name} match={match} auto={autoHere} />

          {canWrite && (
            <Button block variant="secondary" onClick={() => setPastingTc(true)} style={{ marginBottom: 12 }}>
              📋 Incolla da Tuttocampo
            </Button>
          )}

          <RecentCard scout={scout} />

          {girone?.standing?.rows?.length > 0 && (
            <GironeCard girone={girone} current={gironeRow(girone, scout.name || name)}
              onPick={(team) => { setParams({ nome: shortTeam(team) }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
          )}

          <Card title="💡 Suggerimenti">
            {tips.length ? (
              <div className="stack" style={{ gap: 12 }}>
                {tips.map((t, k) => (
                  <div key={k} style={{ display: 'flex', gap: 10 }}>
                    <span aria-hidden="true" style={{ fontSize: 20, lineHeight: '22px' }}>{t.icon}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14.5 }}>{t.title}</div>
                      <div style={{ fontSize: 14, color: 'var(--ink-soft)' }}>{t.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="Pochi dati per ora">Servono almeno classifica o un paio di risultati: arrivano da soli dai comunicati CRL, oppure con «Incolla da Tuttocampo».</Empty>
            )}
            {tips.length > 0 && <small style={{ display: 'block', marginTop: 10, color: 'var(--muted)' }}>Indicazioni ricavate dai numeri: la decisione resta al mister.</small>}
          </Card>

          <button className="grouphead grouphead--toggle" aria-expanded={details} onClick={() => setDetails((v) => !v)} style={{ marginTop: 8 }}>
            <span>{details ? '▾' : '▸'} Dettagli e modifica</span> <small>rosa, note, dati</small>
          </button>

          {details && (
            <>
              <div className="btnrow" style={{ marginBottom: 12 }}>
                <Button size="sm" onClick={share} disabled={!insights.length}>📤 Condividi riepilogo</Button>
                <Button size="sm" variant="secondary" as="a" target="_blank" rel="noopener noreferrer"
                  href={scout.tuttocampoUrl || `https://www.google.com/search?q=${encodeURIComponent(`tuttocampo ${scout.name || name} rosa`)}`}>
                  Apri su Tuttocampo ↗
                </Button>
              </div>
              {autoHere && <AutoCard auto={autoHere} applied={autoApplied} canWrite={canWrite}
                onApply={() => save({ standing: scout.standing || null, results: scout.results || [], suspended: scout.suspended || [], autoAppliedAt: autoHere.generatedAt }, 'Aggiornamento salvato nella scheda')} />}
              <StandingCard scout={scout} canWrite={canWrite} onSave={save} />
              <FormCard scout={scout} canWrite={canWrite} onSave={save} refDate={now} />
              <RosterCard scout={scout} canWrite={canWrite} onSave={save} refDate={ref} />
              <AbsentCard scout={scout} canWrite={canWrite} onSave={save} />
              <NotesCard key={docId} scout={scout} canWrite={canWrite} onSave={save} />
            {h2h.length > 0 && (
              <Card title="Precedenti">
                <div className="plist">
                  {h2h.map((r) => (
                    <div key={r.id} className="prow">
                      <span className="prow__num">{r.us}-{r.them}</span>
                      <span className="prow__body">
                        <span className="prow__name">{r.home ? 'In casa' : 'In trasferta'}</span>
                        <span className="prow__meta"><span>{fmtDate(r.date)}</span><span>{r.competition}</span></span>
                      </span>
                      <OutcomeBadge o={r.us > r.them ? 'V' : r.us === r.them ? 'N' : 'P'} />
                    </div>
                  ))}
                </div>
              </Card>
            )}
              {scout.updatedAt && (
                <small style={{ display: 'block', marginTop: 8, color: 'var(--muted)' }}>
                  Scheda aggiornata {fmtShort(scout.updatedAt)}{scout.updatedBy ? ` da ${scout.updatedBy}` : ''}
                </small>
              )}
            </>
          )}
        </>
      )}

      {pastingTc && (
        <PasteTuttocampo scout={scout} name={scout.name || name} refDate={now} roundDates={roundDates}
          onClose={() => setPastingTc(false)}
          onSave={async (patch, msg) => { if (await save(patch, msg)) setPastingTc(false); }} />
      )}

      {adding && (
        <NewTeamSheet onClose={() => setAdding(false)} onCreate={(n) => { setParams({ nome: n }); setAdding(false); }} />
      )}
    </>
  );
}

/* ---------------- pezzi della pagina ---------------- */

/** Chi è l'avversario, in un colpo d'occhio: partita, classifica, assenti. */
function OpponentCard({ scout, name, match, auto }) {
  const st = scout.standing || {};
  const absent = (scout.suspended || []).filter(Boolean);
  return (
    <Card title={scout.name || name} action={match && <Badge tone={match.home === false ? 'orange' : 'green'}>{match.home === false ? 'Trasferta' : 'Casa'}</Badge>}>
      {match ? (
        <div style={{ color: 'var(--muted)', fontSize: 13.5 }}>
          {capitalize(fmtLong(match.date))} · {fmtTime(match.date)}
          {match.venue && <div>📍 {match.venue}</div>}
        </div>
      ) : <div style={{ color: 'var(--muted)', fontSize: 13.5 }}>Nessuna partita in calendario contro questa squadra.</div>}
      {st.pos != null || st.pts != null ? (
        <div className="grid grid--kpi" style={{ marginTop: 12, gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <Kpi value={st.pos != null ? `${st.pos}°` : '—'} label={st.of ? `su ${st.of}` : 'in classifica'} accent />
          <Kpi value={st.pts ?? '—'} label={`punti · ${st.v ?? 0}-${st.n ?? 0}-${st.p ?? 0}`} />
          <Kpi value={`${st.gf ?? 0}:${st.gs ?? 0}`} label="gol fatti:subiti" />
        </div>
      ) : null}
      {absent.length > 0 && <div style={{ fontSize: 13.5, marginTop: 10 }}>🚫 Assenti: {absent.join(', ')}</div>}
      {st.asOf?.startsWith('Tuttocampo') ? (
        <small style={{ display: 'block', marginTop: 10, color: 'var(--muted)' }}>📋 Classifica da {st.asOf}</small>
      ) : st.asOf?.startsWith('CRL') ? (
        <small style={{ display: 'block', marginTop: 10, color: 'var(--muted)' }}>🔄 Classifica e risultati dai comunicati {st.asOf}</small>
      ) : auto && (
        <small style={{ display: 'block', marginTop: 10, color: 'var(--muted)' }}>
          🔄 Dati dai comunicati CRL, aggiornati il {fmtDay(auto.availableFrom)}
        </small>
      )}
    </Card>
  );
}

/**
 * «Incolla da Tuttocampo»: si apre la pagina della squadra (classifica,
 * risultati o rosa), si seleziona tutto, si copia e si incolla qui. Si
 * riconosce da solo cosa c'è e si aggiunge alla scheda solo ciò che riguarda
 * questa squadra. Si può ripetere con più pagine: i dati si sommano.
 */
export function PasteTuttocampo({ scout, name, refDate, roundDates = [], onSave, onClose, initialText = '' }) {
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => {
    const p = parseTuttocampo(text, name, refDate);
    // Senza data ma con la giornata: data stimata dal nostro calendario (segnata come stimata).
    p.results = p.results.map((r) => {
      const d = !r.date && r.round ? roundDates[r.round - 1] : null;
      return d && d <= refDate ? { ...r, date: isoDay(d), dateApprox: true } : r;
    });
    return p;
  }, [text, name, refDate, roundDates]);
  const st = parsed.standing;
  const url = scout.tuttocampoUrl || `https://www.google.com/search?q=${encodeURIComponent(`tuttocampo ${name}`)}`;

  const fromClipboard = async () => {
    try { setText(await navigator.clipboard.readText()); }
    catch { /* permesso negato: si incolla a mano nel riquadro */ }
  };

  const apply = async () => {
    setBusy(true);
    const patch = {};
    const parts = [];
    const day = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    if (st) { patch.standing = { ...st, asOf: `Tuttocampo, ${day}` }; parts.push('classifica'); }
    if (parsed.results.length) { patch.results = mergeResults(scout.results || [], parsed.results); parts.push(`${parsed.results.length} risultati`); }
    if (parsed.players.length) { patch.players = mergeRoster(scout.players || [], parsed.players); parts.push(`${parsed.players.length} giocatori`); }
    patch.tuttocampoAt = new Date().toISOString();
    await onSave(patch, `Da Tuttocampo: ${parts.join(', ')}`);
    setBusy(false);
  };

  return (
    <Sheet title="Incolla da Tuttocampo" onClose={onClose}>
      <ol style={{ fontSize: 13.5, color: 'var(--ink-soft)', paddingLeft: 18, margin: '0 0 10px' }}>
        <li>Apri su Tuttocampo la pagina di <b>{name}</b>: classifica, risultati o rosa.</li>
        <li>Tieni premuto sul testo, «Seleziona tutto» e «Copia».</li>
        <li>Torna qui e incolla: l'app riconosce da sola cosa c'è.</li>
      </ol>
      <div className="btnrow" style={{ marginBottom: 10 }}>
        <Button size="sm" variant="secondary" as="a" href={url} target="_blank" rel="noopener noreferrer">Apri Tuttocampo ↗</Button>
        {navigator.clipboard?.readText && <Button size="sm" variant="secondary" onClick={fromClipboard}>📋 Incolla dagli appunti</Button>}
      </div>
      <Field>
        <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Incolla qui il testo copiato dalla pagina" />
      </Field>

      {text.trim() && (parsed.found.length ? (
        <Alert level="ok">
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Trovato per {name}:</div>
          {st && <div style={{ fontSize: 13.5 }}>🏆 Classifica: {st.pos}° su {st.of}, {st.pts} punti in {st.g} gare ({st.v}V {st.n}N {st.p}P, gol {st.gf}:{st.gs})</div>}
          {parsed.results.length > 0 && (
            <div style={{ fontSize: 13.5 }}>⚽ Risultati: {sortResults(parsed.results).slice(0, 6).map((r) => `${r.round ? `${r.round}ª ` : ''}${r.home ? 'vs' : '@'} ${r.against} ${r.gf}-${r.gs} (${outcome(r)})`).join(' · ')}{parsed.results.length > 6 ? ` e altri ${parsed.results.length - 6}` : ''}</div>
          )}
          {parsed.players.length > 0 && <div style={{ fontSize: 13.5 }}>👥 Rosa: {parsed.players.length} giocatori ({parsed.players.filter((p) => p.birthDate || p.birthYear).length} con età)</div>}
        </Alert>
      ) : (
        <Alert level="warn">
          Non trovo dati di {name} in questo testo. Controlla di aver copiato la pagina giusta: classifica del girone, risultati o rosa della squadra.
          {parsed.rows.length >= 3 && ' La classifica c\'è, ma senza questa squadra: il nome è scritto diversamente?'}
        </Alert>
      ))}

      <div className="btnrow">
        <Button disabled={!parsed.found.length || busy} onClick={apply}>Aggiungi alla scheda</Button>
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
      </div>
      <small style={{ display: 'block', marginTop: 8, color: 'var(--muted)' }}>
        Puoi ripetere con altre pagine: i dati si sommano. Classifica e risultati aggiornano i suggerimenti.
      </small>
    </Sheet>
  );
}

/** Classifica completa del girone: si tocca una squadra per aprirne la scheda. */
function GironeCard({ girone, current, onPick }) {
  const [open, setOpen] = useState(false);
  const rows = girone.standing.rows;
  const us = rows.find((r) => sameTeam(r.team, 'Settimo Milanese'));
  // Chiusa mostra le prime cinque più noi e la squadra aperta.
  const shown = open ? rows : rows.filter((r, i) => i < 5 || r === us || r === current);
  return (
    <Card title={`🏆 Classifica ${girone.competition || 'girone'}`}
      action={<small style={{ color: 'var(--muted)' }}>{girone.standing.asOf?.replace('Comunicato Ufficiale', 'CU')}</small>}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
        <thead>
          <tr style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'right' }}>
            <th style={{ textAlign: 'left', fontWeight: 600 }} colSpan={2}>Squadra</th>
            <th style={{ fontWeight: 600 }}>Pt</th><th style={{ fontWeight: 600 }}>G</th>
            <th style={{ fontWeight: 600 }}>V-N-P</th><th style={{ fontWeight: 600 }}>Gol</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const mine = r === us, sel = r === current;
            return (
              <tr key={r.team} onClick={() => !mine && onPick(r.team)}
                style={{ cursor: mine ? 'default' : 'pointer', textAlign: 'right', borderTop: '1px solid var(--line-soft)',
                  background: sel ? 'var(--red-soft)' : undefined, fontWeight: mine || sel ? 700 : 400 }}>
                <td style={{ textAlign: 'left', padding: '7px 4px 7px 0', width: 24, color: 'var(--muted)' }}>{r.pos}</td>
                <td style={{ textAlign: 'left', padding: '7px 0' }}>{shortTeam(r.team)}</td>
                <td>{r.pts}</td><td>{r.g}</td><td>{r.v}-{r.n}-{r.p}</td><td>{r.gf}:{r.gs}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > shown.length || open ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} style={{ marginTop: 6 }}>
          {open ? 'Mostra meno' : `Tutte le ${rows.length} squadre`}
        </Button>
      ) : null}
      <small style={{ display: 'block', marginTop: 6, color: 'var(--muted)' }}>Tocca una squadra per aprirne la scheda.</small>
    </Card>
  );
}

/** Ultime cinque partite, dalla più recente, con la forma in testa. */
function RecentCard({ scout }) {
  const list = sortResults(scout.results || []).slice(0, 5);
  const f = formOf(list, 3);
  return (
    <Card title="Ultime partite" action={f.played > 0 && (
      <div style={{ display: 'flex', gap: 4 }}>{f.list.map((r, i) => <OutcomeBadge key={i} o={outcome(r)} />)}</div>
    )}>
      {list.length ? (
        <div className="plist">
          {list.map((r, i) => (
            <div key={i} className="prow" style={{ cursor: 'default', minHeight: 48 }}>
              <span className="prow__num" style={{ width: 'auto', minWidth: 38, padding: '0 6px' }}>{r.gf}-{r.gs}</span>
              <span className="prow__body">
                <span className="prow__name">{r.home ? 'vs' : '@'} {r.against}</span>
                <span className="prow__meta">
                  <span>{r.round ? `${r.round}ª giornata` : r.date ? fmtDay(r.date) : 'data n.d.'}</span>
                  <span>{r.home ? 'in casa' : 'fuori'}</span>
                  {r.competition && <span>{r.competition}</span>}
                </span>
              </span>
              <OutcomeBadge o={outcome(r)} />
            </div>
          ))}
        </div>
      ) : (
        <Empty title="Nessun risultato">I risultati arrivano dai comunicati CRL o con «Incolla da Tuttocampo».</Empty>
      )}
    </Card>
  );
}


function AutoCard({ auto, applied, canWrite, onApply }) {
  const lm = auto.lastMatch;
  return (
    <Card title="🔄 Aggiornamento automatico" action={<Badge tone="blue">{fmtDay(auto.availableFrom)}</Badge>}>
      <p style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 0 }}>
        Preparato due giorni dopo la nostra ultima partita{lm ? ` (${lm.score ? `${lm.score} ` : ''}${lm.home ? 'con' : 'a'} ${lm.opponent}, ${fmtDay(lm.date)})` : ''}
        {' '}dai comunicati CRL. Classifica, risultati e squalificati sono già inclusi nella scheda qui sotto.
      </p>
      {auto.standing?.asOf && <small style={{ display: 'block', color: 'var(--muted)' }}>Classifica: {auto.standing.asOf}</small>}
      {auto.notes && <Alert level="info">{auto.notes}</Alert>}
      {auto.sources?.length > 0 && (
        <div style={{ fontSize: 13, marginTop: 6 }}>
          Fonti: {auto.sources.map((s, i) => (
            <span key={s.url}>{i > 0 && ' · '}<a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a></span>
          ))}
        </div>
      )}
      {canWrite && (
        <div className="btnrow" style={{ marginTop: 10 }}>
          {applied
            ? <Badge tone="green">Salvato nella scheda</Badge>
            : <Button size="sm" variant="secondary" onClick={onApply}>Salva nella scheda</Button>}
        </div>
      )}
    </Card>
  );
}


const OutcomeBadge = ({ o }) => <Badge tone={o === 'V' ? 'green' : o === 'N' ? 'grey' : 'red'}>{o}</Badge>;
const num = (v) => (v === '' || v == null ? null : Number(v));

function NewTeamSheet({ onClose, onCreate }) {
  const [n, setN] = useState('');
  return (
    <Sheet title="Nuova scheda avversario" onClose={onClose}>
      <Field label="Nome della squadra" hint="Usa lo stesso nome della partita in calendario, così la scheda si collega da sola.">
        <Input value={n} onChange={(e) => setN(e.target.value)} placeholder="Es. Leone XIII Sport" autoFocus />
      </Field>
      <div className="btnrow">
        <Button disabled={n.trim().length < 2} onClick={() => onCreate(n.trim())}>Apri scheda</Button>
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
      </div>
    </Sheet>
  );
}

const STANDING_FIELDS = [
  ['pos', 'Posizione'], ['of', 'Squadre nel girone'], ['pts', 'Punti'], ['g', 'Giocate'],
  ['v', 'Vinte'], ['n', 'Pareggiate'], ['p', 'Perse'], ['gf', 'Gol fatti'], ['gs', 'Gol subiti']
];

function StandingCard({ scout, canWrite, onSave }) {
  const st = scout.standing || {};
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({});
  const edit = () => { setForm(Object.fromEntries(STANDING_FIELDS.map(([k]) => [k, st[k] ?? '']))); setOpen(true); };
  const has = st.pos != null || st.pts != null;

  return (
    <Card title="Classifica" action={canWrite && <Button size="sm" variant="ghost" onClick={edit}>{has ? 'Modifica' : 'Inserisci'}</Button>}>
      {has ? (
        <div className="grid grid--kpi">
          <Kpi value={st.pos ? `${st.pos}°` : '—'} label={st.of ? `su ${st.of} squadre` : 'Posizione'} accent />
          <Kpi value={st.pts ?? '—'} label={`Punti in ${st.g ?? '?'} gare`} />
          <Kpi value={`${st.v ?? 0}-${st.n ?? 0}-${st.p ?? 0}`} label="V-N-P" />
          <Kpi value={`${st.gf ?? 0}:${st.gs ?? 0}`} label="Gol fatti:subiti" />
        </div>
      ) : <Empty title="Classifica non inserita">La trovi su Tuttocampo o negli allegati del comunicato CRL del giovedì.</Empty>}

      {open && (
        <Sheet title="Classifica" onClose={() => setOpen(false)}>
          <div className="row2">
            {STANDING_FIELDS.map(([k, label]) => (
              <Field key={k} label={label}>
                <Input type="number" inputMode="numeric" min="0" value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
              </Field>
            ))}
          </div>
          <div className="btnrow">
            <Button onClick={async () => {
              const standing = Object.fromEntries(STANDING_FIELDS.map(([k]) => [k, num(form[k])]));
              if (await onSave({ standing }, 'Classifica salvata')) setOpen(false);
            }}>Salva</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>Annulla</Button>
          </div>
        </Sheet>
      )}
    </Card>
  );
}

function FormCard({ scout, canWrite, onSave, refDate }) {
  const results = useMemo(() => sortResults(scout.results || []), [scout.results]);
  const form = formOf(results, 3);
  const [pasting, setPasting] = useState(false);
  const [manual, setManual] = useState(false);

  const remove = (r) => onSave({ results: results.filter((x) => x !== r) }, 'Risultato eliminato');

  return (
    <Card title="Ultimi risultati" action={canWrite && (
      <div className="btnrow" style={{ gap: 4 }}>
        <Button size="sm" variant="ghost" onClick={() => setManual(true)}>＋</Button>
        <Button size="sm" variant="secondary" onClick={() => setPasting(true)}>Incolla</Button>
      </div>
    )}>
      {form.played > 0 && (
        <div className="grid grid--kpi" style={{ marginBottom: 12 }}>
          <Kpi value={`${form.pts}/${form.max}`} label={`Punti nelle ultime ${form.played}`} accent />
          <Kpi value={form.list.map(outcome).join(' ')} label="Dalla più recente" />
          <Kpi value={form.gf} label="Gol fatti" />
          <Kpi value={form.gs} label="Gol subiti" />
        </div>
      )}
      {results.length ? (
        <div className="plist">
          {results.map((r, i) => (
            <div key={i} className="prow">
              <span className="prow__num">{r.gf}-{r.gs}</span>
              <span className="prow__body">
                <span className="prow__name">{r.home ? 'vs' : '@'} {r.against}</span>
                <span className="prow__meta">
                  <span>{r.round ? `${r.round}ª giornata${r.date ? ` · ${r.dateApprox ? '≈ ' : ''}${fmtDay(r.date)}` : ''}` : r.date ? fmtDay(r.date) : 'data non indicata'}</span>
                  <span>{r.home ? 'in casa' : 'in trasferta'}</span>
                  {r.competition && <span>{r.competition}</span>}
                </span>
              </span>
              <OutcomeBadge o={outcome(r)} />
              {canWrite && <button className="iconbtn" aria-label="Elimina risultato" onClick={() => remove(r)}>🗑</button>}
            </div>
          ))}
        </div>
      ) : <Empty title="Nessun risultato">Incolla le righe dei risultati: l'app tiene solo le partite di questa squadra.</Empty>}

      {pasting && (
        <PasteResults scout={scout} refDate={refDate} onClose={() => setPasting(false)}
          onSave={async (incoming) => { if (await onSave({ results: mergeResults(results, incoming) }, `${incoming.length} risultati aggiunti`)) setPasting(false); }} />
      )}
      {manual && (
        <ManualResult scout={scout} onClose={() => setManual(false)}
          onSave={async (r) => { if (await onSave({ results: mergeResults(results, [r]) }, 'Risultato aggiunto')) setManual(false); }} />
      )}
    </Card>
  );
}

function PasteResults({ scout, refDate, onSave, onClose }) {
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseResults(text, scout.name, refDate), [text, scout.name, refDate]);
  return (
    <Sheet title="Incolla risultati" onClose={onClose}>
      <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>
        Una partita per riga, con la data se c'è. Puoi incollare un'intera giornata: le gare di altre squadre vengono ignorate.
      </p>
      <Field>
        <Textarea rows={7} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={`04/10 Pro Peschiera Borromeo - ${scout.name} 4-0\n27/09 ${scout.name} 2-2 Iris 1914`} />
      </Field>
      {text.trim() && (
        <Alert level={parsed.results.length ? 'ok' : 'warn'}>
          {parsed.results.length} partite di {scout.name} riconosciute
          {parsed.skipped ? `, ${parsed.skipped} righe ignorate` : ''}.
          {parsed.results.map((r, i) => (
            <div key={i} style={{ fontSize: 13 }}>{r.date ? fmtDay(r.date) : '—'} · {r.home ? 'vs' : '@'} {r.against} {r.gf}-{r.gs} ({outcome(r)})</div>
          ))}
        </Alert>
      )}
      <div className="btnrow">
        <Button disabled={!parsed.results.length} onClick={() => onSave(parsed.results)}>Aggiungi</Button>
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
      </div>
    </Sheet>
  );
}

function ManualResult({ scout, onSave, onClose }) {
  const [f, setF] = useState({ date: '', against: '', home: 'casa', gf: '', gs: '', competition: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Sheet title={`Risultato di ${scout.name}`} onClose={onClose}>
      <Field label="Avversaria"><Input value={f.against} onChange={set('against')} /></Field>
      <div className="row2">
        <Field label="Data"><Input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label={`${scout.name} gioca`}><Select value={f.home} onChange={set('home')} options={['casa', 'trasferta']} /></Field>
        <Field label={`Gol ${scout.name}`}><Input type="number" min="0" inputMode="numeric" value={f.gf} onChange={set('gf')} /></Field>
        <Field label="Gol avversaria"><Input type="number" min="0" inputMode="numeric" value={f.gs} onChange={set('gs')} /></Field>
      </div>
      <Field label="Competizione"><Select value={f.competition} onChange={set('competition')} options={[{ value: '', label: 'Campionato' }, 'Coppa', 'Amichevole']} /></Field>
      <div className="btnrow">
        <Button disabled={!f.against.trim() || f.gf === '' || f.gs === ''}
          onClick={() => onSave({ date: f.date, against: f.against.trim(), home: f.home === 'casa', gf: Number(f.gf), gs: Number(f.gs), competition: f.competition })}>
          Salva
        </Button>
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
      </div>
    </Sheet>
  );
}

function RosterCard({ scout, canWrite, onSave, refDate }) {
  const players = useMemo(() => sortRoster(scout.players || []), [scout.players]);
  const sum = useMemo(() => rosterSummary(players, refDate), [players, refDate]);
  const [pasting, setPasting] = useState(false);
  const [editing, setEditing] = useState(null);

  const savePlayer = async (p, original) => {
    const list = original ? players.map((x) => (x === original ? p : x)) : [...players, p];
    if (await onSave({ players: list }, original ? 'Giocatore aggiornato' : 'Giocatore aggiunto')) setEditing(null);
  };
  const removePlayer = async (p) => {
    if (await onSave({ players: players.filter((x) => x !== p) }, 'Giocatore rimosso')) setEditing(null);
  };

  return (
    <Card title="Rosa" action={canWrite && (
      <div className="btnrow" style={{ gap: 4 }}>
        <Button size="sm" variant="ghost" onClick={() => setEditing({ player: { name: '', role: '' } })}>＋</Button>
        <Button size="sm" variant="secondary" onClick={() => setPasting(true)}>Incolla</Button>
      </div>
    )}>
      {players.length ? (
        <>
          <div className="grid grid--kpi" style={{ marginBottom: 12 }}>
            <Kpi value={sum.count} label="Giocatori" accent />
            <Kpi value={sum.avgAge != null ? sum.avgAge.toLocaleString('it-IT', { maximumFractionDigits: 1 }) : '—'} label="Età media" />
            <Kpi value={sum.young} label="21 anni o meno" />
            <Kpi value={sum.veterans} label="Over 30" />
          </div>
          {sum.scorers.length > 0 && (
            <Alert level="info">
              <strong>Marcatori:</strong> {sum.scorers.slice(0, 4).map((p) => `${p.name} ${p.goals}`).join(' · ')}
            </Alert>
          )}
          {Object.entries(SCOUT_ROLES).concat([['', { label: 'Ruolo non indicato' }]]).map(([role, meta]) => {
            const group = players.filter((p) => (p.role || '') === role);
            if (!group.length) return null;
            return (
              <div key={role || 'none'}>
                <div className="grouphead">{meta.plural || meta.label} · {group.length}</div>
                <div className="plist">
                  {group.map((p) => {
                    const a = playerAge(p, refDate);
                    const y = birthYearOf(p);
                    return (
                      <button key={p.id || p.name} className="prow" onClick={() => canWrite && setEditing({ player: p, original: p })}
                        style={{ cursor: canWrite ? 'pointer' : 'default', textAlign: 'left', width: '100%' }}>
                        <span className="prow__num">{a ?? '—'}</span>
                        <span className="prow__body">
                          <span className="prow__name">{p.name}{p.key ? ' ⭐' : ''}</span>
                          <span className="prow__meta">
                            {y && <span>classe {y}</span>}
                            {p.apps != null && <span>{p.apps} pres.</span>}
                            {p.goals ? <span>{p.goals} gol</span> : null}
                            {p.note && <span>{p.note}</span>}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <small style={{ display: 'block', marginTop: 8, color: 'var(--muted)' }}>
            Il numero a sinistra è l'età il giorno della partita (con il solo anno di nascita è la classe).
          </small>
        </>
      ) : (
        <Empty title="Rosa non inserita">
          Apri la rosa su Tuttocampo, seleziona tutto e copia, poi «Incolla»: nomi, ruoli, date di nascita, presenze e gol vengono riconosciuti da soli.
        </Empty>
      )}

      {pasting && (
        <PasteRoster refDate={refDate} hasPlayers={players.length > 0} onClose={() => setPasting(false)}
          onSave={async (incoming, replace) => {
            const list = replace ? incoming : mergeRoster(players, incoming);
            if (await onSave({ players: list }, `${incoming.length} giocatori importati`)) setPasting(false);
          }} />
      )}
      {editing && (
        <PlayerSheet initial={editing.player} isNew={!editing.original} onClose={() => setEditing(null)}
          onSave={(p) => savePlayer(p, editing.original)} onRemove={() => removePlayer(editing.original)} />
      )}
    </Card>
  );
}

function PasteRoster({ refDate, hasPlayers, onSave, onClose }) {
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseRoster(text, refDate), [text, refDate]);
  const withAge = parsed.filter((p) => playerAge(p, refDate) != null).length;
  return (
    <Sheet title="Incolla la rosa" onClose={onClose}>
      <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>
        Va bene il testo copiato da Tuttocampo o da un foglio Excel. Una riga per giocatore oppure nome, ruolo e dati su righe successive.
      </p>
      <Field>
        <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={'Rossi Mario  Attaccante  12/03/2001  6  3\nBianchi Luca  Difensore  1998  6  0'} />
      </Field>
      {text.trim() && (
        <Alert level={parsed.length ? 'ok' : 'warn'}>
          {parsed.length} giocatori riconosciuti, {withAge} con età.
          {parsed.slice(0, 30).map((p) => (
            <div key={p.id} style={{ fontSize: 13 }}>
              {p.name} · {SCOUT_ROLES[p.role]?.short || '?'} · {birthYearOf(p) || '—'}
              {p.apps != null ? ` · ${p.apps} pres.` : ''}{p.goals != null ? ` · ${p.goals} gol` : ''}
            </div>
          ))}
        </Alert>
      )}
      <div className="btnrow">
        <Button disabled={!parsed.length} onClick={() => onSave(parsed, false)}>{hasPlayers ? 'Aggiungi e aggiorna' : 'Importa'}</Button>
        {hasPlayers && <Button variant="secondary" disabled={!parsed.length} onClick={() => onSave(parsed, true)}>Sostituisci tutta la rosa</Button>}
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
      </div>
    </Sheet>
  );
}

function PlayerSheet({ initial, isNew, onSave, onRemove, onClose }) {
  const [f, setF] = useState({
    name: initial.name || '', role: initial.role || '', birthDate: initial.birthDate || '',
    birthYear: initial.birthYear ?? '', apps: initial.apps ?? '', goals: initial.goals ?? '',
    note: initial.note || '', key: !!initial.key
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = () => {
    const p = { ...initial, name: f.name.trim(), role: f.role, note: f.note.trim(), key: f.key };
    p.id = initial.id || scoutId(p.name);
    p.birthDate = f.birthDate || '';
    p.birthYear = f.birthDate ? null : num(f.birthYear);
    p.apps = num(f.apps);
    p.goals = num(f.goals);
    onSave(p);
  };
  return (
    <Sheet title={isNew ? 'Nuovo giocatore' : 'Giocatore'} onClose={onClose}>
      <Field label="Nome e cognome"><Input value={f.name} onChange={set('name')} /></Field>
      <div className="row2">
        <Field label="Ruolo">
          <Select value={f.role} onChange={set('role')} options={[{ value: '', label: '—' }, ...Object.entries(SCOUT_ROLES).map(([v, m]) => ({ value: v, label: m.label }))]} />
        </Field>
        <Field label="Data di nascita"><Input type="date" value={f.birthDate} onChange={set('birthDate')} /></Field>
        <Field label="Oppure anno (classe)"><Input type="number" inputMode="numeric" value={f.birthYear} disabled={!!f.birthDate} onChange={set('birthYear')} /></Field>
        <Field label="Presenze"><Input type="number" inputMode="numeric" min="0" value={f.apps} onChange={set('apps')} /></Field>
        <Field label="Gol"><Input type="number" inputMode="numeric" min="0" value={f.goals} onChange={set('goals')} /></Field>
      </div>
      <Field label="Note" hint="Piede, caratteristiche, ex squadre, categorie giocate…">
        <Textarea rows={3} value={f.note} onChange={set('note')} />
      </Field>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, fontSize: 14 }}>
        <input type="checkbox" checked={f.key} onChange={(e) => setF((x) => ({ ...x, key: e.target.checked }))} />
        Giocatore chiave da tenere d'occhio ⭐
      </label>
      <div className="btnrow">
        <Button disabled={f.name.trim().length < 3} onClick={submit}>Salva</Button>
        {!isNew && <Button variant="danger" onClick={onRemove}>Rimuovi</Button>}
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
      </div>
    </Sheet>
  );
}

function AbsentCard({ scout, canWrite, onSave }) {
  const list = scout.suspended || [];
  const [value, setValue] = useState('');
  const add = async () => {
    const v = value.trim();
    if (!v) return;
    if (await onSave({ suspended: [...list, v] }, 'Assente aggiunto')) setValue('');
  };
  if (!canWrite && !list.length) return null;
  return (
    <Card title="Squalificati e assenti">
      {list.length ? (
        <div className="chiprow" style={{ flexWrap: 'wrap', marginBottom: canWrite ? 10 : 0 }}>
          {list.map((n, i) => (
            <span key={i} className="chip" style={{ cursor: 'default' }}>
              {n}
              {canWrite && (
                <button aria-label={`Togli ${n}`} onClick={() => onSave({ suspended: list.filter((_, j) => j !== i) }, 'Rimosso')}
                  style={{ border: 0, background: 'none', marginLeft: 6, cursor: 'pointer', color: 'inherit' }}>✕</button>
              )}
            </span>
          ))}
        </div>
      ) : <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>Le squalifiche sono nel comunicato CRL del giovedì, sezione Giudice Sportivo.</p>}
      {canWrite && (
        <div className="btnrow">
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Nome (es. Rossi – 1 giornata)"
            onKeyDown={(e) => e.key === 'Enter' && add()} style={{ flex: 1 }} />
          <Button size="sm" onClick={add} disabled={!value.trim()}>Aggiungi</Button>
        </div>
      )}
    </Card>
  );
}

const NOTE_FIELDS = [
  ['modulo', 'Modulo e atteggiamento', 'Es. 4-4-2 compatto, ripartono in contropiede'],
  ['forza', 'Punti di forza', ''],
  ['debolezza', 'Punti deboli', ''],
  ['piazzati', 'Palle inattive', 'Chi batte, dove vanno, chi salta'],
  ['chiave', 'Giocatori da tenere d\'occhio', ''],
  ['altro', 'Altre note', 'Campo, arbitro, ambiente…']
];

function NotesCard({ scout, canWrite, onSave }) {
  const [notes, setNotes] = useState(scout.notes || {});
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setNotes(scout.notes || {}); }, [scout.notes, dirty]);
  const filled = NOTE_FIELDS.filter(([k]) => notes[k]?.trim());

  if (!canWrite) {
    if (!filled.length) return null;
    return (
      <Card title="Note tecniche">
        {filled.map(([k, label]) => (
          <div key={k} style={{ marginBottom: 10 }}><strong>{label}</strong><div style={{ whiteSpace: 'pre-wrap' }}>{notes[k]}</div></div>
        ))}
      </Card>
    );
  }
  return (
    <Card title="Note tecniche" action={dirty && <Badge tone="orange">Non salvate</Badge>}>
      {NOTE_FIELDS.map(([k, label, ph]) => (
        <Field key={k} label={label}>
          <Textarea rows={2} value={notes[k] || ''} placeholder={ph}
            onChange={(e) => { setNotes((n) => ({ ...n, [k]: e.target.value })); setDirty(true); }} />
        </Field>
      ))}
      <Field label="Link alla squadra su Tuttocampo" hint="Facoltativo: il pulsante «Apri su Tuttocampo» porterà direttamente lì.">
        <Input value={notes.__url ?? scout.tuttocampoUrl ?? ''} placeholder="https://www.tuttocampo.it/…"
          onChange={(e) => { setNotes((n) => ({ ...n, __url: e.target.value })); setDirty(true); }} />
      </Field>
      <Button disabled={!dirty} onClick={async () => {
        const { __url, ...clean } = notes;
        const patch = { notes: clean };
        if (__url !== undefined) patch.tuttocampoUrl = __url.trim();
        if (await onSave(patch, 'Note salvate')) setDirty(false);
      }}>Salva note</Button>
    </Card>
  );
}
