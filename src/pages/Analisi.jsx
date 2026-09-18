import { useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, where, limit } from '../lib/db';
import { playerInsight } from '../lib/insights';
import { Card, Kpi, Badge, Empty, Loading, Alert } from '../components/ui';
import { fmtShort, fmtDate, toDate, sortPlayers } from '../lib/format';
import { can } from '../lib/permissions';

/* ----------------------- barre disegnate senza librerie ----------------------- */

function Bars({ rows, max, unit = '', tone = 'var(--red)' }) {
  const top = max || Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="stack" style={{ gap: 6 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '92px 1fr 48px', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
          <span style={{ background: 'var(--grey-50)', borderRadius: 6, height: 14, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.min(100, (r.value / top) * 100)}%`, background: r.color || tone, borderRadius: 6 }} />
          </span>
          <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.value}{unit}</span>
        </div>
      ))}
    </div>
  );
}

const isoWeek = (d) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-${String(Math.ceil(((t - start) / 86400000 + 1) / 7)).padStart(2, '0')}`;
};

const TABS = [['rendimento', 'Rendimento'], ['rotazione', 'Rotazione'], ['impiego', 'Impiego'], ['allenamenti', 'Allenamenti'], ['gol', 'Gol'], ['disciplina', 'Disciplina'], ['note', 'Note']];

export default function Analisi() {
  const { user } = useAuth();
  const { club } = useClub();
  const staff = can(user?.role, 'attendance.write') || can(user?.role, 'matchstats.write');
  const [tab, setTab] = useState('rendimento');

  const { data: players, loading } = useCollection('players', useMemo(() => [where('active', '==', true)], []));
  const { data: matchesAll } = useCollection('events', useMemo(() => [where('type', '==', 'match'), limit(120)], []));
  const { data: trainingsAll } = useCollection('events', useMemo(() => [where('type', '==', 'training'), limit(300)], []), staff);
  const { data: matchStats } = useCollection('matchStats', [], staff);
  const { data: attendance } = useCollection('attendance', [], staff);

  const season = club.season;
  const matches = useMemo(() => matchesAll.filter((m) => !m.seasonId || m.seasonId === season), [matchesAll, season]);
  const trainings = useMemo(() => trainingsAll.filter((m) => !m.seasonId || m.seasonId === season), [trainingsAll, season]);
  const played = useMemo(() => matches.filter((m) => m.scoreHome != null).sort((a, b) => toDate(a.date) - toDate(b.date)), [matches]);

  if (loading) return <Loading />;

  return (
    <>
      <div className="pagehead">
        <div><h1>Analisi</h1><p>Stagione {season} · {played.length} gare con risultato</p></div>
      </div>
      <div className="chiprow">
        {TABS.filter(([k]) => staff || ['rendimento', 'rotazione', 'disciplina'].includes(k)).filter(([k]) => k !== 'impiego' || staff).map(([k, l]) => (
          <button key={k} className={`chip ${tab === k ? 'chip--on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'rendimento' && <Rendimento played={played} club={club} />}
      {tab === 'rotazione' && <Rotazione players={players} />}
      {tab === 'impiego' && <Impiego players={players} club={club} />}
      {tab === 'allenamenti' && <Allenamenti players={players} trainings={trainings} attendance={attendance} />}
      {tab === 'gol' && <Gol matchStats={matchStats} matches={matches} />}
      {tab === 'disciplina' && <Disciplina players={players} club={club} />}
      {tab === 'note' && <Note matchStats={matchStats} matches={matches} />}
    </>
  );
}

/* ------------------------------- rendimento ------------------------------- */

function Rendimento({ played, club }) {
  const rows = played.map((m) => {
    const us = m.home === false ? m.scoreAway : m.scoreHome;
    const them = m.home === false ? m.scoreHome : m.scoreAway;
    const pts = us > them ? 3 : us === them ? 1 : 0;
    return { m, us, them, pts, home: m.home !== false };
  });
  if (!rows.length) return <Card><Empty title="Nessun risultato registrato">Inserisci i risultati dalla sezione Partite per vedere il rendimento.</Empty></Card>;

  const sum = (list, f) => list.reduce((a, r) => a + f(r), 0);
  const pts = sum(rows, (r) => r.pts);
  const home = rows.filter((r) => r.home), away = rows.filter((r) => !r.home);
  const last5 = rows.slice(-5);
  const half = Math.floor(rows.length / 2);
  const first = rows.slice(0, half), second = rows.slice(half);
  const ppg = (l) => (l.length ? (sum(l, (r) => r.pts) / l.length).toFixed(2) : '—');

  return (
    <>
      <div className="grid grid--kpi">
        <Kpi value={pts} label={`Punti in ${rows.length} gare`} accent />
        <Kpi value={ppg(rows)} label="Punti a partita" />
        <Kpi value={sum(rows, (r) => r.us)} label="Gol fatti" />
        <Kpi value={sum(rows, (r) => r.them)} label="Gol subiti" tone="red" />
      </div>

      <Card title="Ultime cinque">
        <div className="btnrow">
          {last5.map((r) => (
            <Badge key={r.m.id} tone={r.pts === 3 ? 'green' : r.pts === 1 ? 'orange' : 'red'}>
              {r.pts === 3 ? 'V' : r.pts === 1 ? 'N' : 'P'} {r.us}-{r.them} {r.m.opponent}
            </Badge>
          ))}
        </div>
      </Card>

      <Card title="Casa e trasferta">
        <Bars rows={[
          { label: `Casa (${home.length})`, value: Number(ppg(home)) || 0 },
          { label: `Trasferta (${away.length})`, value: Number(ppg(away)) || 0 }
        ]} max={3} unit=" pt/g" />
      </Card>

      {rows.length >= 4 && (
        <Card title="Prima e seconda metà">
          <Bars rows={[
            { label: `Prime ${first.length}`, value: Number(ppg(first)) || 0 },
            { label: `Ultime ${second.length}`, value: Number(ppg(second)) || 0 }
          ]} max={3} unit=" pt/g" />
          <p><small>Se la seconda barra è più lunga, la squadra sta crescendo.</small></p>
        </Card>
      )}

      <Card title="Tutte le gare">
        <div className="tablewrap">
          <table className="data">
            <thead><tr><th>Data</th><th>Avversario</th><th>Ris.</th><th>Pt</th></tr></thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.m.id}><td>{fmtShort(r.m.date)}</td><td>{r.m.opponent}{r.home ? '' : ' (T)'}</td><td>{r.us}-{r.them}</td><td>{r.pts}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/* -------------------------------- rotazione -------------------------------- */

function Rotazione({ players }) {
  const total = Math.max(1, ...players.map((p) => p.stats?.matchesPlayedTotal || 0));
  const possible = total * 90;
  const rows = sortPlayers(players).map((p) => ({ p, minutes: p.stats?.minutes || 0, pct: Math.round(((p.stats?.minutes || 0) / possible) * 100) }))
    .sort((a, b) => b.minutes - a.minutes);
  if (!rows.some((r) => r.minutes)) return <Card><Empty title="Nessun minutaggio">Chiudi le schede gara per popolare la rotazione.</Empty></Card>;

  const heavy = rows.filter((r) => r.pct >= 70).length;
  const light = rows.filter((r) => r.pct < 10).length;
  return (
    <>
      <div className="grid grid--kpi">
        <Kpi value={heavy} label="Oltre il 70% dei minuti" accent />
        <Kpi value={rows.filter((r) => r.pct >= 30 && r.pct < 70).length} label="Fra 30% e 70%" />
        <Kpi value={light} label="Sotto il 10%" tone={light > 5 ? 'orange' : undefined} />
        <Kpi value={total} label="Gare chiuse" />
      </div>
      <Card title="Minuti giocati su quelli disponibili">
        <Bars rows={rows.map((r) => ({ label: r.p.fullName.split(' ')[0], value: r.pct, color: r.pct >= 70 ? 'var(--red)' : r.pct < 10 ? 'var(--orange)' : 'var(--ink-soft)' }))} max={100} unit="%" />
        <p><small>Rosso: chi gioca quasi sempre. Arancione: chi quasi mai. È il quadro da avere in mente prima dei colloqui.</small></p>
      </Card>
    </>
  );
}

/* ----------------------------- allenamenti ----------------------------- */

function Allenamenti({ players, trainings, attendance }) {
  const past = trainings.filter((t) => toDate(t.date) < new Date());
  const byWeek = {};
  past.forEach((t) => {
    const rows = attendance.filter((a) => a.eventId === t.id);
    if (!rows.length) return;
    const k = isoWeek(toDate(t.date));
    const w = (byWeek[k] ||= { sessions: 0, present: 0, total: 0 });
    w.sessions += 1; w.present += rows.filter((a) => a.status === 'presente').length; w.total += rows.length;
  });
  const weeks = Object.entries(byWeek).sort(([a], [b]) => a.localeCompare(b)).slice(-12);

  const cross = sortPlayers(players).map((p) => {
    const i = playerInsight(p);
    return { p, att: i.attendancePct ?? 0, minutes: p.stats?.minutes || 0 };
  }).filter((r) => r.att || r.minutes).sort((a, b) => b.att - a.att);

  if (!weeks.length) return <Card><Empty title="Nessuna presenza registrata">Le presenze si registrano da Allenamenti.</Empty></Card>;
  return (
    <>
      <Card title="Presenza media per settimana">
        <Bars rows={weeks.map(([k, w]) => ({ label: `Sett. ${k.split('-')[1]}`, value: Math.round((w.present / w.total) * 100) }))} max={100} unit="%" />
        <p><small>Un calo di due settimane di fila, prima delle scuse, è un segnale.</small></p>
      </Card>
      <Card title="Chi si allena e chi gioca">
        <div className="tablewrap">
          <table className="data">
            <thead><tr><th>Giocatore</th><th>Allen.</th><th>Minuti</th><th></th></tr></thead>
            <tbody>
              {cross.map((r) => (
                <tr key={r.p.id}>
                  <td>{r.p.fullName}</td><td>{r.att}%</td><td>{r.minutes}</td>
                  <td>{r.att >= 75 && r.minutes < 90 ? <Badge tone="orange">si allena, non gioca</Badge> : r.att < 50 && r.minutes > 270 ? <Badge tone="purple">gioca, si allena poco</Badge> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p><small>Le due etichette segnalano le situazioni che di solito generano discussioni nello spogliatoio.</small></p>
      </Card>
    </>
  );
}

/* ---------------------------------- gol ---------------------------------- */

function Gol({ matchStats, matches }) {
  const closed = matchStats.filter((m) => m.closed);
  const bands = ['1-15', '16-30', '31-45', '46-60', '61-75', '76-90+'];
  const scored = bands.map(() => 0), conceded = bands.map(() => 0);
  closed.forEach((m) => (m.events || []).forEach((e) => {
    if (e.type !== 'gol' && e.type !== 'gol_subito') return;
    const idx = Math.min(5, Math.max(0, Math.floor((e.minute - 1) / 15)));
    (e.type === 'gol' ? scored : conceded)[idx] += 1;
  }));
  const scorers = {};
  closed.forEach((m) => Object.entries(m.totals || {}).forEach(([pid, s]) => { if (s.goals) scorers[pid] = (scorers[pid] || 0) + s.goals; }));
  const byId = Object.fromEntries(matches.map((m) => [m.id, m]));
  if (!closed.length) return <Card><Empty title="Nessuna gara chiusa">Chiudi le schede gara per vedere quando segniamo e subiamo.</Empty></Card>;
  const max = Math.max(1, ...scored, ...conceded);
  return (
    <>
      <Card title="Gol fatti per fascia di minuti">
        <Bars rows={bands.map((b, i) => ({ label: b, value: scored[i] }))} max={max} tone="var(--green)" />
      </Card>
      <Card title="Gol subiti per fascia di minuti">
        <Bars rows={bands.map((b, i) => ({ label: b, value: conceded[i] }))} max={max} tone="var(--red)" />
        <p><small>Registrali dalla scheda gara con «Gol subito». Se una fascia domina, è lì che si lavora in settimana.</small></p>
      </Card>
    </>
  );
}

/* ------------------------------- disciplina ------------------------------- */

function Disciplina({ players, club }) {
  const rows = sortPlayers(players).map((p) => ({ p, i: playerInsight(p, club.cardsPerSuspension || 4) }))
    .filter((r) => r.i.yellow || r.i.red || r.p.suspended).sort((a, b) => b.i.yellow - a.i.yellow);
  if (!rows.length) return <Card><Empty title="Nessun cartellino" /></Card>;
  return (
    <Card title="Cartellini in stagione">
      <Bars rows={rows.map((r) => ({ label: r.p.fullName.split(' ')[0], value: r.i.yellow, color: r.i.diffidato ? 'var(--orange)' : r.p.suspended ? 'var(--purple)' : 'var(--ink-soft)' }))} />
      <div className="btnrow" style={{ marginTop: 10 }}>
        {rows.filter((r) => r.i.diffidato).map((r) => <Badge key={r.p.id} tone="orange">{r.p.fullName} in diffida</Badge>)}
        {rows.filter((r) => r.p.suspended).map((r) => <Badge key={r.p.id} tone="purple">{r.p.fullName} squalificato</Badge>)}
      </div>
    </Card>
  );
}

/* ---------------------------------- note ---------------------------------- */

function Note({ matchStats, matches }) {
  const byId = Object.fromEntries(matches.map((m) => [m.id, m]));
  const rows = matchStats.filter((m) => m.postNote).map((m) => ({ m, match: byId[m.eventId] }))
    .sort((a, b) => (toDate(b.m.date)?.getTime() || 0) - (toDate(a.m.date)?.getTime() || 0));
  if (!rows.length) return <Card><Empty title="Nessuna nota">Dopo ogni gara, tre righe nella scheda: qui le rileggi in fila.</Empty></Card>;
  return (
    <div className="stack">
      {rows.map(({ m, match }) => (
        <Card key={m.id} title={`${match?.opponent || m.opponent || '—'} · ${fmtDate(m.date)}`}
          action={match?.scoreHome != null ? <Badge tone="grey">{match.scoreHome}-{match.scoreAway}</Badge> : null}>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{m.postNote}</p>
        </Card>
      ))}
    </div>
  );
}


/* --------------------------------- impiego --------------------------------- */

/**
 * Chi non gioca da tempo e perché: infortunio, squalifica o scelta tecnica.
 * Serve al mister per preparare i colloqui, non per giustificarsi.
 */
function Impiego({ players, club }) {
  const rows = sortPlayers(players).map((p) => {
    const i = playerInsight(p, club.cardsPerSuspension || 4);
    const reason = p.injury?.active ? ['Infortunio', 'blue'] : p.suspended ? ['Squalifica', 'purple']
      : i.neverPlayed ? ['Mai impiegato', 'red'] : i.weeksSincePlayed >= 3 ? ['Scelta tecnica', 'orange'] : null;
    return { p, i, reason };
  }).filter((r) => r.reason).sort((a, b) => (b.i.weeksSincePlayed ?? 99) - (a.i.weeksSincePlayed ?? 99));

  if (!rows.length) return <Card><Empty title="Nessuno fermo da tempo">Tutti i giocatori hanno visto il campo nelle ultime tre settimane.</Empty></Card>;
  return (
    <Card title="Fermi da tre settimane o più">
      <div className="plist">
        {rows.map(({ p, i, reason }) => (
          <div key={p.id} className="prow">
            <span className="prow__num">{p.position}</span>
            <span className="prow__body">
              <span className="prow__name">{p.fullName}</span>
              <span className="prow__meta">
                <span>{i.lastPlayed ? `ultima gara ${fmtDate(i.lastPlayed)}` : 'nessuna presenza'}</span>
                <span>{i.attended}/{i.totalTrainings} allen.</span>
                {p.injury?.expectedReturn && <span>rientro {fmtDate(p.injury.expectedReturn)}</span>}
              </span>
            </span>
            <Badge tone={reason[1]}>{reason[0]}</Badge>
          </div>
        ))}
      </div>
      <p><small>«Scelta tecnica» è ciò che resta quando non c'è né infortunio né squalifica: la parte che va spiegata di persona.</small></p>
    </Card>
  );
}
