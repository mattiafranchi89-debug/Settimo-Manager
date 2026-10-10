import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCollection, useDoc, useClub, where, orderBy, limit } from '../lib/db';
import { Card, Button, Badge, Empty, Loading } from '../components/ui';
import { fmtShort, fmtTime, countdown, toDate, capitalize, fmtLong, euro } from '../lib/format';
import { can } from '../lib/permissions';
import { buildInsights, squadAlerts } from '../lib/insights';
import { useCrl, sortCrl, CRL_TYPES, useAutoOpponent } from '../lib/crl';
import { autoVisible, formOf, outcome, sameTeam } from '../lib/scouting';
import PushCard from '../components/PushCard';
import { suspendedIn, COMPS } from '../lib/discipline';

const DAY = 86400000;
const PUBLISHED = ['pubblicata', 'condivisa', 'parzialmente_confermata', 'completamente_confermata', 'chiusa'];

/**
 * La Home dello staff sul telefono risponde a tre domande, in uno schermo e
 * mezzo: cosa c'è adesso (prossimo impegno), cosa devo fare (azioni in
 * sospeso, solo se ce ne sono) e c'è qualche problema (squalificati, diffidati,
 * infortunati). Il resto sta nelle sezioni.
 */
export default function Dashboard() {
  const { user } = useAuth();
  const { club } = useClub();
  const navigate = useNavigate();
  const role = user?.role;
  const staff = can(role, 'players.read');

  const nowTs = useMemo(() => new Date(), []);
  const now = nowTs.getTime();
  const upcomingQ = useMemo(() => [where('date', '>=', nowTs), orderBy('date', 'asc'), limit(8)], [nowTs]);
  const pastQ = useMemo(() => [where('date', '<', nowTs), orderBy('date', 'desc'), limit(10)], [nowTs]);
  const { data: upcoming, loading } = useCollection('events', upcomingQ);
  const { data: pastEvents } = useCollection('events', pastQ);
  const { data: players } = useCollection('players', useMemo(() => [where('active', '==', true)], []));

  const nextMatch = upcoming.find((e) => e.type === 'match');
  const nextTraining = upcoming.find((e) => e.type === 'training');
  const lastMatch = pastEvents.find((e) => e.type === 'match');
  const lastTraining = pastEvents.find((e) => e.type === 'training');

  // Convocazione della prossima partita, scheda dell'ultima, presenze dell'ultimo allenamento.
  const callupQ = useMemo(() => [where('eventId', '==', nextMatch?.id || '-')], [nextMatch?.id]);
  const { data: nextCallups } = useCollection('callups', callupQ, staff && !!nextMatch);
  const callup = useMemo(
    () => [...nextCallups].sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0))[0],
    [nextCallups]
  );
  const { data: lastStats } = useDoc('matchStats', lastMatch?.id, staff && !!lastMatch);
  const attQ = useMemo(() => [where('eventId', '==', lastTraining?.id || '-'), limit(1)], [lastTraining?.id]);
  const canAttend = can(role, 'attendance.write');
  const { data: lastAttendance, loading: attLoading } = useCollection('attendance', attQ, canAttend && !!lastTraining);

  const seesFinance = can(role, 'finance.read');
  const openQ = useMemo(() => [where('status', '==', 'aperto')], []);
  const { data: openFines } = useCollection('fines', openQ, seesFinance);
  const { data: openPayments } = useCollection('payments', openQ, seesFinance);

  const insights = useMemo(
    () => buildInsights({ players, club }),
    [players, club]
  );
  const alerts = useMemo(() => squadAlerts(players, insights), [players, insights]);
  const injured = players.filter((p) => p.injury?.active);

  const { data: autoOpp } = useAutoOpponent();
  const opp = nextMatch && can(role, 'scouting.read') && autoVisible(autoOpp, nowTs) && sameTeam(autoOpp.next.opponent, nextMatch.opponent || '')
    ? autoOpp : null;
  const { data: crl } = useCrl();

  /* ---------- da fare: solo voci verificabili dai dati ---------- */
  const todo = useMemo(() => {
    const out = [];
    if (lastMatch) {
      const ago = now - toDate(lastMatch.date).getTime();
      if (lastMatch.scoreHome == null && can(role, 'events.write')) {
        out.push({ icon: '⚽', text: `Risultato con ${lastMatch.opponent}`, meta: capitalize(fmtShort(lastMatch.date)), to: '/partite' });
      } else if (ago < 10 * DAY && !lastStats?.closed && can(role, 'matchstats.write')) {
        out.push({ icon: '📝', text: `Scheda gara con ${lastMatch.opponent}`, meta: 'gol, cartellini e minuti da chiudere', to: `/partite/${lastMatch.id}` });
      }
    }
    if (nextMatch && can(role, 'callup.draft')) {
      const until = toDate(nextMatch.date).getTime() - now;
      if (until < 4 * DAY) {
        if (!callup) {
          out.push({ icon: '📋', text: 'Convocazione da preparare', meta: `vs ${nextMatch.opponent} · ${countdown(nextMatch.date)}`, to: `/convocazioni/nuova?event=${nextMatch.id}`, urgent: until < 2 * DAY });
        } else if (!PUBLISHED.includes(callup.status)) {
          out.push({ icon: '📋', text: 'Convocazione da pubblicare', meta: `bozza · ${(callup.players || []).length} giocatori`, to: `/convocazioni/${callup.id}`, urgent: until < 2 * DAY });
        }
      }
    }
    if (lastTraining && canAttend && !attLoading && lastAttendance.length === 0 && now - toDate(lastTraining.date).getTime() < 7 * DAY) {
      out.push({ icon: '🏃', text: 'Presenze da registrare', meta: `allenamento di ${fmtShort(lastTraining.date)}`, to: `/evento/${lastTraining.id}` });
    }
    if (seesFinance && (openPayments.length || openFines.length)) {
      const total = [...openPayments, ...openFines].reduce((s, x) => s + (x.amount || 0), 0);
      const parts = [
        openPayments.length && `${openPayments.length} ${openPayments.length === 1 ? 'quota' : 'quote'}`,
        openFines.length && `${openFines.length} ${openFines.length === 1 ? 'multa' : 'multe'}`
      ].filter(Boolean);
      out.push({ icon: '💶', text: `${parts.join(' e ')} da incassare`, meta: euro(total), to: '/quote' });
    }
    return out;
  }, [lastMatch, lastStats, nextMatch, callup, lastTraining, lastAttendance, attLoading, openPayments, openFines, role, canAttend, seesFinance, now]);

  /* ---------- novità: massimo quattro righe ---------- */
  const news = useMemo(() => {
    const out = [];
    if (lastMatch && lastMatch.scoreHome != null && now - toDate(lastMatch.date).getTime() < 7 * DAY) {
      const us = lastMatch.home === false ? lastMatch.scoreAway : lastMatch.scoreHome;
      const them = lastMatch.home === false ? lastMatch.scoreHome : lastMatch.scoreAway;
      out.push({ key: 'res', icon: us > them ? '✅' : us === them ? '➖' : '❌', text: `${us > them ? 'Vinta' : us === them ? 'Pari' : 'Persa'} ${us}-${them} ${lastMatch.home === false ? 'a' : 'con'} ${lastMatch.opponent}`, to: `/partite/${lastMatch.id}` });
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    players.forEach((p) => {
      const b = toDate(p.birthDate);
      if (!b) return;
      const next = new Date(today.getFullYear(), b.getMonth(), b.getDate());
      if (next < today) next.setFullYear(today.getFullYear() + 1);
      const days = Math.round((next - today) / DAY);
      if (days <= 7) out.push({ key: `bd-${p.id}`, icon: '🎂', days, text: `${titleName(p.fullName)} compie ${next.getFullYear() - b.getFullYear()} anni ${days === 0 ? 'oggi' : days === 1 ? 'domani' : `fra ${days} giorni`}` });
    });
    if (can(role, 'scouting.read')) {
      const since = new Date(now - 7 * DAY).toISOString().slice(0, 10);
      sortCrl(crl?.items || [])
        // Classifica e risultati del Settimo sono già altrove: dal CRL tengo il resto.
        .filter((i) => (i.date || '') >= since && !['classifica', 'risultato'].includes(i.type))
        .slice(0, 2)
        .forEach((i) => out.push({ key: i.id, icon: CRL_TYPES[i.type]?.icon || '📰', text: i.text, to: '/comunicati' }));
    }
    return out.slice(0, 4);
  }, [lastMatch, players, crl, role, now]);

  if (loading) return <Loading />;

  const trainingFirst = nextTraining && (!nextMatch || toDate(nextTraining.date) < toDate(nextMatch.date));
  const watch = [
    // Campionato e coppa non fanno cumulo: l'etichetta dice dove vale.
    ...alerts.squalificati.map((p) => ({ id: `s-${p.id}`, tone: 'red', label: `🟥 ${short(p.fullName)}${compTag([...new Set([...suspendedIn(p), ...(insights[p.id]?.autoSuspendedIn || [])])])}` })),
    ...alerts.diffidati.map((p) => ({ id: `d-${p.id}`, tone: 'orange', label: `🟨 ${short(p.fullName)} · diffida${compTag(insights[p.id]?.diffidaIn || [], true)}` })),
    ...injured.map((p) => ({ id: `i-${p.id}`, tone: 'grey', label: `🩹 ${short(p.fullName)}` }))
  ];

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Ciao, {(user?.name || '').split(' ')[0]}</h1>
          <p>{club.teamName} · {club.season}</p>
        </div>
      </div>

      {/* 1. Prossimo impegno */}
      {nextMatch ? (
        <Card title="Prossima partita" action={<Badge tone="red">{countdown(nextMatch.date)}</Badge>}>
          <div style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>
            {nextMatch.home === false ? `${nextMatch.opponent} — ${club.clubName}` : `${club.clubName} — ${nextMatch.opponent}`}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 4 }}>
            {capitalize(fmtLong(nextMatch.date))} · {fmtTime(nextMatch.date)} · {nextMatch.competition}
          </div>
          <div style={{ fontSize: 13.5, marginTop: 4 }}>
            📍 {nextMatch.venue || club.homeStadium}
            {nextMatch.meetingTime && <> · ⏰ ritrovo {fmtTime(nextMatch.meetingTime)}</>}
          </div>
          {opp && <OpponentLine opp={opp} />}
          <div className="btnrow" style={{ marginTop: 12 }}>
            <HeroAction match={nextMatch} callup={callup} role={role} navigate={navigate} />
            <Button variant="ghost" size="sm" onClick={() => navigate(`/evento/${nextMatch.id}`)}>Scheda partita ›</Button>
          </div>
          {trainingFirst && (
            <button className="prow" onClick={() => navigate(`/evento/${nextTraining.id}`)} style={{ width: '100%', textAlign: 'left', marginTop: 12 }}>
              <span className="prow__num" aria-hidden="true">🏃</span>
              <span className="prow__body">
                <span className="prow__name">Prima: allenamento {fmtShort(nextTraining.date)} {fmtTime(nextTraining.date)}</span>
                <span className="prow__meta"><span>{nextTraining.venue}</span>{nextTraining.focus && <span>🎯 {nextTraining.focus}</span>}</span>
              </span>
            </button>
          )}
        </Card>
      ) : nextTraining ? (
        <Card title="Prossimo allenamento" action={<Badge tone="grey">{countdown(nextTraining.date)}</Badge>}>
          <div style={{ fontWeight: 600 }}>{capitalize(fmtLong(nextTraining.date))} · {fmtTime(nextTraining.date)}</div>
          <div style={{ color: 'var(--muted)', fontSize: 13.5 }}>{nextTraining.venue}{nextTraining.focus ? ` · 🎯 ${nextTraining.focus}` : ''}</div>
          {can(role, 'events.write') && (
            <div className="btnrow" style={{ marginTop: 12 }}>
              <Button variant="secondary" size="sm" onClick={() => navigate('/partite')}>＋ Partita in calendario</Button>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <Empty title="Nessun impegno in calendario"
            action={can(role, 'events.write') && <Button onClick={() => navigate('/partite')}>Aggiungi partita</Button>}>
            Inserisci il calendario per attivare convocazioni e promemoria.
          </Empty>
        </Card>
      )}

      {/* 2. Da fare */}
      {staff && (
        <Card title="Da fare" action={todo.length > 0 && <Badge tone={todo.some((t) => t.urgent) ? 'red' : 'orange'}>{todo.length}</Badge>}>
          {todo.length ? (
            <div className="plist">
              {todo.map((t) => (
                <button key={t.text} className="prow" onClick={() => navigate(t.to)} style={{ width: '100%', textAlign: 'left' }}>
                  <span className="prow__num" aria-hidden="true">{t.icon}</span>
                  <span className="prow__body">
                    <span className="prow__name">{t.text}</span>
                    <span className="prow__meta"><span>{t.meta}</span></span>
                  </span>
                  <span aria-hidden="true" style={{ color: t.urgent ? 'var(--red)' : 'var(--muted)', fontSize: 18 }}>›</span>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 14, color: 'var(--muted)' }}>✅ Tutto in ordine</div>
          )}
          <div style={{ marginTop: todo.length ? 10 : 6 }}><PushCard compact /></div>
        </Card>
      )}

      {/* 3. Attenzione */}
      {staff && (watch.length > 0 || alerts.dimenticati.length > 0) && (
        <Card title="Attenzione" action={<Button size="sm" variant="ghost" onClick={() => navigate('/rosa')}>Rosa</Button>}>
          {watch.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {watch.map((w) => <Badge key={w.id} tone={w.tone}>{w.label}</Badge>)}
            </div>
          )}
          {alerts.dimenticati.length > 0 && (
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: watch.length ? 8 : 0 }}>
              Si allenano ma non giocano da tempo: {alerts.dimenticati.map((p) => short(p.fullName)).join(', ')}.
            </div>
          )}
        </Card>
      )}

      {/* 4. Novità */}
      {news.length > 0 && (
        <Card title="Novità" action={can(role, 'scouting.read') && <Button size="sm" variant="ghost" onClick={() => navigate('/comunicati')}>Comunicati</Button>}>
          <div className="stack" style={{ gap: 8 }}>
            {news.map((n) => (
              <div key={n.key} onClick={n.to ? () => navigate(n.to) : undefined}
                style={{ display: 'flex', gap: 10, fontSize: 14, cursor: n.to ? 'pointer' : 'default' }}>
                <span aria-hidden="true">{n.icon}</span><span>{n.text}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

const titleName = (s = '') => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

/** « · coppa» / « · camp.»; vuoto se vale ovunque (squalifica) o se non serve. */
function compTag(list = [], always = false) {
  if (!list.length || (!always && list.length > 1)) return '';
  return ` ${always ? '' : '· '}${list.map((b) => COMPS[b]?.short || b).join(' e ')}`;
}

/** «COGNOME NOME» → «Cognome N.»: sulle etichette serve spazio. */
function short(fullName = '') {
  const parts = fullName.trim().split(/\s+/);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  if (parts.length < 2) return cap(fullName);
  return `${cap(parts[0])} ${parts[1][0].toUpperCase()}.`;
}

function OpponentLine({ opp }) {
  const st = opp.standing || {};
  const f = formOf(opp.results || [], 3);
  const parts = [];
  if (st.pos != null) parts.push(`${st.pos}° · ${st.pts} pt`);
  if (f.played) parts.push(`ultime ${f.list.map(outcome).join(' ')}`);
  if (opp.suspended?.length) parts.push(`${opp.suspended.length} squalificat${opp.suspended.length === 1 ? 'o' : 'i'}`);
  if (!parts.length) return null;
  return (
    <div style={{ fontSize: 13.5, marginTop: 8, padding: '6px 10px', borderRadius: 8, background: 'var(--red-soft)' }}>
      🔍 {parts.join(' · ')}
    </div>
  );
}

/** Un solo pulsante principale, quello che serve adesso. */
function HeroAction({ match, callup, role, navigate }) {
  if (!can(role, 'callup.draft')) {
    return callup ? <Button size="sm" onClick={() => navigate(`/convocazioni/${callup.id}`)}>Convocazione</Button> : null;
  }
  if (!callup) return <Button onClick={() => navigate(`/convocazioni/nuova?event=${match.id}`)}>Prepara convocazione</Button>;
  if (!PUBLISHED.includes(callup.status)) return <Button onClick={() => navigate(`/convocazioni/${callup.id}`)}>Completa convocazione</Button>;
  return (
    <Button variant="secondary" onClick={() => navigate(`/convocazioni/${callup.id}`)}>
      ✅ {(callup.players || []).length} convocati
    </Button>
  );
}
