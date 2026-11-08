import { useMemo, useState } from 'react';
import { Card, Badge, Alert, Empty, Loading, Button, useToast } from './ui';
import LineChart from './LineChart';
import { useGirone } from '../lib/crl';
import { leagueDashboard, reading, opponentOutlook, teamLabel, n1 } from '../lib/trend';
import { resultChecks, applyOfficialResult, appScore } from '../lib/results';
import { compBucket } from '../lib/discipline';
import { toDate, fmtShort } from '../lib/format';

/** Meglio, peggio o stabile: sotto la soglia (un quarto di punto o di gol, o punti percentuali) la differenza non conta. */
export function Delta({ now, before, lowerIsBetter = false, fmt = n1, threshold = 0.25 }) {
  if (now == null || before == null) return null;
  const diff = now - before;
  if (Math.abs(diff) < threshold) return <Badge tone="grey">= stabile · prima {fmt(before)}</Badge>;
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  return <Badge tone={better ? 'green' : 'red'}>{better ? '▲ meglio' : '▼ peggio'} · prima {fmt(before)}</Badge>;
}

export function Tile({ value, label, children, accent = false }) {
  return (
    <div className={`kpi ${accent ? 'kpi--accent' : ''}`}>
      <div className="kpi__value">{value}</div>
      <div className="kpi__label">{label}</div>
      {children && <div style={{ marginTop: 6, fontSize: 12 }}>{children}</div>}
    </div>
  );
}

const Seq = ({ seq = '' }) => (
  <span style={{ display: 'inline-flex', gap: 2, verticalAlign: 'middle' }}>
    {seq.split('').map((r, i) => (
      <span key={i} aria-label={r === 'V' ? 'vittoria' : r === 'N' ? 'pareggio' : 'sconfitta'}
        style={{ width: 16, height: 16, borderRadius: 4, display: 'inline-grid', placeItems: 'center', fontSize: 10.5, fontWeight: 700, color: '#fff',
          background: r === 'V' ? 'var(--green)' : r === 'N' ? 'var(--grey)' : 'var(--red)' }}>{r}</span>
    ))}
  </span>
);

const LEVEL = { alta: 'red', media: 'orange', bassa: 'green' };

/**
 * Andamento rispetto al campionato: sei numeri con la tendenza, la lettura in
 * poche frasi, la corsa al vertice, la forma del girone, contro chi facciamo
 * punti, il calendario. Tutto dai comunicati CRL (girone.json).
 */
export default function LeagueTrend({ club, matches = [], user, canFix = false }) {
  const toast = useToast();
  const { data: girone, loading } = useGirone();
  const d = useMemo(() => leagueDashboard(girone, club.clubName), [girone, club.clubName]);
  const checks = useMemo(() => (girone ? resultChecks(girone, matches, club.clubName) : []), [girone, matches, club.clubName]);
  const [fixing, setFixing] = useState(null);

  if (loading) return <Loading />;
  // A luglio il file è ancora quello della stagione passata: non si mescola.
  if (girone?.season && club.season && girone.season !== club.season) {
    return <Card><Empty title="Nuova stagione">La classifica {club.season} arriva con i primi comunicati CRL del campionato.</Empty></Card>;
  }
  if (!d) {
    return (
      <Card>
        <Empty title="Classifica non disponibile">
          Il girone arriva dai comunicati CRL. Se manca la nostra squadra, controlla in Impostazioni che il nome della società sia quello della classifica (es. «Settimo Milanese»).
        </Empty>
      </Card>
    );
  }
  if (d.empty) return <Card><Empty title="Campionato non ancora iniziato">I numeri arrivano dopo la prima giornata, dal comunicato CRL con i risultati.</Empty></Card>;

  const { ft, me, race, projection, pace, splits, schedule, league } = d;
  const label = teamLabel;
  const rival = label(race.rival || '');
  const w = ft.window;
  const next = matches
    .filter((m) => compBucket(m.competition || '') === 'campionato' && toDate(m.date) > new Date())
    .sort((a, b) => toDate(a.date) - toDate(b.date)).slice(0, 3)
    .map((m) => ({ m, o: opponentOutlook(league, m.opponent) }));
  const ours = schedule[0];
  const fix = async (c) => {
    setFixing(c.match.id);
    try {
      await applyOfficialResult(user, c.match, c.off);
      toast(`Risultato ufficiale inserito: ${c.off.us}-${c.off.them} con ${c.match.opponent}`);
    } catch (e) { toast(`Non salvato: ${e.message || e}`, 'error'); }
    setFixing(null);
  };

  return (
    <>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 8px' }}>
        Prima Categoria girone A · {girone.standing?.provisional ? 'dati provvisori in attesa del comunicato' : 'dati ufficiali CRL'}, {league.asOf} · {ft.n} giornate su {league.total}
      </p>

      <Alert level="info">
        {reading(d).map((t, i) => <div key={i} style={{ marginTop: i ? 4 : 0 }}>{t}</div>)}
      </Alert>

      <div className="grid grid--kpi">
        <Tile value={`${me.pos}°`} label={me.pos === 1 ? `+${d.gapNow} sulla ${label(d.nearest.team)}` : `${-d.gapNow} dalla vetta`} accent>
          {d.gapBefore != null && <Delta now={d.gapNow} before={d.gapBefore} fmt={(v) => `${v > 0 ? '+' : ''}${v}`} />}
        </Tile>
        <Tile value={n1(w ? ft.last.ppg : ft.all.ppg)} label={w ? `punti a partita, ultime ${w}` : 'punti a partita'}>
          {w ? <Delta now={ft.last.ppg} before={ft.prev.ppg} /> : null}
        </Tile>
        <Tile value={n1(w ? ft.last.gf : ft.all.gf)} label={w ? `gol fatti a partita, ultime ${w}` : 'gol fatti a partita'}>
          {w ? <Delta now={ft.last.gf} before={ft.prev.gf} /> : null}
        </Tile>
        <Tile value={n1(w ? ft.last.ga : ft.all.ga)} label={w ? `gol subiti a partita, ultime ${w}` : 'gol subiti a partita'}>
          {w ? <Delta now={ft.last.ga} before={ft.prev.ga} lowerIsBetter /> : null}
        </Tile>
        <Tile value={Math.round(projection.final)} label="punti a fine stagione, al ritmo attuale">
          {d.projectionRecent != null && <span style={{ color: 'var(--muted)' }}>{Math.round(d.projectionRecent)} al ritmo delle ultime {w}</span>}
        </Tile>
        <Tile value={`${ft.all.clean}/${ft.all.g}`} label="partite senza subire gol">
          {w ? <span style={{ color: 'var(--muted)' }}>{ft.last.clean} nelle ultime {w}</span> : null}
        </Tile>
      </div>

      <Card title="Corsa al vertice">
        <LineChart
          xLabels={race.rounds.map(String)} xTitle="giornata"
          series={[
            { key: 'us', label: label(league.us), short: 'Noi', values: race.ours, emphasis: true },
            { key: 'rival', label: rival, short: rival.split(' ')[0], values: race.theirs }
          ]}
          ariaLabel={`Punti per giornata: ${label(league.us)} ${race.ours[race.ours.length - 1]}, ${rival} ${race.theirs[race.theirs.length - 1]}`} />
        {pace && (
          <p style={{ fontSize: 13.5, margin: '8px 0 0' }}>
            {pace.ppg <= 0
              ? 'Con i punti già fatti si resta davanti a tutte, se le altre tengono il loro ritmo.'
              : <>Per chiudere davanti a <b>{label(pace.rival)}</b> al suo ritmo attuale ({Math.round(pace.rivalFinal)} punti) servono <b>{n1(pace.ppg)} punti a partita</b> nelle {pace.left} gare che restano (finora {n1(projection.ppg)}).</>}
          </p>
        )}
      </Card>

      <Card title="Forma del girone · ultime 5">
        <div className="tablewrap">
          <table className="data" style={{ minWidth: 0 }}>
            <thead><tr><th>Squadra</th><th>Ultime 5</th><th>Pt</th></tr></thead>
            <tbody>
              {d.form.filter((f, i) => i < 6 || f.team === league.us).map((f) => (
                <tr key={f.team} style={f.team === league.us ? { fontWeight: 700 } : undefined}>
                  <td>{f.rank}. {label(f.team)}<div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 400 }}>{f.pos}ª in classifica</div></td>
                  <td><Seq seq={f.seq} /></td><td>{f.pts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p><small>Punti nelle ultime 5 gare di campionato di ogni squadra: chi arriva in forma, non solo chi è davanti.</small></p>
      </Card>

      <Card title="Contro chi facciamo punti">
        <div className="tablewrap">
          <table className="data" style={{ minWidth: 0 }}>
            <thead><tr><th>Contro</th><th>Punti/gara</th><th>Gol/gara</th></tr></thead>
            <tbody>
              {[...splits.bands.map((b) => [b.key, b.label, b]), ['casa', 'In casa', splits.home], ['fuori', 'In trasferta', splits.away]].map(([k, l, s]) => (
                <tr key={k}>
                  <td style={{ whiteSpace: 'nowrap' }}>{l}<div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{s?.g || 0} gar{s?.g === 1 ? 'a' : 'e'}</div></td>
                  <td>{s?.g ? n1(s.ppg) : '–'}</td><td>{s?.g ? `${n1(s.gf)}–${n1(s.ga)}` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p><small>Punti e gol fatti–subiti a partita; fasce sulla classifica di oggi. Con poche gare per fascia basta un risultato per cambiare la media.</small></p>
      </Card>

      <Card title="Calendario">
        {next.length > 0 ? (
          <div className="stack" style={{ gap: 8 }}>
            {next.map(({ m, o }) => (
              <div key={m.id} className="spread" style={{ gap: 8, alignItems: 'flex-start' }}>
                <div style={{ fontSize: 14 }}>
                  <b>{m.opponent}</b> <span style={{ color: 'var(--muted)' }}>· {fmtShort(m.date)} · {m.home === false ? 'fuori' : 'in casa'}</span>
                  {o && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{o.pos}° su {o.of} · {n1(o.ppg)} punti a partita · ultime: <Seq seq={o.seq} /></div>}
                </div>
                {o && <Badge tone={LEVEL[o.level]}>difficoltà {o.level}</Badge>}
              </div>
            ))}
          </div>
        ) : <p style={{ fontSize: 14, margin: 0 }}>Nessuna partita di campionato in calendario: aggiungile da Partite.</p>}
        {ours?.oppPpg != null && (
          <p style={{ fontSize: 13.5, margin: '10px 0 0' }}>
            Nelle {ours.games} gare che restano incontriamo squadre da <b>{n1(ours.oppPpg)} punti a partita</b> in media
            {schedule.slice(1).filter((s) => s.oppPpg != null).length > 0 && <> (le inseguitrici: {schedule.slice(1).map((s) => `${label(s.team)} ${n1(s.oppPpg)}`).join(', ')})</>}.
            {' '}{(() => {
              const others = schedule.slice(1).filter((s) => s.oppPpg != null);
              if (!others.length) return '';
              const avg = others.reduce((a, s) => a + s.oppPpg, 0) / others.length;
              return Math.abs(ours.oppPpg - avg) < 0.05 ? 'Calendario simile al loro.' : ours.oppPpg > avg ? 'Calendario un po’ più difficile del loro.' : 'Calendario un po’ più facile del loro.';
            })()}
          </p>
        )}
        <p><small>Difficoltà: punti a partita dell'avversaria in stagione e nelle ultime 5. Chi resta da incontrare si ricava dalle gare già giocate (andata e ritorno).</small></p>
      </Card>

      {checks.length > 0 && (
        <Card title="Risultati da controllare">
          <div className="stack" style={{ gap: 8 }}>
            {checks.map((c) => {
              const mine = appScore(c.match);
              return (
                <div key={c.match.id} className="spread" style={{ gap: 8 }}>
                  <div style={{ fontSize: 13.5 }}>
                    <b>{c.match.opponent}</b> <span style={{ color: 'var(--muted)' }}>· {fmtShort(c.match.date)} · {c.match.competition}</span>
                    <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                      In app {mine ? `${mine.us}-${mine.them}` : 'nessun risultato'} · {c.off.provisional ? 'provvisorio' : 'ufficiale'} <b style={{ color: 'var(--ink)' }}>{c.off.us}-{c.off.them}</b> ({c.off.source})
                    </div>
                  </div>
                  {canFix && <Button size="sm" variant="secondary" disabled={fixing === c.match.id} onClick={() => fix(c)}>{c.off.provisional ? 'Usa questo' : "Usa l'ufficiale"}</Button>}
                </div>
              );
            })}
          </div>
          <p><small>I risultati mancanti si completano da soli all'apertura dell'app; uno diverso da quello del comunicato si corregge solo con il tuo tocco.</small></p>
        </Card>
      )}

      {girone.corrections?.length > 0 && (
        <Card title="Corretti dal comunicato">
          <div className="stack" style={{ gap: 4 }}>
            {[...girone.corrections].reverse().slice(0, 8).map((c) => (
              <div key={`${c.round}${c.leg}${c.home}`} style={{ fontSize: 13.5 }}>
                {teamLabel(c.home)} – {teamLabel(c.away)} <span style={{ color: 'var(--muted)' }}>· {c.round}ª {c.leg === 'R' ? 'ritorno' : 'andata'} · Tuttocampo {c.provisional} →</span> <b>{c.official}</b>
              </div>
            ))}
          </div>
          <p><small>La domenica sera risultati e classifica arrivano provvisori da Tuttocampo; quando esce il comunicato valgono i suoi, e qui restano le differenze trovate.</small></p>
        </Card>
      )}
    </>
  );
}
