import { useMemo } from 'react';
import { Card, Empty } from './ui';
import { useCollection } from '../lib/db';
import { playerImpact, moduleRecord, benchImpact } from '../lib/playerImpact';
import { n1 } from '../lib/trend';

const MIN_MINUTES = 270;
const signed = (x, digits = 1) => (x == null ? '–' : `${x > 0 ? '+' : ''}${x.toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`);

/**
 * Con chi in campo andiamo meglio: più/meno dei gol con il giocatore in campo,
 * ogni 90' e rispetto a quando non c'è; punti da titolare e no; moduli;
 * panchina. Solo staff: sono numeri da leggere insieme al campo, non voti.
 */
export default function PlayerImpact({ matches = [], sheets = [], players = [] }) {
  const { data: lineups } = useCollection('lineups');
  const imp = useMemo(() => playerImpact(matches, sheets), [matches, sheets]);
  const mods = useMemo(() => moduleRecord(matches, lineups), [matches, lineups]);
  const bench = useMemo(() => benchImpact(matches, sheets), [matches, sheets]);
  const nameOf = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p.fullName])), [players]);
  const name = (pid) => nameOf[pid] || 'non più in rosa';

  const rows = imp.players.filter((p) => p.minutes >= MIN_MINUTES && p.onOff != null).sort((a, b) => b.onOff - a.onOff);
  const few = imp.players.filter((p) => p.minutes > 0 && p.minutes < MIN_MINUTES).length;
  const startRows = imp.players.filter((p) => p.starts >= 3 && p.otherGames >= 2)
    .map((p) => ({ ...p, diff: p.startPpg - p.otherPpg })).sort((a, b) => b.diff - a.diff).slice(0, 6);

  return (
    <>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 8px' }}>
        Gare ufficiali con la scheda chiusa e i minuti completi (gol, cambi, espulsioni): {imp.games} su {imp.total}. Il più/meno dipende anche dai compagni e dagli avversari: va letto insieme al campo, non come voto.
      </p>

      <Card title="Con lui in campo">
        {rows.length === 0 ? (
          <Empty title="Ancora pochi minuti">Servono almeno {MIN_MINUTES} minuti nelle gare ricostruite per giocatore.</Empty>
        ) : (
          <div className="tablewrap">
            <table className="data" style={{ minWidth: 0 }}>
              <thead><tr><th>Giocatore</th><th>Ogni 90'</th><th>Con/senza</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.pid}>
                    <td>{name(p.pid)}<div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{Math.round(p.minutes)}' · gol {p.gf}–{p.ga}</div></td>
                    <td>{signed(p.pm90)}</td>
                    <td><b>{signed(p.onOff)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p><small>
          Sotto il nome: minuti e gol fatti–subiti con lui in campo. «Ogni 90'»: differenza reti con lui in campo. «Con/senza»: quanto cambia la differenza reti ogni 90' tra quando è in campo e quando non c'è
          (positivo = la squadra va meglio con lui). Almeno {MIN_MINUTES}'{few ? `; ${few} giocator${few === 1 ? 'e' : 'i'} con meno minuti non compai${few === 1 ? 'e' : 'ono'}` : ''}.
        </small></p>
      </Card>

      {startRows.length > 0 && (
        <Card title="Titolare o no">
          <div className="tablewrap">
            <table className="data" style={{ minWidth: 0 }}>
              <thead><tr><th>Giocatore</th><th>Da titolare</th><th>Senza</th></tr></thead>
              <tbody>
                {startRows.map((p) => (
                  <tr key={p.pid}>
                    <td>{name(p.pid)}</td>
                    <td>{n1(p.startPpg)} <span style={{ color: 'var(--muted)', fontSize: 12 }}>({p.starts})</span></td>
                    <td>{n1(p.otherPpg)} <span style={{ color: 'var(--muted)', fontSize: 12 }}>({p.otherGames})</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p><small>Punti a partita della squadra con il giocatore titolare e senza (tra parentesi le gare). Almeno 3 gare da titolare e 2 senza.</small></p>
        </Card>
      )}

      <Card title="Moduli">
        {mods.length === 0 ? <p style={{ margin: 0 }}><small>Nessuna formazione salvata per le gare con risultato.</small></p> : (
          <div className="tablewrap">
            <table className="data" style={{ minWidth: 0 }}>
              <thead><tr><th>Modulo</th><th>Gare</th><th>Punti/gara</th><th>Gol/gara</th></tr></thead>
              <tbody>
                {mods.map((m) => (
                  <tr key={m.module}><td>{m.module}</td><td>{m.g}</td><td>{n1(m.ppg)}</td><td>{n1(m.gfPg)}–{n1(m.gaPg)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p><small>Dal modulo della formazione salvata in ogni gara ufficiale con risultato; gol fatti–subiti a partita.</small></p>
      </Card>

      <Card title="Panchina">
        <p style={{ fontSize: 14, margin: 0 }}>
          Dai subentrati <b>{bench.goals} gol</b>{bench.teamGoals ? ` su ${bench.teamGoals} (${Math.round((bench.share || 0) * 100)}%)` : ''} e <b>{bench.assists} assist</b>.
        </p>
        {bench.timed > 0 && bench.before.min > 0 && bench.after.min > 0 && (
          <p style={{ fontSize: 14, margin: '6px 0 0' }}>
            Prima del primo cambio {n1(bench.before.gf90)} gol fatti e {n1(bench.before.ga90)} subiti ogni 90'; dopo, {n1(bench.after.gf90)} e {n1(bench.after.ga90)}
            <span style={{ color: 'var(--muted)' }}> ({bench.timed} gare con i minuti completi)</span>.
          </p>
        )}
        <p><small>I cambi arrivano spesso quando la partita è già indirizzata: il confronto prima/dopo è un indizio, non una prova.</small></p>
      </Card>
    </>
  );
}
