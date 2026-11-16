// L'assistente che risponde sui dati. Il modello (worker/assistente.js) chiede
// i dati con degli «strumenti»; qui si eseguono nel browser, con i permessi
// dell'utente e con le stesse librerie delle pagine, così i numeri coincidono
// con quelli delle schermate. Gli strumenti non danno mai contatti, documenti
// o dati sanitari: li lasciano fuori prima di rispondere.

import { collection, getDocs, getDoc, doc, query, where } from 'firebase/firestore';
import { db, auth } from './firebase';
import { toDate, seasonStart, dayIso, groupOf, GROUPS, sortPlayers, positionLabel, euro, TZ } from './format';
import { compBucket, suspendedIn } from './discipline';
import { buildInsights, squadAlerts } from './insights';
import { leagueDashboard, reading, teamLabel } from './trend';
import { withProvisional, CRL_URL } from './crl';
import { GIRONE_URL, appScore } from './results';
import { gameSituations } from './gameStates';
import { matchWeeks } from './availability';
import { playerImpact, benchImpact } from './playerImpact';
import { sheetTotals } from './matchTotals';
import { staffDiscipline, DISCIPLINA_URL } from './staffDiscipline';
import { callupFor, trainingWindow, unexcusedAbsences } from './callup';
import { applyGirone, buildSuggestions, buildScoutInsights, crlForTeam, headToHead, ourForm, sameTeam, sortResults, formOf, teamTitle } from './scouting';
import { teamTrend, performanceReport } from './teamReport';

const MAX_ROUNDS = 8;
const ms = (v) => toDate(v)?.getTime() ?? NaN;
const when = (v) => {
  const d = toDate(v);
  if (!d || Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('it-IT', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
};
const n2 = (x, d = 2) => (x == null || Number.isNaN(x) ? null : Number(x.toFixed(d)));
const pct = (x) => (x == null ? null : `${Math.round(x * 100)}%`);
const short = (name = '') => name.split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');

/**
 * I dati della stagione, letti una volta per conversazione e con i permessi
 * dell'utente (le regole Firestore valgono qui come nelle pagine).
 */
export function createData(club = {}) {
  const season = club.season;
  const since = seasonStart(season);
  const cache = {};
  const once = (key, f) => (cache[key] ||= f().catch((e) => { delete cache[key]; throw e; }));
  const list = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const json = (url) => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const inSeason = (x) => !x.seasonId || x.seasonId === season;
  return {
    club,
    players: () => once('players', async () => sortPlayers(list(await getDocs(query(collection(db, 'players'), where('active', '==', true)))))),
    events: () => once('events', async () => list(await getDocs(query(collection(db, 'events'), where('date', '>=', since)))).filter(inSeason)),
    sheets: () => once('sheets', async () => list(await getDocs(query(collection(db, 'matchStats'), where('date', '>=', since)))).filter(inSeason)),
    callups: () => once('callups', async () => list(await getDocs(query(collection(db, 'callups'), where('matchDate', '>=', since)))).filter(inSeason)),
    lineups: () => once('lineups', async () => list(await getDocs(collection(db, 'lineups')))),
    scouting: () => once('scouting', async () => list(await getDocs(collection(db, 'scouting')))),
    open: (name) => once(name, async () => list(await getDocs(query(collection(db, name), where('status', '==', 'aperto'))))),
    cassa: () => once('cassa', async () => { const s = await getDoc(doc(db, 'config', 'cassa')); return s.exists() ? s.data() : null; }),
    girone: () => once('girone', async () => withProvisional(await json(GIRONE_URL))),
    disciplina: () => once('disciplina', () => json(DISCIPLINA_URL)),
    crl: () => once('crl', () => json(CRL_URL))
  };
}

/* ---------------- gli strumenti ---------------- */

const matchesOf = (events) => events.filter((e) => e.type === 'match');
const trainingsOf = (events) => events.filter((e) => e.type === 'training');
const nameOf = (players) => { const m = Object.fromEntries(players.map((p) => [p.id, p.fullName])); return (id) => m[id] || '?'; };

/** Lo stato di un giocatore in una riga: disponibile, infortunato, squalificato, in diffida. */
function playerStatus(p, ins) {
  const out = [];
  if (p.injury?.active) out.push(`infortunato${p.injury.expectedReturn ? `, rientro previsto ${dayIso(p.injury.expectedReturn)}` : ''}`);
  const susp = [...new Set([...suspendedIn(p), ...(ins?.autoSuspendedIn || [])])];
  if (susp.length) out.push(`squalificato in ${susp.join(' e ')}`);
  if (ins?.diffidaIn?.length) out.push(`in diffida in ${ins.diffidaIn.join(' e ')}`);
  return out.length ? out.join('; ') : 'disponibile';
}

function playerStats(p, ins) {
  const s = p.stats || {};
  return {
    presenze: s.appearances || 0, titolare: s.starts || 0, minuti: s.minutes || 0, gol: s.goals || 0, assist: s.assists || 0,
    ammonizioni: { campionato: ins?.league?.yellow ?? 0, coppa: ins?.cup?.yellow ?? 0 },
    espulsioni: { campionato: ins?.league?.red ?? 0, coppa: ins?.cup?.red ?? 0 },
    allenamenti: s.totalTrainings ? `${s.trainingsAttended || 0} su ${s.totalTrainings} (${ins?.attendancePct ?? 0}%)` : 'nessuna seduta registrata',
    ultimaGara: ins?.lastPlayed ? dayIso(ins.lastPlayed) : null
  };
}

export const TOOL_RUNNERS = {
  async calendario({ quali }, d) {
    const [events, callups] = await Promise.all([d.events(), d.callups()]);
    const now = Date.now();
    const future = quali !== 'passati';
    const list = events.filter((e) => Number.isFinite(ms(e.date)) && (future ? ms(e.date) >= now : ms(e.date) < now) && !e.cancelled)
      .sort((a, b) => (future ? ms(a.date) - ms(b.date) : ms(b.date) - ms(a.date)));
    const rows = list.filter((e) => e.type === 'match').slice(0, 12).map((m) => {
      const c = callupFor(callups, m.id, { drafts: true });
      const sc = appScore(m);
      return {
        data: when(m.date), avversario: m.opponent, competizione: m.competition, dove: m.home === false ? 'trasferta' : 'casa', campo: m.venue || null,
        ritrovo: m.meetingTime ? when(m.meetingTime) : null,
        ...(sc ? { risultato: `${sc.us}-${sc.them} (${sc.us > sc.them ? 'vittoria' : sc.us === sc.them ? 'pareggio' : 'sconfitta'})${m.resultSync?.provisional ? ', provvisorio' : ''}` } : future ? {} : { risultato: 'non registrato' }),
        ...(future ? { convocazione: c ? `${c.status} (${(c.players || []).length} convocati)` : 'da preparare' } : {})
      };
    });
    const sessions = list.filter((e) => e.type === 'training').slice(0, future ? 6 : 5).map((t) => ({
      data: when(t.date), campo: t.venue || null, tema: t.focus || null,
      ...(t.attendanceSummary?.total ? { presenze: `${t.attendanceSummary.present} su ${t.attendanceSummary.total}` } : {})
    }));
    return { partite: rows, allenamenti: sessions, nota: future ? 'ordinati dal più vicino' : 'ordinati dal più recente; amichevoli comprese' };
  },

  async classifica(_, d) {
    const g = await d.girone();
    if (!g?.standing?.rows?.length) return { errore: 'classifica non disponibile' };
    const dash = leagueDashboard(g, d.club.clubName);
    const rows = g.standing.rows.map((r) => ({ pos: r.pos, squadra: teamLabel(r.team), pt: r.pts, g: r.g, v: r.v, n: r.n, p: r.p, gf: r.gf, gs: r.gs }));
    return {
      fonte: g.standing.provisional ? `provvisoria (Tuttocampo), ${g.standing.asOf}` : `ufficiale, ${g.standing.asOf}`,
      classifica: rows,
      lettura: dash && !dash.empty ? reading(dash) : [],
      ...(dash && !dash.empty ? {
        ultimeNostre: dash.games.slice(-5).map((x) => `${x.res} ${x.gf}-${x.ga} ${x.home ? 'vs' : '@'} ${teamLabel(x.opp)}`),
        proiezione: dash.projection ? `${Math.round(dash.projection.final)} punti a fine stagione al ritmo attuale` : null,
        giornate: `${dash.ft.n} giocate su ${dash.league.total}`
      } : {}),
      ...(g.corrections?.length ? { correzioniDalComunicato: g.corrections.slice(-5).map((c) => `${teamLabel(c.home)}-${teamLabel(c.away)}: Tuttocampo ${c.provisional} → ufficiale ${c.official}`) } : {})
    };
  },

  async rosa(_, d) {
    const players = await d.players();
    const ins = buildInsights({ players, club: d.club });
    return {
      giocatori: players.map((p) => ({ nome: p.fullName, ruolo: positionLabel(p.position), reparto: groupOf(p.position), stato: playerStatus(p, ins[p.id]), ...playerStats(p, ins[p.id]) })),
      totale: players.length
    };
  },

  async giocatore({ nome }, d) {
    const [players, sheets, events] = await Promise.all([d.players(), d.sheets(), d.events()]);
    const q = String(nome || '').toLowerCase().trim();
    const found = players.filter((p) => p.fullName.toLowerCase().includes(q));
    if (!found.length) return { errore: `nessun giocatore in rosa corrisponde a «${nome}»`, rosa: players.map((p) => p.fullName) };
    if (found.length > 1 && q.length < 3) return { ambiguo: found.map((p) => p.fullName) };
    const p = found[0];
    const ins = buildInsights({ players: [p], club: d.club })[p.id];
    const byId = Object.fromEntries(events.map((e) => [e.id, e]));
    const last = sheets.filter((s) => s.closed).sort((a, b) => ms(b.date) - ms(a.date)).slice(0, 6).map((s) => {
      const t = sheetTotals(s)[p.id];
      const m = byId[s.eventId || s.id];
      if (!t) return null;
      return { data: dayIso(s.date), avversario: m?.opponent || s.opponent, minuti: t.minutes, titolare: !!t.started, gol: t.goals, assist: t.assists, gialli: t.yellow, rossi: t.red, ...(t.played ? {} : { nota: 'in panchina, non entrato' }) };
    }).filter(Boolean);
    return {
      nome: p.fullName, ruolo: positionLabel(p.position), stato: playerStatus(p, ins), ...playerStats(p, ins),
      diffida: {
        campionato: `${ins.league.counted} ammonizioni che contano, squalifica alla ${ins.league.next}ª (${ins.league.rule})`,
        coppa: `${ins.cup.counted} ammonizioni, squalifica alla ${ins.cup.next}ª (${ins.cup.rule})`
      },
      strisce: { allenamentiDiFila: ins.trainingStreak, titolareDiFila: ins.startStreak },
      ultimePartite: last,
      ...(found.length > 1 ? { altriCorrispondenti: found.slice(1).map((x) => x.fullName) } : {})
    };
  },

  async scheda_gara({ ricerca }, d) {
    const [events, sheets, players] = await Promise.all([d.events(), d.sheets(), d.players()]);
    const name = nameOf(players);
    const q = String(ricerca || '').trim().toLowerCase();
    const played = matchesOf(events).filter((m) => ms(m.date) < Date.now()).sort((a, b) => ms(b.date) - ms(a.date));
    const m = q ? played.find((x) => sameTeam(x.opponent || '', q) || (x.opponent || '').toLowerCase().includes(q) || dayIso(x.date) === q) : played[0];
    if (!m) return { errore: q ? `nessuna partita giocata trovata per «${ricerca}»` : 'nessuna partita giocata' };
    const s = sheets.find((x) => (x.eventId || x.id) === m.id);
    const sc = appScore(m);
    const base = { data: when(m.date), avversario: m.opponent, competizione: m.competition, dove: m.home === false ? 'trasferta' : 'casa', risultato: sc ? `${sc.us}-${sc.them}` : 'non registrato' };
    if (!s) return { ...base, scheda: 'nessuna scheda gara' };
    const minute = (e) => (e.minute == null || e.minute === '' ? '?' : `${e.minute}'`);
    const eventi = [...(s.events || [])].sort((a, b) => (Number(a.minute) || 0) - (Number(b.minute) || 0)).map((e) => {
      if (e.type === 'gol') return `${minute(e)} gol ${e.og ? 'autogol avversario' : name(e.playerId)}${e.cause ? ` (${e.cause})` : ''}`;
      if (e.type === 'gol_subito') return `${minute(e)} gol subito${e.cause ? ` (${e.cause})` : ''}`;
      if (e.type === 'assist') return `${minute(e)} assist ${name(e.playerId)}`;
      if (e.type === 'gialla') return `${minute(e)} ammonizione ${name(e.playerId)}`;
      if (e.type === 'rossa') return `${minute(e)} espulsione ${name(e.playerId)}`;
      if (e.type === 'sostituzione') return `${minute(e)} cambio: esce ${name(e.playerId)}, entra ${name(e.playerInId)}`;
      if (e.type === 'staff') return `${minute(e)} ${e.card === 'rossa' ? 'espulsione' : 'ammonizione'} staff ${e.staffName || ''}`;
      return null;
    }).filter(Boolean);
    return {
      ...base, scheda: s.closed ? 'chiusa' : 'aperta', durata: s.duration || 90,
      titolari: (s.starters || []).map(name), panchina: (s.bench || []).map(name), eventi,
      ...(s.mvp?.playerId ? { migliore: name(s.mvp.playerId) } : {}), ...(s.postNote ? { notaDopoGara: s.postNote } : {})
    };
  },

  async presenze({ ultime }, d) {
    const [events, players] = await Promise.all([d.events(), d.players()]);
    const name = nameOf(players);
    const ins = buildInsights({ players, club: d.club });
    const n = Math.max(1, Math.min(12, Number(ultime) || 4));
    const past = trainingsOf(events).filter((t) => !t.cancelled && ms(t.date) < Date.now() && t.attendanceSummary?.total).sort((a, b) => ms(b.date) - ms(a.date));
    const sedute = past.slice(0, n).map((t) => {
      const a = t.attendanceSummary;
      const by = { assente: [], giustificato: [], infortunato: [] };
      Object.entries(a.absent || {}).forEach(([pid, st]) => (by[st] || by.assente).push(name(pid)));
      return { data: when(t.date), presenti: `${a.present} su ${a.total}`, assenti: by.assente, giustificati: by.giustificato, infortunati: by.infortunato };
    });
    const perc = players.map((p) => ({ nome: p.fullName, presenza: ins[p.id]?.attendancePct, sedute: p.stats?.totalTrainings || 0, diFila: ins[p.id]?.trainingStreak || 0 }))
      .filter((x) => x.sedute > 0).sort((a, b) => (b.presenza || 0) - (a.presenza || 0));
    return { sedute, seduteRegistrateInStagione: past.length, presenzaPerGiocatore: perc, nota: 'la percentuale conta solo le sedute in cui il giocatore era in rosa' };
  },

  async convocazione(_, d) {
    const [events, callups, players] = await Promise.all([d.events(), d.callups(), d.players()]);
    const now = Date.now();
    const next = matchesOf(events).filter((m) => ms(m.date) >= now && !m.cancelled).sort((a, b) => ms(a.date) - ms(b.date))[0];
    if (!next) return { errore: 'nessuna partita in programma' };
    const c = callupFor(callups, next.id, { drafts: true });
    const partita = { data: when(next.date), avversario: next.opponent, competizione: next.competition, dove: next.home === false ? 'trasferta' : 'casa', campo: next.venue || null, ritrovo: next.meetingTime ? when(next.meetingTime) : null };
    if (!c) return { partita, convocazione: 'da preparare (nessuna bozza)' };
    const ins = buildInsights({ players, club: d.club });
    const al = squadAlerts(players, ins, compBucket(next.competition || ''));
    const chosen = players.filter((p) => (c.players || []).includes(p.id));
    const groups = Object.fromEntries(GROUPS.map((g) => [g.label, chosen.filter((p) => groupOf(p.position) === g.key).map((p) => p.fullName)]));
    const week = trainingWindow(next, matchesOf(events), new Date());
    const sessions = week ? trainingsOf(events).filter((t) => !t.cancelled && ms(t.date) >= week.from.getTime() && ms(t.date) < week.to.getTime()) : [];
    const unexcused = unexcusedAbsences(sessions, {});
    const avvisi = [
      ...chosen.filter((p) => p.injury?.active).map((p) => `${p.fullName} convocato ma infortunato`),
      ...al.squalificati.filter((p) => chosen.includes(p)).map((p) => `${p.fullName} convocato ma squalificato per questa competizione`),
      ...al.diffidati.filter((p) => chosen.includes(p)).map((p) => `${p.fullName} in diffida`),
      ...chosen.filter((p) => unexcused[p.id]?.length).map((p) => `${p.fullName}: ${unexcused[p.id].length} assenze non giustificate in settimana`)
    ];
    return {
      partita, stato: c.status, versione: c.version || 1, convocati: (c.players || []).length, perReparto: groups,
      esclusi: players.filter((p) => !chosen.includes(p)).map((p) => `${p.fullName}${p.injury?.active ? ' (infortunato)' : ''}`),
      logistica: c.logistics || null, avvisi
    };
  },

  async disciplina(_, d) {
    const [players, sheets, events, provv] = await Promise.all([d.players(), d.sheets(), d.events(), d.disciplina()]);
    const ins = buildInsights({ players, club: d.club });
    const rows = players.map((p) => ({ p, i: ins[p.id] })).filter(({ p, i }) => i.league.counted || i.cup.counted || suspendedIn(p).length || i.autoSuspendedIn.length);
    const staff = staffDiscipline({ club: d.club, sheets, matches: matchesOf(events), provvedimenti: provv?.provvedimenti || [] });
    return {
      giocatori: rows.map(({ p, i }) => ({
        nome: p.fullName, stato: playerStatus(p, i),
        campionato: `${i.league.yellow} gialli, ${i.league.red} rossi; alla squalifica mancano ${i.league.toSuspension} ammonizioni`,
        coppa: `${i.cup.yellow} gialli, ${i.cup.red} rossi; alla squalifica mancano ${i.cup.toSuspension}`
      })),
      regole: { campionato: ins[players[0]?.id]?.league?.rule || null, coppa: ins[players[0]?.id]?.cup?.rule || null },
      staff: staff.filter((s) => s.active.length || s.comps.campionato.counted || s.comps.coppa.counted).map((s) => ({
        nome: s.name, ruolo: s.roleLabel,
        campionato: `${s.comps.campionato.counted} ammonizioni${s.comps.campionato.diffidato ? ', in diffida' : ''}`,
        coppa: `${s.comps.coppa.counted} ammonizioni${s.comps.coppa.diffidato ? ', in diffida' : ''}`,
        squalifiche: s.suspensions.map((x) => `${x.text}${x.active ? ' (da scontare)' : ' (scontata)'}`)
      }))
    };
  },

  async andamento(_, d) {
    const [events, sheets, players, g] = await Promise.all([d.events(), d.sheets(), d.players(), d.girone()]);
    const matches = matchesOf(events);
    const official = sheets.filter((s) => compBucket(s.competition || matches.find((m) => m.id === (s.eventId || s.id))?.competition || '') !== 'amichevole');
    const sit = gameSituations(matches, official);
    const wk = matchWeeks({ matches, trainings: trainingsOf(events), sheets: official, players, club: d.club });
    const imp = playerImpact(matches, official);
    const bench = benchImpact(matches, official);
    const trend = teamTrend(matches, seasonStart(d.club.season), new Date());
    const perf = trend.rows.length ? performanceReport({ trend, matchStats: official, girone: g, clubName: d.club.clubName, withStanding: false }) : null;
    const dash = g ? leagueDashboard(g, d.club.clubName) : null;
    const name = nameOf(players);
    const rec = (r) => `${r.v}V ${r.n}N ${r.p}P`;
    return {
      lettura: dash && !dash.empty ? reading(dash) : [],
      bilancio: { gare: trend.played, record: `${trend.v}V ${trend.n}N ${trend.p}P`, puntiAPartita: n2(trend.ppg), golFatti: trend.gf, golSubiti: trend.gs, portaInviolata: trend.cleanSheets, casa: n2(trend.home.ppg), trasferta: n2(trend.away.ppg) },
      strisce: perf?.streaks || null,
      situazioni: sit.timed.length ? {
        gareRicostruite: sit.timed.length, minutiInVantaggio: pct(sit.all.pct?.lead), minutiSotto: pct(sit.all.pct?.trail),
        quandoSegniamoPerPrimi: rec(sit.all.first), quandoSegnanoLoroPerPrimi: rec(sit.all.behindFirst),
        puntiPersiDaVantaggio: sit.all.lostFromAhead, puntiPresiDaSotto: sit.all.fromBehind, golUltimi15: `${sit.all.late.for} fatti, ${sit.all.late.against} subiti`
      } : 'servono schede chiuse con il minuto di ogni gol',
      settimana: wk.rows.length ? {
        presenzaMedia: pct(wk.all.pct), indisponibiliAGara: n2(wk.all.out, 1),
        ...(wk.attendance ? { puntiConSettimanaSopraMedia: n2(wk.attendance.above.ppg), puntiConSettimanaSottoMedia: n2(wk.attendance.below.ppg) } : {}),
        ...(wk.absences ? { puntiConPochiIndisponibili: n2(wk.absences.few.ppg), puntiConMoltiIndisponibili: n2(wk.absences.many.ppg) } : {})
      } : null,
      impattoGiocatori: imp.players.filter((p) => p.minutes >= 270 && p.onOff != null).sort((a, b) => b.onOff - a.onOff).map((p) => ({ nome: name(p.pid), minuti: p.minutes, diffReti90ConLui: n2(p.pm90), senzaDiLui: n2(p.off90) })).slice(0, 8),
      panchina: bench.teamGoals ? { golDeiSubentrati: bench.goals, assistDeiSubentrati: bench.assists, quotaGol: pct(bench.share) } : null,
      nota: 'con meno di 10 gare sono segnali, non regole'
    };
  },

  async avversario({ nome }, d) {
    const [events, scouts, g, crl, players] = await Promise.all([d.events(), d.scouting(), d.girone(), d.crl(), d.players()]);
    const matches = matchesOf(events);
    const now = Date.now();
    let q = String(nome || '').trim();
    let match = null;
    if (!q) {
      match = matches.filter((m) => ms(m.date) >= now && !m.cancelled).sort((a, b) => ms(a.date) - ms(b.date))[0];
      if (!match) return { errore: 'nessuna partita in programma: indica il nome della squadra' };
      q = match.opponent || '';
    } else match = matches.filter((m) => ms(m.date) >= now && sameTeam(m.opponent || '', q)).sort((a, b) => ms(a.date) - ms(b.date))[0] || null;
    const saved = scouts.find((s) => sameTeam(s.name || s.id, q)) || { name: q };
    const scout = applyGirone(saved, g);
    const results = sortResults(scout.results || []);
    const f = formOf(results, 5);
    const h2h = headToHead(matches, q);
    const ins = buildScoutInsights(scout, { match, ref: match ? toDate(match.date) : new Date(), h2h });
    const our = buildInsights({ players, club: d.club });
    const al = squadAlerts(players, our, match ? compBucket(match.competition || '') : null);
    const nm = (p) => short(p.fullName);
    const league = matches.filter((m) => compBucket(m.competition || '') === 'campionato');
    const tips = buildSuggestions(scout, { match, us: { form: ourForm(league), diffidati: al.diffidati.map(nm), squalificati: al.squalificati.map(nm) } });
    const c = crlForTeam(crl?.avversari, q, new Date());
    return {
      squadra: teamTitle(scout.name || q),
      ...(match ? { partita: { data: when(match.date), dove: match.home === false ? 'trasferta' : 'casa', competizione: match.competition } } : {}),
      classifica: scout.standing ? { posizione: scout.standing.pos, punti: scout.standing.pts, gare: scout.standing.g, golFatti: scout.standing.gf, golSubiti: scout.standing.gs, fonte: scout.standing.asOf } : null,
      ultimeCinque: results.slice(0, 5).map((r) => `${r.home ? 'vs' : '@'} ${r.against} ${r.gf}-${r.gs}`),
      forma: f.played ? `${f.v}V ${f.n}N ${f.p}P nelle ultime ${f.played}` : null,
      precedenti: h2h.length ? h2h.slice(0, 4).map((x) => `${dayIso(x.date)}: ${x.us}-${x.them}`) : [],
      squalificati: (c?.squalificati || []).map((s) => `${s.nome} (${s.sanzione || 'squalificato'})`),
      diffidati: (c?.diffidati || []).map((s) => s.nome),
      daTenereDOcchio: (scout.players || []).filter((p) => p.key || p.goals >= 3).slice(0, 6).map((p) => `${p.name}${p.goals ? ` (${p.goals} gol)` : ''}${p.note ? `: ${p.note}` : ''}`),
      osservazioni: ins.map((i) => `${i.title}: ${i.text}`),
      suggerimenti: tips.map((t) => `${t.title}: ${t.text}`),
      ...(scout.notes ? { note: scout.notes } : {})
    };
  },

  async cassa(_, d) {
    const [cassa, payments, fines, players] = await Promise.all([d.cassa(), d.open('payments'), d.open('fines'), d.players()]);
    const name = nameOf(players);
    const open = [...payments.map((x) => ({ ...x, tipo: 'quota' })), ...fines.map((x) => ({ ...x, tipo: 'multa' }))];
    const byPlayer = {};
    // Gli importi sono in centesimi, come in tutta l'app.
    open.forEach((x) => { const k = name(x.playerId); (byPlayer[k] ||= []).push(`${x.tipo} ${x.reason || ''} ${euro(x.amount)}${x.dueDate ? ` entro ${dayIso(x.dueDate)}` : ''}`.replace(/\s+/g, ' ').trim()); });
    const total = open.reduce((a, x) => a + (Number(x.amount) || 0), 0);
    return {
      daIncassare: { totale: euro(total), voci: open.length, perGiocatore: byPlayer },
      cassa: cassa ? { raccolti: euro(cassa.collected), ancoraDaVersare: euro(cassa.open), multeInStagione: cassa.count || 0 } : null
    };
  }
};

/** Esegue uno strumento richiesto dal modello; un errore torna come risultato, non ferma la conversazione. */
export async function runTool(name, input, data) {
  const f = TOOL_RUNNERS[name];
  if (!f) return { content: `strumento sconosciuto: ${name}`, is_error: true };
  try {
    return { content: JSON.stringify(await f(input || {}, data)) };
  } catch (e) {
    return { content: `errore nel leggere i dati: ${String(e?.message || e)}`, is_error: true };
  }
}

const ERRORS = {
  401: 'Accesso scaduto: esci e rientra.',
  403: "L'assistente è disponibile solo all'amministratore.",
  503: "L'assistente non è configurato: manca la chiave del servizio in Cloudflare."
};

async function call(messages, context) {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch('/api/assistente', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages, context })
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(ERRORS[res.status] || out.message || `Assistente non raggiungibile (${res.status})`);
  return out;
}

/**
 * Una domanda in più nella conversazione: manda i messaggi al worker, esegue
 * gli strumenti che il modello chiede e ripete finché arriva una risposta.
 * `onStatus(nomiStrumenti)` dice cosa sta guardando. Restituisce la
 * conversazione aggiornata (con i blocchi degli strumenti, che servono al
 * modello per i turni dopo) e il testo della risposta.
 */
export async function ask({ history = [], question, context, data, onStatus = () => {} }) {
  const messages = [...history, { role: 'user', content: question }];
  const used = [];
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const out = await call(messages, context);
    messages.push({ role: 'assistant', content: out.content });
    const calls = out.content.filter((b) => b.type === 'tool_use');
    if (out.stop_reason !== 'tool_use' || !calls.length) {
      const text = out.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { messages, text: text || 'Non ho trovato nulla da dire su questo.', tools: used };
    }
    calls.forEach((c) => { if (!used.includes(c.name)) used.push(c.name); });
    onStatus(used);
    const results = await Promise.all(calls.map(async (c) => ({ type: 'tool_result', tool_use_id: c.id, ...(await runTool(c.name, c.input, data)) })));
    messages.push({ role: 'user', content: results });
  }
  return { messages, text: 'Ho fatto troppi passaggi senza arrivare a una risposta: prova con una domanda più precisa.', tools: used };
}

/** La dettatura del browser (Web Speech API), se c'è. Su iPhone resta il microfono della tastiera. */
export function speechRecognition() {
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  return SR ? new SR() : null;
}

export const SUGGESTIONS = [
  'Come stiamo andando?',
  'Chi è in diffida per la prossima partita?',
  'Chi ha saltato allenamenti questa settimana?',
  'Com\'è messo il prossimo avversario?',
  'La convocazione è pronta?',
  'Quanto c\'è ancora da incassare?'
];
