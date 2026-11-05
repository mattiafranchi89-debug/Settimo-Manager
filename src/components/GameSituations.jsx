import { useMemo } from 'react';
import { Card, Badge, Alert, Empty } from './ui';
import { Tile, Delta } from './LeagueTrend';
import { gameSituations, whyNotTimed, ourResult } from '../lib/gameStates';
import { compBucket } from '../lib/discipline';
import { fmtShort } from '../lib/format';

const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const rec = (r) => `${r.v}-${r.n}-${r.p}`;
const COLORS = { lead: 'var(--green)', level: 'var(--line)', trail: 'var(--red)' };
const NAMES = { lead: 'in vantaggio', level: 'in parità', trail: 'sotto' };

/** Barra sottile: minuti in vantaggio, in parità e sotto, nell'ordine; i numeri stanno accanto. */
function StateBar({ min }) {
  const total = min.lead + min.level + min.trail || 1;
  const parts = ['lead', 'level', 'trail'].filter((k) => min[k] > 0);
  return (
    <div style={{ display: 'flex', gap: 2, height: 8, borderRadius: 4, overflow: 'hidden', margin: '6px 0 4px' }} aria-hidden="true">
      {parts.map((k) => <span key={k} style={{ flex: `${min[k] / total} 0 0`, background: COLORS[k] }} />)}
    </div>
  );
}

/**
 * Come vanno le partite dentro i 90': minuti in vantaggio e sotto, chi segna
 * per primo, punti persi da vantaggio e presi da sotto, gol degli ultimi 15',
 * con la tendenza e una barra per ogni gara. Dalle schede gara chiuse.
 */
export default function GameSituations({ matches = [], sheets = [] }) {
  const s = useMemo(() => gameSituations(matches, sheets), [matches, sheets]);
  const sheetOf = useMemo(() => new Map(sheets.map((x) => [x.eventId || x.id, x])), [sheets]);
  const official = s.rows;
  if (!official.length) return <Card><Empty title="Nessuna gara ufficiale con risultato">Le situazioni di gara arrivano con i risultati e le schede chiuse.</Empty></Card>;
  const missing = official.filter((r) => !r.states).map((r) => ({ r, why: whyNotTimed(sheetOf.get(r.match.id), ourResult(r.match)) }));
  const { all, last, prev, window: w } = s;

  return (
    <>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 8px' }}>
        Gare ufficiali ricostruite minuto per minuto: {s.timed.length} su {official.length}. Servono la scheda chiusa e il minuto di ogni gol.
      </p>
      {s.timed.length === 0 ? (
        <Card><Empty title="Nessuna gara ricostruita">Chiudi le schede gara con il minuto di ogni gol, anche di quelli subiti: da lì si vede quando si vince e quando si perde.</Empty></Card>
      ) : (
        <>
          <Alert level="info">
            <div>In vantaggio il <b>{pct(all.pct.lead)}</b> dei minuti, sotto il <b>{pct(all.pct.trail)}</b>{w ? ` (ultime ${w}: ${pct(last.pct.lead)} e ${pct(last.pct.trail)})` : ''}.</div>
            {all.first.g > 0 && <div style={{ marginTop: 4 }}>Quando segniamo per primi: {all.first.v} vittorie su {all.first.g}{all.behindFirst.g ? `; quando segnano loro per primi: ${all.behindFirst.pts} punti su ${all.behindFirst.g * 3}` : ''}.</div>}
            {(all.lostFromAhead > 0 || all.fromBehind > 0) && <div style={{ marginTop: 4 }}>Punti lasciati dopo essere stati in vantaggio: <b>{all.lostFromAhead}</b>; presi dopo essere stati sotto: <b>{all.fromBehind}</b>.</div>}
            <div style={{ marginTop: 4 }}>Negli ultimi 15 minuti: {all.late.for} gol fatti e {all.late.against} subiti.</div>
          </Alert>

          <div className="grid grid--kpi">
            <Tile value={pct(w ? last.pct.lead : all.pct.lead)} label={w ? `minuti in vantaggio, ultime ${w}` : 'minuti in vantaggio'} accent>
              {w ? <Delta now={last.pct.lead * 100} before={prev.pct.lead * 100} threshold={5} fmt={(v) => `${Math.round(v)}%`} /> : null}
            </Tile>
            <Tile value={pct(w ? last.pct.trail : all.pct.trail)} label={w ? `minuti sotto, ultime ${w}` : 'minuti sotto'}>
              {w ? <Delta now={last.pct.trail * 100} before={prev.pct.trail * 100} lowerIsBetter threshold={5} fmt={(v) => `${Math.round(v)}%`} /> : null}
            </Tile>
            <Tile value={rec(all.first)} label="V-N-P quando segniamo per primi" />
            <Tile value={rec(all.behindFirst)} label="V-N-P quando segnano loro per primi" />
            <Tile value={all.lostFromAhead} label="punti persi da vantaggio">
              {w ? <span style={{ color: 'var(--muted)' }}>{last.lostFromAhead} nelle ultime {w}</span> : null}
            </Tile>
            <Tile value={all.fromBehind} label="punti presi da sotto">
              {w ? <span style={{ color: 'var(--muted)' }}>{last.fromBehind} nelle ultime {w}</span> : null}
            </Tile>
          </div>

          <Card title="Partita per partita">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 6 }}>
              {['lead', 'level', 'trail'].map((k) => (
                <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span aria-hidden="true" style={{ width: 12, height: 8, borderRadius: 4, background: COLORS[k] }} />{NAMES[k]}
                </span>
              ))}
            </div>
            <div className="stack" style={{ gap: 10 }}>
              {[...s.timed].reverse().map((r) => (
                <div key={r.match.id}>
                  <div className="spread" style={{ fontSize: 13.5, gap: 8 }}>
                    <span><b>{r.us}-{r.them}</b> con {r.match.opponent} <span style={{ color: 'var(--muted)' }}>· {fmtShort(r.match.date)}{compBucket(r.match.competition || '') === 'coppa' ? ' · coppa' : ''}</span></span>
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      {r.states.wasAhead && r.pts < 3 && <Badge tone="red">−{3 - r.pts} da vantaggio</Badge>}
                      {r.states.wasBehind && r.pts > 0 && <Badge tone="green">+{r.pts} da sotto</Badge>}
                    </span>
                  </div>
                  <StateBar min={r.states.min} />
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {Math.round(r.states.min.lead)}' in vantaggio · {Math.round(r.states.min.level)}' in parità · {Math.round(r.states.min.trail)}' sotto
                    {r.states.first ? ` · primo gol ${r.states.first === 'us' ? 'nostro' : 'loro'}` : ' · nessun gol'}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {missing.length > 0 && (
        <Card title="Gare da completare">
          <div className="stack" style={{ gap: 4 }}>
            {missing.map(({ r, why }) => (
              <div key={r.match.id} style={{ fontSize: 13.5 }}>
                {r.match.opponent} <span style={{ color: 'var(--muted)' }}>· {fmtShort(r.match.date)} · {why}</span>
              </div>
            ))}
          </div>
          <p><small>Si completano dalla scheda gara: minuto di ogni gol (anche subito) e chiusura della partita.</small></p>
        </Card>
      )}
    </>
  );
}
