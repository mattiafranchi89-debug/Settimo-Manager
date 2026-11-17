import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, where, orderBy, limit, audit } from '../lib/db';
import { Card, Button, Select, Badge, Alert, Empty, Loading, Kpi } from '../components/ui';
import LineChart from '../components/LineChart';
import CaricoSheet from '../components/CaricoSheet';
import { can } from '../lib/permissions';
import { fmtShort, capitalize, seasonStart, toDate, dayIso } from '../lib/format';
import { ensureAttendanceSummaries } from '../lib/trainings';
import { registerRows, sessionStats, weekStats, playerWeek, weekRange, loadable, exportSheets } from '../lib/srpe';
import { downloadXlsx } from '../lib/xlsx';
import { errorText } from './Rosa';

const DAY = 86400000;
const num = (v, d = 0) => (v == null ? '–' : v.toLocaleString('it-IT', { maximumFractionDigits: d }));
const pct = (v) => (v == null ? '–' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`);

/**
 * Carico interno (sRPE) della stagione: le sedute da compilare, la settimana
 * (squadra per seduta e giocatori) e l'andamento, come nel foglio del
 * preparatore; e tutto in un file Excel da scaricare.
 */
export default function Carico() {
  const { user } = useAuth();
  const { club } = useClub();
  const canWrite = can(user?.role, 'load.write');
  const canAttend = can(user?.role, 'attendance.write');

  const q = useMemo(() => [where('date', '>=', seasonStart(club.season)), orderBy('date', 'desc'), limit(500)], [club.season]);
  const { data: events, loading } = useCollection('events', q);
  const lq = useMemo(() => [where('date', '>=', seasonStart(club.season))], [club.season]);
  const { data: loads, loading: loadsLoading, error: loadsError } = useCollection('trainingLoad', lq);
  const { data: players } = useCollection('players');
  // Le sedute registrate prima del riepilogo delle presenze lo ricevono una volta sola.
  useEffect(() => {
    if (!canAttend || loading) return;
    ensureAttendanceSummaries(events.filter((e) => e.type === 'training')).catch((e) => console.warn('riepilogo presenze', e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAttend, loading]);

  const sessions = useMemo(() => events.filter((e) => e.type === 'training'), [events]);
  const names = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p.fullName])), [players]);
  const rows = useMemo(() => registerRows({ sessions, loads, names }), [sessions, loads, names]);
  const stats = useMemo(() => sessionStats(rows), [rows]);
  const weeks = useMemo(() => weekStats(rows), [rows]);
  const [pick, setPick] = useState(null);
  const [editing, setEditing] = useState(null);
  const week = weeks.find((w) => w.week === pick) || weeks[weeks.length - 1];
  const first = useMemo(() => sessions.filter((s) => !s.cancelled).map((s) => dayIso(s.date)).filter(Boolean).sort()[0], [sessions]);

  if (loading || loadsLoading) return <Loading />;

  const now = Date.now();
  const recent = (s) => { const t = toDate(s.date)?.getTime(); return t && t <= now && now - t < 14 * DAY; };
  const statOf = new Map(stats.map((s) => [s.eventId, s]));
  // Da fare: le sedute delle ultime due settimane con voti mancanti; e quelle
  // ancora senza presenze, che il preparatore non può compilare.
  const todo = sessions.filter((s) => loadable(s) && recent(s) && (statOf.get(s.id)?.missing ?? 1) > 0);
  const waiting = sessions.filter((s) => s.type === 'training' && !s.cancelled && recent(s) && !loadable(s));

  const download = () => {
    const day = new Date().toISOString().slice(0, 10);
    downloadXlsx(`carico-srpe-${String(club.season || 'stagione').replace(/\W+/g, '-')}-${day}.xlsx`, exportSheets(rows));
    audit(user, 'load.export', 'trainingLoad', { righe: rows.length }).catch(() => {});
  };

  const inWeek = week ? stats.filter((s) => s.week === week.week).sort((a, b) => a.date.localeCompare(b.date)) : [];
  const squad = week ? playerWeek(rows, week.week) : [];
  // L'andamento su tutte le settimane, anche quelle senza dati (restano un vuoto nella linea).
  const span = weeks.length ? Array.from({ length: weeks[weeks.length - 1].week - weeks[0].week + 1 }, (_, i) => weeks[0].week + i) : [];
  const byWeek = new Map(weeks.map((w) => [w.week, w]));

  return (
    <>
      <div className="pagehead">
        <div><h1>Carico</h1><p>sRPE · RPE × minuti di ogni seduta</p></div>
        <div className="btnrow">
          <Button size="sm" variant="secondary" disabled={!rows.length} onClick={download}>⬇ Excel</Button>
        </div>
      </div>

      {loadsError && (
        <Alert level="error">
          Non riesco a leggere il carico ({errorText(loadsError)}). Se è la prima volta, le regole Firestore aggiornate vanno pubblicate.
        </Alert>
      )}

      {canWrite && (
        <Card title="Da compilare" action={todo.length > 0 && <Badge tone="orange">{todo.length}</Badge>}>
          {todo.length ? (
            <div className="plist">
              {todo.map((s) => {
                const st = statOf.get(s.id);
                return (
                  <button key={s.id} className="prow" style={{ width: '100%', textAlign: 'left' }} onClick={() => setEditing(s)}>
                    <span className="prow__num" aria-hidden="true">📈</span>
                    <span className="prow__body">
                      <span className="prow__name">{capitalize(fmtShort(s.date))}</span>
                      <span className="prow__meta"><span>{st ? `${st.votes} voti su ${st.present} presenti` : 'da iniziare'}</span></span>
                    </span>
                    <Badge tone={st?.votes ? 'orange' : 'red'}>{st?.votes ? `mancano ${st.missing}` : 'RPE'}</Badge>
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: 14, color: 'var(--muted)' }}>✅ Nessun voto mancante nelle ultime due settimane</div>
          )}
          {waiting.length > 0 && (
            <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 0 }}>
              In attesa delle presenze del mister: {waiting.map((s) => fmtShort(s.date)).join(', ')}.
            </p>
          )}
        </Card>
      )}

      {!weeks.length ? (
        <Card>
          <Empty title="Ancora nessun dato">
            Il carico si compila per ogni seduta con le presenze registrate: da qui, da Allenamenti o dalla pagina della seduta.
          </Empty>
        </Card>
      ) : (
        <>
          <Card title="Settimana" action={weeks.length > 1 && (
            <Select aria-label="Settimana" value={String(week.week)} onChange={(e) => setPick(Number(e.target.value))}
              style={{ minHeight: 38, padding: '6px 10px', width: 'auto' }}
              options={[...weeks].reverse().map((w) => ({ value: String(w.week), label: `Sett. ${w.week} · ${weekRange(w.monday, w.sunday)}` }))} />
          )}>
            {weeks.length === 1 && <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>Settimana {week.week} · {weekRange(week.monday, week.sunday)}</p>}
            <div className="grid grid--kpi" style={{ marginBottom: 12 }}>
              <Kpi value={num(week.typical)} label="Settimana tipo (somma dei TL medi)" accent />
              <Kpi value={pct(week.change)} label="Rispetto alla settimana prima" />
              <Kpi value={`${week.votes}`} label="Voti RPE" />
              <Kpi value={`${week.missing}`} label="Voti mancanti" tone={week.missing ? 'orange' : undefined} />
            </div>
            <div className="tablewrap">
              <table className="data" style={{ minWidth: 0 }}>
                <thead><tr><th>Seduta</th><th>Pres.</th><th>Voti</th><th>Manc.</th><th>RPE</th><th>TL medio</th></tr></thead>
                <tbody>
                  {inWeek.map((s) => {
                    const ev = sessions.find((x) => x.id === s.eventId);
                    return (
                      <tr key={s.eventId} onClick={canWrite && ev ? () => setEditing(ev) : undefined} style={canWrite ? { cursor: 'pointer' } : undefined}>
                        <td>{capitalize(fmtShort(ev?.date || s.date))}</td>
                        <td>{s.present}</td><td>{s.votes}</td>
                        <td style={s.missing ? { color: 'var(--orange)', fontWeight: 700 } : undefined}>{s.missing}</td>
                        <td>{num(s.rpeAvg, 1)}</td><td>{num(s.tlAvg)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {canWrite && <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 0 }}>Tocca una seduta per aggiungere o correggere i voti.</p>}
          </Card>

          <Card title="Giocatori">
            <div className="tablewrap">
              <table className="data">
                <thead><tr><th>Giocatore</th><th>Sedute</th><th>Manc.</th><th>TL sett.</th><th>TL medio</th><th>Sett. prec.</th><th>Var.</th></tr></thead>
                <tbody>
                  {squad.map((p) => (
                    <tr key={p.playerId}>
                      <td>{p.name}</td><td>{p.sessions}</td>
                      <td style={p.missing ? { color: 'var(--orange)', fontWeight: 700 } : undefined}>{p.missing}</td>
                      <td><b>{num(p.tlWeek)}</b></td><td>{num(p.tlAvg)}</td><td>{num(p.tlPrev)}</td><td>{pct(p.change)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Andamento">
            <LineChart ariaLabel="Carico della settimana tipo, settimana per settimana" xTitle="sett."
              xLabels={span.map((n) => String(n))}
              xTips={span.map((n) => (byWeek.get(n) ? `Settimana ${n} · ${weekRange(byWeek.get(n).monday, byWeek.get(n).sunday)}` : `Settimana ${n}`))}
              series={[{ key: 'typ', label: 'Settimana tipo (somma dei TL medi)', short: 'Tipo', emphasis: true, values: span.map((n) => (byWeek.get(n)?.typical != null ? Math.round(byWeek.get(n).typical) : null)) }]} />
            <div className="tablewrap" style={{ marginTop: 10 }}>
              <table className="data">
                <thead><tr><th>Sett.</th><th>Sedute</th><th>Voti</th><th>Manc.</th><th>TL medio</th><th>Sett. tipo</th><th>Var.</th></tr></thead>
                <tbody>
                  {[...weeks].reverse().map((w) => (
                    <tr key={w.week}>
                      <td>{w.week} <small style={{ color: 'var(--muted)' }}>{weekRange(w.monday, w.sunday)}</small></td>
                      <td>{w.sessions}</td><td>{w.votes}</td><td>{w.missing}</td><td>{num(w.tlAvg)}</td><td><b>{num(w.typical)}</b></td><td>{pct(w.change)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <p style={{ fontSize: 12, color: 'var(--muted)' }}>
            TL = RPE × minuti. Settimana tipo = somma dei TL medi delle sedute della settimana. Contano i presenti segnati dal mister:
            un presente senza RPE è un voto mancante. La settimana 1 è quella della prima seduta in calendario{first ? ` (${fmtShort(first)})` : ''}.
            Il file Excel contiene il registro completo (stesse colonne del foglio del preparatore), sedute, giocatori e andamento.
          </p>
        </>
      )}

      {editing && <CaricoSheet session={sessions.find((s) => s.id === editing.id) || editing} user={user} onClose={() => setEditing(null)} />}
    </>
  );
}
