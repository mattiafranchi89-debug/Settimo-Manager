import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, where, orderBy, limit } from '../lib/db';
import { buildInsights } from '../lib/insights';
import { suspendedIn } from '../lib/discipline';
import { useGirone } from '../lib/crl';
import { gironeRow } from '../lib/scouting';
import { ensureAttendanceSummaries } from '../lib/trainings';
import { PERIODS, periodStart, teamTrend, trainingReport, minutesReport, injuryReport } from '../lib/teamReport';
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

      <p className="report__foot">{club.clubName} · {club.season} · dati dell'app al {fmtDate(now)}</p>
    </div>
  );
}
