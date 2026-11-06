import { useMemo } from 'react';
import { Card, Badge, Alert, Empty, Bars } from './ui';
import { Tile, Delta } from './LeagueTrend';
import LineChart from './LineChart';
import { matchWeeks, MIN_GROUP } from '../lib/availability';
import { n1 } from '../lib/trend';
import { fmtShort } from '../lib/format';

const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const pp = (x) => (x == null ? '–' : x.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const r2 = (x) => Math.round(x * 100) / 100;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fewLabel = (k) => (k === 0 ? 'Rosa al completo' : `Fino a ${plural(k, 'indisponibile', 'indisponibili')}`);
const META = { fontSize: 12, color: 'var(--muted)' };
const SUB = { fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 6px' };

/** Barra sottile della presenza in settimana; il trattino scuro è la media della stagione. */
function WeekBar({ value, avg }) {
  return (
    <div style={{ position: 'relative', height: 14, margin: '4px 0 2px' }} aria-hidden="true">
      <div style={{ position: 'absolute', left: 0, right: 0, top: 3, height: 8, borderRadius: 4, background: 'var(--grey-50)', overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${Math.round(value * 100)}%`, background: 'var(--ink-soft)', borderRadius: 4 }} />
      </div>
      {avg != null && (
        <span style={{ position: 'absolute', top: 0, height: 14, width: 2, left: `calc(${(avg * 100).toFixed(1)}% - 1px)`, background: 'var(--ink)', borderRadius: 1, boxShadow: '0 0 0 1px var(--surface)' }} />
      )}
    </div>
  );
}

/**
 * La settimana prima di ogni gara ufficiale contro il risultato: presenza agli
 * allenamenti (anche dei titolari), indisponibili per infortunio e squalifica,
 * diffidati e diffide finite in squalifica, con la tendenza e il confronto dei
 * punti a partita. Solo staff: usa presenze e infortuni.
 */
export default function Availability({ matches = [], trainings = [], sheets = [], players = [], club = {} }) {
  const d = useMemo(() => matchWeeks({ matches, trainings, sheets, players, club }), [matches, trainings, sheets, players, club]);
  const nameOf = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p.fullName])), [players]);
  if (!d.rows.length) {
    return <Card><Empty title="Nessuna gara ufficiale con risultato">La settimana prima di ogni gara si legge appena ci sono i risultati.</Empty></Card>;
  }
  const { all, last, prev, window: w, attendance: a, absences: x } = d;
  const now = w ? last : all;
  const names = (ids) => ids.map((id) => nameOf[id] || '—').join(', ');
  const weeks = d.rows.filter((r) => r.week.pct != null);
  // Titolari: si conoscono solo con la scheda chiusa; dove manca, la linea ha un vuoto.
  const xiValues = weeks.map((r) => (r.week.starters != null ? Math.round(r.week.starters * 100) : null));
  const withXi = xiValues.filter((v) => v != null).length >= 2;
  const pctFmt = (v) => `${Math.round(v)}%`;
  const delta = (k, props = {}) => (w && last[k] != null && prev[k] != null ? <Delta now={last[k] * (props.scale || 1)} before={prev[k] * (props.scale || 1)} {...props} /> : null);

  return (
    <>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 8px' }}>
        La settimana prima di ogni gara ufficiale: {plural(d.rows.length, 'gara', 'gare')}, {weeks.length} con le presenze registrate.
      </p>

      <Alert level="info">
        {all.pct != null
          ? <div>Presenza in settimana: <b>{pct(all.pct)}</b> della rosa disponibile, {n1(all.sessions)} sedute in media{w && last.pct != null ? ` (ultime ${w} gare: ${pct(last.pct)})` : ''}.</div>
          : <div>Nessuna presenza registrata nelle settimane delle gare: si segnano da Allenamenti.</div>}
        {a && <div style={{ marginTop: 4 }}>Con la settimana sopra la media <b>{pp(a.above.ppg)}</b> punti a partita ({a.above.g} gare), sotto la media <b>{pp(a.below.ppg)}</b> ({a.below.g}).</div>}
        {x && <div style={{ marginTop: 4 }}>{fewLabel(x.k)}: <b>{pp(x.few.ppg)}</b> punti a partita ({x.few.g} gare); con {x.k + 1} o più indisponibili <b>{pp(x.many.ppg)}</b> ({x.many.g}).</div>}
        {all.booked > 0 && <div style={{ marginTop: 4 }}>Diffidati ammoniti: <b>{all.booked}</b>, cioè {plural(all.booked, 'squalifica arrivata', 'squalifiche arrivate')} da una diffida.</div>}
        <div style={{ marginTop: 4, color: 'var(--muted)' }}>Su {plural(d.rows.length, 'gara', 'gare')}: segnali da leggere con il campo, non regole.</div>
      </Alert>

      <div className="grid grid--kpi">
        <Tile value={pct(now.pct)} label={w ? `presenza in settimana, ultime ${w}` : 'presenza in settimana'} accent>
          {delta('pct', { scale: 100, threshold: 5, fmt: pctFmt })}
        </Tile>
        <Tile value={pct(now.starters)} label={w ? `presenza dei titolari, ultime ${w}` : 'presenza dei titolari'}>
          {delta('starters', { scale: 100, threshold: 5, fmt: pctFmt })}
        </Tile>
        <Tile value={n1(now.sessions)} label={w ? `sedute a settimana, ultime ${w}` : 'sedute a settimana'}>
          {delta('sessions', { threshold: 0.5 })}
        </Tile>
        <Tile value={n1(now.unexcused)} label={w ? `assenze non giustificate a settimana, ultime ${w}` : 'assenze non giustificate a settimana'}>
          {delta('unexcused', { threshold: 0.5, lowerIsBetter: true })}
        </Tile>
        <Tile value={n1(now.out)} label={w ? `indisponibili a gara, ultime ${w}` : 'indisponibili a gara'}>
          {delta('out', { threshold: 0.5, lowerIsBetter: true })}
        </Tile>
        <Tile value={all.booked} label="diffidati ammoniti (squalifica alla gara dopo)">
          {w ? <span style={{ color: 'var(--muted)' }}>{last.booked} nelle ultime {w}</span> : null}
        </Tile>
      </div>

      {weeks.length >= 2 && (
        <Card title="Presenza in settimana, gara per gara">
          <LineChart
            series={[
              { key: 'all', label: 'Rosa disponibile', short: 'Rosa', values: weeks.map((r) => Math.round(r.week.pct * 100)), emphasis: true },
              ...(withXi ? [{ key: 'xi', label: 'Titolari', short: 'Titolari', values: xiValues }] : [])
            ]}
            xLabels={weeks.map((r) => String(d.rows.indexOf(r) + 1))}
            xTips={weeks.map((r) => `${r.match.opponent} · ${fmtShort(r.match.date)} · ${r.us}-${r.them}`)}
            xTitle="gara" unit="%" ariaLabel="Presenza agli allenamenti nella settimana prima di ogni gara ufficiale"
          />
          <p><small>Infortunati esclusi: sono già fra gli indisponibili. Titolari: chi è partito dall'inizio, nelle sue sedute della settimana; senza scheda chiusa la linea si interrompe.</small></p>
        </Card>
      )}

      <Card title="Punti a partita">
        {a ? (
          <>
            <p style={SUB}>Presenza in settimana (media {pct(a.avg)})</p>
            <Bars rows={[
              { label: `Sopra la media · ${a.above.g} gare`, value: r2(a.above.ppg) },
              { label: `Sotto la media · ${a.below.g} gare`, value: r2(a.below.ppg) }
            ]} max={3} tone="var(--ink-soft)" labelWidth={150} />
          </>
        ) : <p style={SUB}>Presenza: per confrontare servono almeno {MIN_GROUP} gare sopra la media e {MIN_GROUP} sotto.</p>}
        <div style={{ height: 12 }} />
        {x ? (
          <>
            <p style={SUB}>Indisponibili alla gara</p>
            <Bars rows={[
              { label: `${x.k === 0 ? 'Nessuno' : `Fino a ${x.k}`} · ${x.few.g} gare`, value: r2(x.few.ppg) },
              { label: `${x.k + 1} o più · ${x.many.g} gare`, value: r2(x.many.ppg) }
            ]} max={3} tone="var(--ink-soft)" labelWidth={150} />
          </>
        ) : <p style={SUB}>Indisponibili: per confrontare servono almeno {MIN_GROUP} gare con pochi indisponibili e {MIN_GROUP} con di più.</p>}
        <p><small>Punti a partita nelle gare ufficiali, su 3. Con gruppi così piccoli una partita sposta molto: è un indizio da verificare, non una prova.</small></p>
      </Card>

      <Card title="Partita per partita">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 6 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden="true" style={{ width: 12, height: 8, borderRadius: 4, background: 'var(--ink-soft)' }} />presenza in settimana
          </span>
          {all.pct != null && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span aria-hidden="true" style={{ width: 2, height: 12, borderRadius: 1, background: 'var(--ink)' }} />media della stagione ({pct(all.pct)})
            </span>
          )}
        </div>
        <div className="stack" style={{ gap: 12 }}>
          {[...d.rows].reverse().map((r) => {
            const notes = [
              r.suspended.length && `Squalificati: ${names(r.suspended)}`,
              r.injured.length && `Infortunati: ${names(r.injured)}`,
              r.diffidati.length && `Diffidati: ${r.diffidati.map((id) => `${nameOf[id] || '—'}${r.booked.includes(id) ? ' (ammonito)' : ''}`).join(', ')}`,
              r.week.startersLow.length && `Titolari con meno di metà sedute: ${names(r.week.startersLow)}`
            ].filter(Boolean);
            return (
              <div key={r.match.id}>
                <div className="spread" style={{ fontSize: 13.5, gap: 8, alignItems: 'flex-start' }}>
                  <span><b>{r.us}-{r.them}</b> con {r.match.opponent} <span style={{ color: 'var(--muted)' }}>· {fmtShort(r.match.date)}{r.bucket === 'coppa' ? ' · coppa' : ''}</span></span>
                  <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {r.out.length > 0 && <Badge tone={x && r.out.length > x.k ? 'orange' : 'grey'}>{r.out.length} fuori</Badge>}
                    {r.booked.length > 0 && <Badge tone="purple">{r.booked.length === 1 ? '1 diffidato ammonito' : `${r.booked.length} diffidati ammoniti`}</Badge>}
                  </span>
                </div>
                {r.week.pct != null && <WeekBar value={r.week.pct} avg={all.pct} />}
                <div style={META}>
                  {r.week.pct != null ? `Presenza ${pct(r.week.pct)} in ${plural(r.week.sessions, 'seduta', 'sedute')}` : 'Presenze della settimana non registrate'}
                  {r.week.starters != null ? ` · titolari ${pct(r.week.starters)}` : ''}
                  {r.week.unexcused ? ` · ${plural(r.week.unexcused, 'assenza non giustificata', 'assenze non giustificate')}` : ''}
                </div>
                {notes.length > 0 && <div style={META}>{notes.join(' · ')}</div>}
              </div>
            );
          })}
        </div>
        <p><small>
          Infortunati: dalla Rosa e da chi era «infortunato» all'ultima seduta prima della gara. Squalificati e diffidati: dai cartellini
          delle schede chiuse, con le regole della disciplina, e dalle squalifiche confermate dai comunicati. Chi era in distinta conta come disponibile.
        </small></p>
      </Card>

      {d.noWeek.length > 0 && (
        <Card title="Settimane senza presenze">
          <div className="stack" style={{ gap: 4 }}>
            {d.noWeek.map((r) => (
              <div key={r.match.id} style={{ fontSize: 13.5 }}>{r.match.opponent} <span style={{ color: 'var(--muted)' }}>· {fmtShort(r.match.date)}</span></div>
            ))}
          </div>
          <p><small>Nessuna seduta con le presenze fra la gara precedente e questa: si registrano da Allenamenti, anche per le sedute già passate.</small></p>
        </Card>
      )}
    </>
  );
}
