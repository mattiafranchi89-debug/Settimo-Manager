import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, where, orderBy, limit } from '../lib/db';
import { buildInsights } from '../lib/insights';
import { suspendedIn } from '../lib/discipline';
import { useGirone } from '../lib/crl';
import { gironeRow } from '../lib/scouting';
import { ensureAttendanceSummaries } from '../lib/trainings';
import { PERIODS, periodStart, teamTrend, trainingReport, minutesReport, injuryReport, performanceReport } from '../lib/teamReport';
import { Card, Kpi, Badge, Empty, Loading, Bars, Button, useToast } from '../components/ui';
import { fmtDate, fmtShort, seasonStart } from '../lib/format';
import { can } from '../lib/permissions';

/**
 * Report da mostrare alla squadra (in spogliatoio, stampato o in PDF nel
 * gruppo): andamento, presenze agli allenamenti, minuti giocati, infermeria
 * e disciplina. Legge gli stessi dati di Analisi, nessuna scrittura.
 */
const one = (x) => (x == null ? '—' : x.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const tone = (pct) => (pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--orange)' : 'var(--red)');
const num = (x) => (x == null ? 0 : Math.round(x * 100) / 100);
const dm = (d) => d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });

export default function Report() {
  const { user } = useAuth();
  const { club } = useClub();
  const toast = useToast();
  const staff = can(user?.role, 'attendance.write') || can(user?.role, 'matchstats.write');
  const medical = can(user?.role, 'medical.read');
  const [period, setPeriod] = useState('stagione');
  const [showType, setShowType] = useState(false);
  const [now] = useState(() => new Date());

  const season = club.season;
  const from = useMemo(() => periodStart(period, seasonStart(season), now), [period, season, now]);
  const { data: playersAll, loading } = useCollection('players', useMemo(() => [where('active', '==', true)], []));
  const { data: seasonEvents, loading: loadingEvents } = useCollection('events', useMemo(() => [where('date', '>=', seasonStart(season)), orderBy('date', 'desc'), limit(500)], [season]), staff);
  const { data: matchStats } = useCollection('matchStats', useMemo(() => [where('date', '>=', seasonStart(season))], [season]), staff);
  const { data: girone } = useGirone();

  const events = useMemo(() => seasonEvents.filter((e) => !e.seasonId || e.seasonId === season), [seasonEvents, season]);
  const trainings = useMemo(() => events.filter((e) => e.type === 'training'), [events]);
  const matches = useMemo(() => events.filter((e) => e.type === 'match'), [events]);
  // Sedute registrate prima del riepilogo: lo calcola una volta e lo salva (come Analisi).
  useEffect(() => {
    if (!can(user?.role, 'attendance.write') || !trainings.length) return;
    ensureAttendanceSummaries(trainings).catch((e) => console.warn('riepilogo presenze', e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainings.length > 0]);

  const players = playersAll;
  const trend = useMemo(() => teamTrend(matches, from, now), [matches, from, now]);
  const att = useMemo(() => trainingReport(trainings, players, from, now), [trainings, players, from, now]);
  const mins = useMemo(() => minutesReport(matchStats, players, from, now), [matchStats, players, from, now]);
  const injured = useMemo(() => injuryReport(players, now), [players, now]);
  const insights = useMemo(() => buildInsights({ players, club }), [players, club]);
  const standing = useMemo(() => gironeRow(girone, club.clubName), [girone, club.clubName]);
  const perf = useMemo(() => performanceReport({ trend, matchStats, girone, clubName: club.clubName, withStanding: period === 'stagione' }),
    [trend, matchStats, girone, club.clubName, period]);
  const discipline = useMemo(() => players.map((p) => {
    const i = insights[p.id];
    return { p, diffida: i?.diffidaIn || [], squal: [...new Set([...suspendedIn(p), ...(i?.autoSuspendedIn || [])])] };
  }).filter((r) => r.diffida.length || r.squal.length), [players, insights]);

  if (loading || (staff && loadingEvents)) return <Loading />;
  if (!staff) return <Card><Empty title="Solo per lo staff tecnico">Il report usa presenze e schede gara.</Empty></Card>;

  const periodText = period === 'mese' ? `dal ${fmtDate(from)} al ${fmtDate(now)}` : `stagione ${season}`;
  const comps = (list) => list.map((k) => (k === 'coppa' ? 'coppa' : 'campionato')).join(' e ');

  const share = async () => {
    const lines = [`📄 *REPORT SQUADRA* · ${club.clubName}`, `_${periodText[0].toUpperCase()}${periodText.slice(1)}_`];
    if (trend.played) {
      lines.push('', '*📈 Andamento*', `${trend.played} gare · ${trend.v}V ${trend.n}N ${trend.p}P · ${trend.pts} punti (${one(trend.ppg)} a gara)`, `Gol ${trend.gf}-${trend.gs} · ultime: ${trend.last5.map((r) => r.outcome).join(' ')}`);
      if (standing && period === 'stagione') lines.push(`Classifica: ${standing.pos}° con ${standing.pts} punti`);
    }
    if (att.sessions) {
      lines.push('', '*🏃 Allenamenti*', `${att.sessions} sedute · presenza media ${att.avgPct}%`);
      if (att.always.length) lines.push(`Sempre presenti: ${att.always.map((r) => r.name).join(', ')}`);
    }
    if (mins.matches) {
      lines.push('', '*⏱️ Minuti*', `${mins.used} giocatori impiegati in ${mins.matches} gare`);
      lines.push(...mins.rows.filter((r) => r.minutes).slice(0, 5).map((r) => `• ${r.name} ${r.minutes}′`));
      if (mins.scorers.length) lines.push(`Marcatori: ${mins.scorers.map((r) => `${r.name} ${r.goals}`).join(', ')}`);
    }
    if (trend.played) {
      const st = perf.streaks;
      lines.push('', '*📊 Performance*');
      if (st.unbeaten > 1) lines.push(`${st.unbeaten} risultati utili consecutivi`);
      if (perf.situations.timed) lines.push(`Quando segniamo per primi: ${perf.situations.first.v}V ${perf.situations.first.n}N ${perf.situations.first.p}P`);
      if (perf.league) lines.push(`Attacco ${perf.league.attackRank}° e difesa ${perf.league.defenseRank}° del girone`);
      lines.push(...readings(perf, trend).slice(0, 3).map((t) => `• ${t}`));
    }
    lines.push('', '*🏥 Infermeria*', ...(injured.length ? injured.map((r) => `• ${r.name}${r.expectedReturn ? ` · rientro ${fmtShort(r.expectedReturn)}` : ''}`) : ['Nessun infortunato']));
    if (discipline.length) lines.push('', '*🟨 Disciplina*', ...discipline.map((r) => `• ${r.p.fullName}: ${r.squal.length ? `squalificato (${comps(r.squal)})` : `in diffida (${comps(r.diffida)})`}`));
    const text = lines.join('\n');
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Riepilogo copiato: incollalo su WhatsApp'); }
    } catch (e) {
      if (e?.name !== 'AbortError') toast('Condivisione non riuscita', 'error');
    }
  };

  return (
    <div className="report">
      <div className="pagehead noprint">
        <div><h1>Report squadra</h1><p>Da proiettare in spogliatoio, stampare o salvare in PDF per il gruppo</p></div>
        <Button as={Link} to="/analisi" size="sm" variant="ghost">← Analisi</Button>
      </div>
      <div className="chiprow noprint">
        {Object.entries(PERIODS).map(([k, v]) => (
          <button key={k} className={`chip ${period === k ? 'chip--on' : ''}`} onClick={() => setPeriod(k)}>{v.label}</button>
        ))}
      </div>
      <div className="btnrow noprint" style={{ marginBottom: 12 }}>
        <Button onClick={() => window.print()}>🖨️ Stampa o salva PDF</Button>
        <Button variant="secondary" onClick={share}>📤 Condividi riepilogo</Button>
        {medical && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
            <input type="checkbox" checked={showType} onChange={(e) => setShowType(e.target.checked)} />
            Mostra il tipo di infortunio
          </label>
        )}
      </div>

      <header className="report__head">
        {club.logoUrl && <img src={club.logoUrl} alt="" />}
        <div>
          <h1>{club.clubName} · Report squadra</h1>
          <p>{club.teamName} · {periodText} · aggiornato il {fmtDate(now)}</p>
        </div>
      </header>

      {/* ------------------------------ andamento ------------------------------ */}
      <Card title="📈 Andamento">
        {!trend.played ? <Empty title="Nessun risultato nel periodo" /> : (
          <>
            <div className="grid grid--kpi">
              <Kpi value={trend.pts} label={`Punti in ${trend.played} gare`} accent />
              <Kpi value={`${trend.v}-${trend.n}-${trend.p}`} label="Vinte · pari · perse" />
              <Kpi value={`${trend.gf}-${trend.gs}`} label="Gol fatti e subiti" />
              <Kpi value={one(trend.ppg)} label="Punti a partita" />
            </div>
            {standing && period === 'stagione' && (
              <p style={{ margin: '10px 0 0' }}>
                <b>Classifica:</b> {standing.pos}° posto con {standing.pts} punti in {standing.g} gare
                <small style={{ color: 'var(--muted)' }}> · {girone?.standing?.asOf}</small>
              </p>
            )}
            <div className="btnrow" style={{ marginTop: 10 }}>
              {trend.last5.map((r) => (
                <Badge key={r.id} tone={r.pts === 3 ? 'green' : r.pts === 1 ? 'orange' : 'red'}>
                  {r.outcome} {r.us}-{r.them} {r.opponent}{r.home ? '' : ' (T)'}
                </Badge>
              ))}
            </div>
            <div className="report__two" style={{ marginTop: 12 }}>
              <div>
                <h3>Casa e trasferta</h3>
                <Bars rows={[
                  { label: `Casa (${trend.home.played})`, value: num(trend.home.ppg) },
                  { label: `Trasferta (${trend.away.played})`, value: num(trend.away.ppg) }
                ]} max={3} unit=" pt" />
              </div>
              {trend.halves && (
                <div>
                  <h3>Come stiamo cambiando</h3>
                  <Bars rows={[
                    { label: `Prime ${trend.halves.n1}`, value: num(trend.halves.first) },
                    { label: `Ultime ${trend.halves.n2}`, value: num(trend.halves.second), color: trend.halves.second >= trend.halves.first ? 'var(--green)' : 'var(--orange)' }
                  ]} max={3} unit=" pt" />
                </div>
              )}
            </div>
            <p><small>{trend.cleanSheets} {trend.cleanSheets === 1 ? 'gara' : 'gare'} senza subire gol. Media punti per gara: 3 è il massimo.</small></p>
          </>
        )}
      </Card>

      {/* ------------------------------ allenamenti ------------------------------ */}
      <Card title="🏃 Presenze agli allenamenti">
        {!att.sessions ? <Empty title="Nessuna presenza registrata nel periodo" /> : (
          <>
            <div className="grid grid--kpi">
              <Kpi value={att.sessions} label="Sedute registrate" accent />
              <Kpi value={`${att.avgPct}%`} label="Presenza media" tone={att.avgPct < 60 ? 'red' : undefined} />
              <Kpi value={att.avgPresent} label="Presenti in media" />
              <Kpi value={att.always.length} label="Sempre presenti" />
            </div>
            {att.weeks.length > 1 && (
              <>
                <h3>Settimana per settimana</h3>
                <Bars rows={att.weeks.slice(-10).map((w) => ({ label: `sett. ${dm(new Date(`${w.week}T12:00:00`))}`, value: w.pct, color: tone(w.pct) }))} max={100} unit="%" />
              </>
            )}
            <h3>Giocatore per giocatore</h3>
            <Bars rows={att.rows.map((r) => ({ label: `${r.name} (${r.present}/${r.total})`, value: r.pct, color: tone(r.pct) }))} max={100} unit="%" labelWidth={170} />
            <p><small>Percentuale sulle sedute da quando ognuno è in rosa. Verde dall'80%, arancione dal 60%.</small></p>
          </>
        )}
      </Card>

      {/* -------------------------------- minuti -------------------------------- */}
      <Card title="⏱️ Minuti giocati">
        {!mins.matches ? <Empty title="Nessuna scheda gara chiusa nel periodo" /> : (
          <>
            <div className="grid grid--kpi">
              <Kpi value={mins.matches} label="Gare con scheda chiusa" accent />
              <Kpi value={mins.used} label="Giocatori impiegati" />
              <Kpi value={mins.scorers[0]?.goals ?? '—'} label={mins.scorers[0] ? `Gol di ${mins.scorers[0].name}` : 'Miglior marcatore'} />
              <Kpi value={mins.assistmen[0]?.assists ?? '—'} label={mins.assistmen[0] ? `Assist di ${mins.assistmen[0].name}` : 'Più assist'} />
            </div>
            <div className="tablewrap" style={{ marginTop: 10 }}>
              <table className="data report__table">
                <thead><tr><th>Giocatore</th><th title="Gare giocate (da titolare)">Gare</th><th>Minuti</th></tr></thead>
                <tbody>
                  {mins.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name}{r.goals ? ` ⚽${r.goals > 1 ? `×${r.goals}` : ''}` : ''}{r.assists ? ` 🎯${r.assists > 1 ? `×${r.assists}` : ''}` : ''}</td>
                      <td>{r.apps}{r.starts ? ` (${r.starts})` : ''}</td>
                      <td>
                        {r.minutes}′ <small style={{ color: 'var(--muted)' }}>{r.pct}%</small>
                        <span className="report__bar"><span style={{ width: `${Math.min(100, r.pct)}%` }} /></span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p><small>⚽ gol, 🎯 assist. Gare giocate (da titolare tra parentesi). % sui {mins.available} minuti disponibili nelle gare chiuse del periodo.</small></p>
          </>
        )}
      </Card>

      {/* ------------------------------ infermeria ------------------------------ */}
      <Card title="🏥 Infermeria">
        {!injured.length ? <p style={{ margin: 0 }}>Nessun infortunato: tutti a disposizione.</p> : (
          <div className="plist">
            {injured.map((r) => (
              <div key={r.id} className="prow">
                <span className="prow__body">
                  <span className="prow__name">{r.name}</span>
                  <span className="prow__meta">
                    {showType && medical && r.type && <span>{r.type}</span>}
                    {r.since && <span>fermo dal {fmtShort(r.since)}{r.days ? ` (${r.days} gg)` : ''}</span>}
                  </span>
                </span>
                <Badge tone={r.overdue ? 'orange' : 'blue'}>{r.expectedReturn ? `${r.overdue ? 'rientro previsto era il' : 'rientro'} ${fmtShort(r.expectedReturn)}` : 'rientro da definire'}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ------------------------------ disciplina ------------------------------ */}
      {discipline.length > 0 && (
        <Card title="🟨 Disciplina">
          <div className="btnrow">
            {discipline.map((r) => (
              <Badge key={r.p.id} tone={r.squal.length ? 'purple' : 'orange'}>
                {r.p.fullName} · {r.squal.length ? `squalificato (${comps(r.squal)})` : `in diffida (${comps(r.diffida)})`}
              </Badge>
            ))}
          </div>
          <p><small>Situazione di oggi, qualunque sia il periodo scelto.</small></p>
        </Card>
      )}

      {trend.played > 0 && <Performance perf={perf} trend={trend} players={players} />}

      <p className="report__foot">{club.clubName} · {club.season} · dati dell'app al {fmtDate(now)}</p>
    </div>
  );
}

/* ------------------------------ performance ------------------------------ */

const rec = (r) => `${r.v}V ${r.n}N ${r.p}P`;
const avg = (x) => (x == null ? '—' : x.toLocaleString('it-IT', { maximumFractionDigits: 1, minimumFractionDigits: 1 }));
const share = (a, b) => (a + b ? Math.round((a / (a + b)) * 100) : 0);

/** Frasi di lettura automatiche: solo quelle che i numeri sostengono. */
function readings(perf, trend) {
  const out = [];
  const { situations: s, halves, lateGoals, goals, sheet, league, streaks } = perf;
  if (streaks.unbeaten >= 3) out.push(`Siamo imbattuti da ${streaks.unbeaten} gare: la continuità è il primo obiettivo.`);
  if (streaks.noWin >= 3) out.push(`Non vinciamo da ${streaks.noWin} gare: serve ritrovare la vittoria subito.`);
  const sg = halves.scored, cg = halves.conceded;
  if (sg[0] + sg[1] >= 4 && share(sg[1], sg[0]) >= 65) out.push(`Il ${share(sg[1], sg[0])}% dei nostri gol arriva nel secondo tempo: cresciamo alla distanza.`);
  if (sg[0] + sg[1] >= 4 && share(sg[0], sg[1]) >= 65) out.push(`Il ${share(sg[0], sg[1])}% dei nostri gol arriva nel primo tempo: partiamo forte, poi caliamo.`);
  if (cg[0] + cg[1] >= 4 && share(cg[1], cg[0]) >= 65) out.push(`Il ${share(cg[1], cg[0])}% dei gol subiti arriva nel secondo tempo: attenzione a concentrazione e condizione.`);
  if (lateGoals.against >= 2 && lateGoals.against > lateGoals.for) out.push(`${lateGoals.against} gol subiti negli ultimi 15 minuti: chiudere le partite è un tema.`);
  if (lateGoals.for >= 2 && lateGoals.for > lateGoals.against) out.push(`${lateGoals.for} gol segnati negli ultimi 15 minuti: non molliamo mai.`);
  if (s.pointsLostFromAhead >= 3) out.push(`${s.pointsLostFromAhead} punti persi dopo essere stati in vantaggio.`);
  if (s.pointsFromBehind >= 3) out.push(`${s.pointsFromBehind} punti conquistati dopo essere andati sotto: carattere.`);
  if (s.first.played >= 3 && s.first.p === 0) out.push(`Quando segniamo per primi non perdiamo mai (${rec(s.first)}).`);
  if (goals.failedToScore >= 2 && goals.failedToScore >= trend.played / 3) out.push(`In ${goals.failedToScore} gare su ${trend.played} non abbiamo segnato.`);
  if (sheet.benchGoals >= 2) out.push(`${sheet.benchGoals} gol da chi è entrato dalla panchina: tutta la rosa conta.`);
  if (sheet.scorers >= 6) out.push(`${sheet.scorers} giocatori diversi a segno: gol da tutta la squadra.`);
  if (league && league.defenseRank === 1) out.push('Miglior difesa del girone.');
  if (league && league.attackRank === 1) out.push('Miglior attacco del girone.');
  if (league && league.top.played >= 2 && league.bottom.played >= 2 && (league.top.ppg ?? 0) + 0.5 < (league.bottom.ppg ?? 0)) out.push(`Con le squadre della parte alta facciamo ${avg(league.top.ppg)} punti a gara contro ${avg(league.bottom.ppg)} con quelle della parte bassa.`);
  if (sheet.cardsPerGame >= 3) out.push(`${avg(sheet.cardsPerGame)} cartellini a partita: troppe ammonizioni evitabili.`);
  return out;
}

function Fact({ value, label }) {
  return <div className="report__fact"><b>{value}</b><span>{label}</span></div>;
}

function Performance({ perf, trend, players }) {
  const name = Object.fromEntries(players.map((p) => [p.id, p.fullName]));
  const { byComp, streaks, goals, situations, league, sheet } = perf;
  const maxBand = Math.max(1, ...perf.bands.map((b) => Math.max(b.scored, b.conceded)));
  const lines = readings(perf, trend);
  return (
    <Card title="📊 Performance della squadra">
      {lines.length > 0 && (
        <>
          <h3>In sintesi</h3>
          <ul className="report__list">{lines.map((t) => <li key={t}>{t}</li>)}</ul>
        </>
      )}

      <h3>Campionato e coppa</h3>
      <div className="tablewrap">
        <table className="data report__table">
          <thead><tr><th></th><th>V-N-P</th><th>Pt</th><th>Gol</th><th>Pt/g</th></tr></thead>
          <tbody>
            {[['Campionato', byComp.campionato], ['Coppa', byComp.coppa]].filter(([, r]) => r.played).map(([l, r]) => (
              <tr key={l}><td>{l} ({r.played})</td><td>{r.v}-{r.n}-{r.p}</td><td>{r.pts}</td><td>{r.gf}-{r.gs}</td><td>{avg(r.ppg)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Strisce e record</h3>
      <div className="report__facts">
        <Fact value={streaks.unbeaten} label="risultati utili di fila (in corso)" />
        <Fact value={streaks.bestWins} label="vittorie consecutive, la serie più lunga" />
        <Fact value={streaks.scoring} label="gare di fila a segno (in corso)" />
        <Fact value={streaks.cleanSheets} label="gare di fila senza subire (in corso)" />
        {perf.biggestWin && <Fact value={`${perf.biggestWin.us}-${perf.biggestWin.them}`} label={`miglior vittoria, ${perf.biggestWin.opponent}`} />}
        {perf.worstLoss && <Fact value={`${perf.worstLoss.us}-${perf.worstLoss.them}`} label={`sconfitta più netta, ${perf.worstLoss.opponent}`} />}
      </div>

      <h3>Gol</h3>
      <div className="report__facts">
        <Fact value={avg(goals.perGame)} label="gol fatti a partita" />
        <Fact value={avg(goals.againstPerGame)} label="gol subiti a partita" />
        <Fact value={goals.cleanSheets} label="gare senza subire gol" />
        <Fact value={goals.failedToScore} label="gare senza segnare" />
        <Fact value={goals.bigWins} label="vittorie con 2+ gol di scarto" />
        <Fact value={goals.oneGoalGames} label="gare decise di un gol" />
      </div>

      {situations.timed > 0 && (
        <>
          <h3>Quando segniamo e quando subiamo</h3>
          <div className="report__bands">
            <span /><small>fatti</small><small>subiti</small>
            {perf.bands.map((b) => (
              <div key={b.label} style={{ display: 'contents' }}>
                <span>{b.label}′</span>
                <span className="report__band report__band--for"><span style={{ width: `${(b.scored / maxBand) * 100}%` }} /><em>{b.scored || ''}</em></span>
                <span className="report__band report__band--against"><span style={{ width: `${(b.conceded / maxBand) * 100}%` }} /><em>{b.conceded || ''}</em></span>
              </div>
            ))}
          </div>
          <p><small>
            Primo tempo {perf.halves.scored[0]}-{perf.halves.conceded[0]} · secondo tempo {perf.halves.scored[1]}-{perf.halves.conceded[1]} ·
            ultimi 15 minuti {perf.lateGoals.for}-{perf.lateGoals.against}. Su {situations.timed} {situations.timed === 1 ? 'gara' : 'gare'} con i minuti dei gol completi.
          </small></p>

          <h3>Situazioni di gara</h3>
          <div className="report__facts">
            <Fact value={situations.first.played ? rec(situations.first) : '—'} label={`quando segniamo per primi (${situations.first.played})`} />
            <Fact value={situations.behind.played ? rec(situations.behind) : '—'} label={`quando segnano loro per primi (${situations.behind.played})`} />
            <Fact value={situations.pointsFromBehind} label="punti recuperati da sotto" />
            <Fact value={situations.pointsLostFromAhead} label="punti persi da avanti" />
          </div>
        </>
      )}

      {league && (
        <>
          <h3>Nel girone</h3>
          <div className="report__facts">
            <Fact value={`${league.pos}°`} label={`su ${league.of}, ${league.pts} punti`} />
            <Fact value={league.leader ? 'vetta' : league.leaderGap ? `-${league.leaderGap}` : '='} label={league.leader ? 'siamo primi' : league.leaderGap ? 'punti dalla capolista' : 'a pari punti con la capolista'} />
            {league.gapBelow != null && <Fact value={`+${league.gapBelow}`} label="punti su chi ci segue" />}
            <Fact value={`${league.attackRank}°`} label="attacco del girone" />
            <Fact value={`${league.defenseRank}°`} label="difesa del girone" />
            {league.top.played > 0 && <Fact value={rec(league.top)} label={`con le prime ${league.topHalf} (${avg(league.top.ppg)} pt/g)`} />}
            {league.bottom.played > 0 && <Fact value={rec(league.bottom)} label={`con le altre (${avg(league.bottom.ppg)} pt/g)`} />}
          </div>
          <p><small>Classifica: {league.asOf}.</small></p>
        </>
      )}

      {perf.progression.length > 1 && (
        <>
          <h3>Punti giornata per giornata</h3>
          <div className="report__prog">
            {perf.progression.map((r, k) => (
              <span key={r.id} className={`report__step report__step--${r.outcome}`} title={`${r.opponent} ${r.us}-${r.them}`}>
                <small>{k + 1}ª</small><b>{r.outcome}</b><small>{r.cum} pt</small>
              </span>
            ))}
          </div>
        </>
      )}

      {sheet.matches > 0 && (
        <>
          <h3>La rosa in campo</h3>
          <div className="report__facts">
            <Fact value={sheet.scorers} label="giocatori diversi a segno" />
            <Fact value={sheet.benchGoals} label="gol di chi è entrato dalla panchina" />
            <Fact value={sheet.startersUsed} label="titolari diversi schierati" />
            <Fact value={`${sheet.yellows} 🟨 ${sheet.reds} 🟥`} label={`cartellini (${avg(sheet.cardsPerGame)} a gara)`} />
          </div>
          {sheet.mvp.length > 0 && <p><small>MVP più votati: {sheet.mvp.map(([pid, n]) => `${name[pid] || '—'} (${n})`).join(', ')}.</small></p>}
          <p><small>Dalle {sheet.matches} schede gara chiuse del periodo.</small></p>
        </>
      )}
    </Card>
  );
}
