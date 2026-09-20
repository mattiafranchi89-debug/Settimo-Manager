import { useMemo } from 'react';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, where, limit } from '../lib/db';
import { Card, Kpi, Badge, Empty, Loading } from '../components/ui';
import { GROUPS, groupOf, positionLabel, sortPlayers, toDate } from '../lib/format';

/**
 * La squadra vista da un giocatore: chi c'è e come sta andando il gruppo.
 * Niente tabella dei minuti per giocatore — quella è una vista da allenatore,
 * e negli spogliatoi fa più danni che informazione.
 */
export default function Squadra() {
  const { user } = useAuth();
  const { club } = useClub();
  const { data: players, loading } = useCollection('players', useMemo(() => [where('active', '==', true)], []));
  const { data: matches } = useCollection('events', useMemo(() => [where('type', '==', 'match'), limit(120)], []));

  const played = useMemo(
    () => matches.filter((m) => m.scoreHome != null).sort((a, b) => toDate(b.date) - toDate(a.date)),
    [matches]
  );

  const team = useMemo(() => {
    let fatti = 0, subiti = 0, v = 0, n = 0, p = 0;
    played.forEach((m) => {
      const us = m.home === false ? m.scoreAway : m.scoreHome;
      const them = m.home === false ? m.scoreHome : m.scoreAway;
      fatti += us; subiti += them;
      if (us > them) v++; else if (us === them) n++; else p++;
    });
    return { fatti, subiti, v, n, p, giocate: played.length };
  }, [played]);

  // Media di squadra sugli allenamenti: un dato collettivo, non una classifica.
  const attendance = useMemo(() => {
    const total = Math.max(...players.map((x) => x.stats?.totalTrainings || 0), 0);
    if (!total) return null;
    const sum = players.reduce((a, x) => a + (x.stats?.trainingsAttended || 0), 0);
    return Math.round((sum / (total * players.length)) * 100);
  }, [players]);

  const scorers = useMemo(
    () => players.filter((x) => (x.stats?.goals || 0) > 0)
      .sort((a, b) => (b.stats.goals || 0) - (a.stats.goals || 0))
      .slice(0, 10),
    [players]
  );

  if (loading) return <Loading />;
  if (!players.length) return <Card><Empty title="Rosa non ancora caricata" /></Card>;

  return (
    <>
      <div className="pagehead">
        <div><h1>Squadra</h1><p>{players.length} giocatori · stagione {club.season}</p></div>
      </div>

      {team.giocate > 0 && (
        <div className="grid grid--kpi">
          <Kpi value={`${team.v}-${team.n}-${team.p}`} label={`Vinte, pari, perse (${team.giocate})`} accent />
          <Kpi value={team.fatti} label="Gol fatti" />
          <Kpi value={team.subiti} label="Gol subiti" />
          <Kpi value={attendance != null ? `${attendance}%` : '—'} label="Presenza agli allenamenti" />
        </div>
      )}

      {scorers.length > 0 && (
        <Card title="⚽ I nostri marcatori">
          <div className="plist">
            {scorers.map((p, i) => (
              <div key={p.id} className="prow">
                <span className="prow__num" style={i === 0 ? { background: 'var(--red)' } : undefined}>{i + 1}</span>
                <span className="prow__body">
                  <span className="prow__name">{p.fullName}{p.id === user?.playerId ? ' — sei tu' : ''}</span>
                </span>
                <Badge tone={i === 0 ? 'red' : 'grey'}>{p.stats.goals} {p.stats.goals === 1 ? 'gol' : 'gol'}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {GROUPS.map((g) => {
        const list = sortPlayers(players.filter((p) => groupOf(p.position) === g.key));
        if (!list.length) return null;
        return (
          <div key={g.key}>
            <div className="grouphead">{g.emoji} {g.label} <small>{list.length}</small></div>
            <div className="plist">
              {list.map((p) => (
                <div key={p.id} className="prow">
                  <span className="prow__num">{p.position}</span>
                  <span className="prow__body">
                    <span className="prow__name">
                      {p.fullName}{p.id === user?.playerId ? ' — sei tu' : ''}
                    </span>
                    <span className="prow__meta"><span>{positionLabel(p.position)}</span></span>
                  </span>
                  {p.injury?.active && <Badge tone="blue">Infortunato</Badge>}
                  {p.suspended && <Badge tone="purple">Squalificato</Badge>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
