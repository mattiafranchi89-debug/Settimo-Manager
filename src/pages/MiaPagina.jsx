import { useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, useDoc, where, limit } from '../lib/db';
import { playerInsight } from '../lib/insights';
import { Card, Kpi, Badge, Empty, Loading, Alert } from '../components/ui';
import { fmtShort, fmtTime, fmtDate, toDate, capitalize, positionLabel, sortPlayers } from '../lib/format';
import { earned, nextMilestone } from '../lib/milestones';
import { copyText } from '../lib/callup';
import { Button, Kpi as K } from '../components/ui';
import { setDocument, serverTimestamp } from '../lib/db';

/** Cosa vede un giocatore di sé stesso: i suoi numeri, nient'altro. */
export default function MiaPagina() {
  const { user } = useAuth();
  const { club } = useClub();
  const { data: me, loading } = useDoc('players', user?.playerId, !!user?.playerId);
  const { data: callups } = useCollection('callups', useMemo(() => [limit(60)], []), !!user?.playerId);
  const { data: matches } = useCollection('events', useMemo(() => [where('type', '==', 'match'), limit(120)], []), !!user?.playerId);
  const { data: squad } = useCollection('players', useMemo(() => [where('active', '==', true)], []), !!user?.playerId);
  const { data: myVotes } = useCollection('votes', useMemo(() => [where('voterUid', '==', user?.uid || '-')], [user?.uid]), !!user?.playerId);
  const { data: matchStats } = useCollection('matchStats', useMemo(() => [limit(60)], []), !!user?.playerId);

  if (!user?.playerId) {
    return (
      <Card>
        <Empty title="Account non collegato a un giocatore">
          Chiedi a un responsabile di collegare il tuo account alla tua scheda in rosa: da lì vedrai presenze, minuti e allenamenti.
        </Empty>
      </Card>
    );
  }
  if (loading) return <Loading />;
  if (!me) return <Card><Empty title="Scheda non trovata" /></Card>;

  const i = playerInsight(me, club.cardsPerSuspension || 4);
  const s = me.stats || {};
  const byEvent = Object.fromEntries(matches.map((m) => [m.id, m]));
  const myCallups = callups
    .filter((c) => (c.players || []).includes(me.id) && byEvent[c.eventId])
    .map((c) => byEvent[c.eventId])
    .sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0));
  const nextCallup = myCallups.find((m) => toDate(m.date) >= new Date());

  // Confronto con la squadra: media dei compagni sugli stessi numeri.
  const avg = (k) => {
    const vals = squad.filter((p) => p.id !== me.id).map((p) => p.stats?.[k] || 0);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };
  const cmp = [
    ['Minuti', s.minutes || 0, avg('minutes')],
    ['Presenze', s.appearances || 0, avg('appearances')],
    ['Allenamenti', s.trainingsAttended || 0, avg('trainingsAttended')],
    ['Gol', s.goals || 0, avg('goals')]
  ];

  const badges = earned(s);
  const next = nextMilestone(s);
  const seasons = Object.entries(me.seasonHistory || {}).map(([k, v]) => [k.replace('-', '/'), v]).sort(([a], [b]) => b.localeCompare(a));

  // Voto del migliore in campo: sull'ultima gara chiusa entro tre giorni.
  const lastClosed = matchStats
    .filter((m) => m.closed && toDate(m.date) && Date.now() - toDate(m.date).getTime() < 3 * 86400000)
    .sort((a, b) => toDate(b.date) - toDate(a.date))[0];
  const onSheet = lastClosed ? [...(lastClosed.starters || []), ...(lastClosed.bench || [])].filter((id) => id !== me.id) : [];
  const myVote = lastClosed ? myVotes.find((v) => v.eventId === lastClosed.eventId) : null;
  const published = matchStats.filter((m) => m.mvp?.playerId).sort((a, b) => toDate(b.date) - toDate(a.date)).slice(0, 5);

  return (
    <>
      <div className="pagehead">
        <div><h1>{me.fullName}</h1><p>{positionLabel(me.position)}{me.secondaryPosition ? ` · ${positionLabel(me.secondaryPosition)}` : ''}</p></div>
        {me.injury?.active ? <Badge tone="blue">Infortunato</Badge> : i.diffidato ? <Badge tone="orange">In diffida</Badge> : null}
      </div>

      {nextCallup && (
        <Card title="Sei convocato">
          <div style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 700 }}>
            {nextCallup.home === false ? `${nextCallup.opponent} — ${club.clubName}` : `${club.clubName} — ${nextCallup.opponent}`}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 13.5 }}>{capitalize(fmtShort(nextCallup.date))} · {fmtTime(nextCallup.date)}{nextCallup.meetingTime ? ` · ritrovo ${fmtTime(nextCallup.meetingTime)}` : ''}</div>
          {nextCallup.venue && <div style={{ fontSize: 13.5, marginTop: 4 }}>📍 {nextCallup.venue}</div>}
        </Card>
      )}

      <div className="grid grid--kpi">
        <Kpi value={s.appearances || 0} label="Presenze" accent />
        <Kpi value={s.minutes || 0} label="Minuti" />
        <Kpi value={s.goals || 0} label="Gol" />
        <Kpi value={`${i.attended}/${i.totalTrainings}`} label="Allenamenti" />
      </div>

      <Card title="La tua stagione">
        <table className="data" style={{ minWidth: 0 }}>
          <tbody>
            <tr><th>Convocazioni</th><td>{myCallups.length}</td></tr>
            <tr><th>Da titolare</th><td>{s.starts || 0}</td></tr>
            <tr><th>Subentrato</th><td>{s.subs || 0}</td></tr>
            <tr><th>Ultima partita</th><td>{i.lastPlayed ? `${fmtDate(i.lastPlayed)} · ${i.lastMinutes}′` : 'nessuna'}</td></tr>
            <tr><th>Presenza agli allenamenti</th><td>{i.attendancePct != null ? `${i.attendancePct}%` : '—'}</td></tr>
          </tbody>
        </table>
      </Card>

      {(i.trainingStreak >= 2 || i.startStreak >= 2) && (
        <Card title="Strisce aperte">
          <div className="plist">
            {i.trainingStreak >= 2 && (
              <div className="prow">
                <span className="prow__num">🔥</span>
                <span className="prow__body">
                  <span className="prow__name">{i.trainingStreak} allenamenti di fila</span>
                  <span className="prow__meta"><span>l'ultima assenza è più indietro di così</span></span>
                </span>
              </div>
            )}
            {i.startStreak >= 2 && (
              <div className="prow">
                <span className="prow__num">⚡</span>
                <span className="prow__body">
                  <span className="prow__name">{i.startStreak} partite consecutive da titolare</span>
                  <span className="prow__meta"><span>dall'ultima volta che sei partito dalla panchina</span></span>
                </span>
              </div>
            )}
          </div>
        </Card>
      )}

      <Card title="Disciplina">
        <div className="grid grid--kpi">
          <Kpi value={i.yellow} label="Ammonizioni" />
          <Kpi value={i.red} label="Espulsioni" />
          <Kpi value={i.toSuspension} label="Gialli alla squalifica" accent={i.diffidato} />
        </div>
        {me.suspended && <Alert level="error">Risulti squalificato: non puoi essere convocato.</Alert>}
        {!me.suspended && i.diffidato && (
          <Alert level="warn">Sei in diffida: alla prossima ammonizione salti una partita.</Alert>
        )}
        <p><small>La squalifica scatta ogni {club.cardsPerSuspension || 4} ammonizioni. I conteggi seguono le gare chiuse dallo staff, non il comunicato ufficiale.</small></p>
      </Card>

      {club.mvpEnabled !== false && lastClosed && onSheet.length > 0 && (
        <VotoMvp match={lastClosed} candidates={sortPlayers(squad.filter((p) => onSheet.includes(p.id)))} current={myVote}
          onVote={async (pid) => {
            await setDocument('votes', `${lastClosed.eventId}_${user.uid}`, {
              eventId: lastClosed.eventId, voterUid: user.uid, playerId: pid, at: serverTimestamp()
            });
          }} />
      )}

      {published.length > 0 && (
        <Card title="Migliori in campo">
          <div className="plist">
            {published.map((m) => {
              const p = squad.find((x) => x.id === m.mvp.playerId);
              return (
                <div key={m.id} className="prow">
                  <span className="prow__num">⭐</span>
                  <span className="prow__body">
                    <span className="prow__name">{p?.fullName || '—'}{m.mvp.playerId === me.id ? ' — sei tu' : ''}</span>
                    <span className="prow__meta"><span>vs {m.opponent} · {fmtShort(m.date)}</span><span>{m.mvp.votes} voti</span></span>
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title="Traguardi">
        {badges.length === 0 ? <p><small>Nessun traguardo ancora: il primo arriva con l'esordio o con 10 allenamenti.</small></p> : (
          <div className="btnrow">
            {badges.map((b) => <Badge key={b.key} tone="green">{b.emoji} {b.label}</Badge>)}
          </div>
        )}
        {next && <p style={{ marginTop: 10 }}><small>Prossimo: <strong>{next.label}</strong> — ne mancano {next.missing}.</small></p>}
        {badges.length > 0 && (
          <Button size="sm" variant="ghost" style={{ marginTop: 6 }}
            onClick={async () => { await copyText(`${me.fullName.split(' ')[0]} · ${club.clubName} ${club.season}\n${badges.map((b) => `${b.emoji} ${b.label}`).join('\n')}`); }}>
            Copia per condividere
          </Button>
        )}
      </Card>

      <Card title="Io e la squadra">
        <div className="stack" style={{ gap: 8 }}>
          {cmp.map(([label, mine, team]) => {
            const max = Math.max(1, mine, team);
            return (
              <div key={label} style={{ fontSize: 13 }}>
                <div className="spread"><span>{label}</span><span>{Math.round(mine)} · media {Math.round(team)}</span></div>
                <div style={{ background: 'var(--grey-50)', borderRadius: 6, height: 10, overflow: 'hidden', marginTop: 3, position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${(mine / max) * 100}%`, background: 'var(--red)', borderRadius: 6 }} />
                  <span style={{ position: 'absolute', left: `${(team / max) * 100}%`, top: -2, width: 2, height: 14, background: 'var(--ink)' }} />
                </div>
              </div>
            );
          })}
        </div>
        <p><small>La barra rossa sei tu, la linea nera è la media dei compagni.</small></p>
      </Card>

      {seasons.length > 0 && (
        <Card title="Stagioni precedenti">
          <div className="tablewrap">
            <table className="data" style={{ minWidth: 320 }}>
              <thead><tr><th>Stagione</th><th>Pres.</th><th>Min.</th><th>Gol</th><th>Allen.</th></tr></thead>
              <tbody>
                {seasons.map(([season, st]) => (
                  <tr key={season}><td>{season}</td><td>{st.appearances || 0}</td><td>{st.minutes || 0}</td><td>{st.goals || 0}</td><td>{st.trainingsAttended || 0}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {me.injury?.active && (
        <Alert level="info">
          Infortunio in corso{me.injury.expectedReturn ? `, rientro previsto ${fmtDate(me.injury.expectedReturn)}` : ''}. Sentiti con lo staff prima di riprendere.
        </Alert>
      )}
    </>
  );
}


function VotoMvp({ match, candidates, current, onVote }) {
  const [busy, setBusy] = useState(false);
  return (
    <Card title={`Il migliore contro ${match.opponent}`}>
      <p><small>Voto segreto, non puoi votare te stesso. Il risultato lo pubblica lo staff. Puoi cambiare idea finché il voto è aperto.</small></p>
      <div className="plist">
        {candidates.map((p) => (
          <button key={p.id} className={`prow ${current?.playerId === p.id ? 'prow--selected' : ''}`} disabled={busy}
            onClick={async () => { setBusy(true); try { await onVote(p.id); } finally { setBusy(false); } }}>
            <span className="prow__check">{current?.playerId === p.id ? '✓' : ''}</span>
            <span className="prow__body"><span className="prow__name">{p.fullName}</span></span>
          </button>
        ))}
      </div>
    </Card>
  );
}
