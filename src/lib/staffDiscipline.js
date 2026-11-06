// Disciplina dello staff: allenatori, dirigenti, preparatori, massaggiatori,
// medici e assistente arbitro di parte. I cartellini si segnano nella scheda
// gara (in campionato il comunicato pubblica le ammonizioni dello staff solo
// dalla diffida in poi); giornate e scadenze delle squalifiche arrivano dai
// comunicati CRL (public/data/disciplina.json, da scripts/crl_disciplina.py).
// Regole dei giocatori: stesse soglie, campionato e coppa non fanno cumulo,
// le amichevoli non contano.

import { useEffect, useMemo, useState } from 'react';
import { compBucket, thresholdAfter, thresholdsText } from './discipline';
import { thresholds } from './insights';
import { seasonStart, dayIso } from './format';
import { useCollection, where } from './db';

export { dayIso };

export const DISCIPLINA_URL = '/data/disciplina.json';

/** Ruoli sul referto e nei comunicati. */
export const STAFF_ROLES = {
  allenatore: 'Allenatore',
  dirigente: 'Dirigente',
  preparatore: 'Preparatore',
  massaggiatore: 'Massaggiatore',
  medico: 'Medico',
  assistente: 'Assistente arbitro'
};

/** Sigle per le etichette strette (Home). */
export const ROLE_SHORT = { allenatore: 'all.', dirigente: 'dir.', preparatore: 'prep.', massaggiatore: 'mass.', medico: 'med.', assistente: 'ass. arb.' };

/** Impostazioni › Staff: le persone della società e il loro ruolo. */
export const CLUB_STAFF = {
  head_coach: { role: 'allenatore', label: 'Allenatore' },
  assistant_coach: { role: 'allenatore', label: 'Vice allenatore' },
  team_manager: { role: 'dirigente', label: 'Dirigente accompagnatore' },
  athletic_trainer: { role: 'preparatore', label: 'Preparatore atletico' },
  gk_coach: { role: 'preparatore', label: 'Preparatore portieri' }
};

const COMP_KEYS = ['campionato', 'coppa'];

const tokensOf = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z]+/).filter((t) => t.length > 1);

/** «PUGLIESE LUCA» e «Luca Pugliese» sono la stessa persona; un secondo nome in più non cambia nulla. */
export function samePerson(a = '', b = '') {
  const ta = tokensOf(a), tb = new Set(tokensOf(b));
  if (!ta.length || !tb.size) return false;
  const common = ta.filter((t) => tb.has(t)).length;
  const shorter = Math.min(ta.length, tb.size);
  return common === shorter && (common >= 2 || (ta.length === 1 && tb.size === 1));
}

/** Le persone dello staff scritte in Impostazioni, per sceglierle al volo. */
export const staffOptions = (club = {}) => Object.entries(CLUB_STAFF)
  .map(([k, r]) => ({ k, name: club.staff?.[k]?.trim() || '', ...r }))
  .filter((o) => o.name);

/** La persona di Impostazioni che corrisponde al nome scritto sul referto («PUGLIESE L.» compreso). */
export function matchStaff(name = '', options = []) {
  const want = tokensOf(name);
  if (!want.length) return null;
  return options.find((o) => samePerson(o.name, name))
    || options.find((o) => { const have = new Set(tokensOf(o.name)); return want.every((t) => have.has(t)); })
    || null;
}

/** Qualifica scritta sul referto → ruolo. */
export function roleFromText(s) {
  // Dal referto un campo non scritto arriva come null.
  const t = String(s || '').toLowerCase();
  if (/allen|tecnic|mister/.test(t)) return 'allenatore';
  if (/massagg|fisio/.test(t)) return 'massaggiatore';
  if (/medic/.test(t)) return 'medico';
  if (/assist|guardalin|bandier/.test(t)) return 'assistente';
  if (/prepar/.test(t)) return 'preparatore';
  if (/dirig|accomp|team/.test(t)) return 'dirigente';
  return '';
}

/** Nomi dei comunicati in maiuscolo → «Pugliese Luca». */
const display = (name = '') => (/[a-z]/.test(name) ? name.trim() : name.trim().toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()));

const fmtDay = (iso = '') => iso.split('-').reverse().join('/');

/** Il provvedimento in una riga: «2ª ammonizione · diffida», «Squalifica per 1 gara (2ª ammonizione)». */
export function provvedimentoText(v) {
  if (v.tipo === 'ammonizione') return `${v.infrazione ? `${v.infrazione}ª ammonizione` : 'Ammonizione'}${v.diffida ? ' · diffida' : ''}`;
  const what = v.tipo === 'inibizione' ? 'Inibizione' : 'Squalifica';
  if (v.fino) return `${what} fino al ${fmtDay(v.fino)}`;
  const n = v.gare || 1;
  const why = /RECIDIV/.test(v.titolo || '') && v.infrazione ? ` (${v.infrazione}ª ammonizione)` : '';
  return `${what} per ${n} ${n === 1 ? 'gara' : 'gare'}${why}`;
}

/**
 * Gare ufficiali già giocate per competizione (giorni, in ordine): schede chiuse
 * e partite con il risultato registrato, anche senza scheda. Ogni gara giocata
 * dopo il comunicato sconta una giornata.
 */
function playedDays(sheets, matches, today) {
  const byId = new Map();
  matches.filter((m) => m.type === 'match' && m.scoreHome != null && m.scoreAway != null)
    .forEach((m) => byId.set(m.id, { comp: m.competition, day: dayIso(m.date) }));
  sheets.filter((s) => s.closed).forEach((s) => {
    const id = s.eventId || s.id;
    byId.set(id, { comp: s.competition || byId.get(id)?.comp || '', day: dayIso(s.date) || byId.get(id)?.day });
  });
  const out = { campionato: [], coppa: [] };
  byId.forEach(({ comp, day }) => { const b = compBucket(comp || ''); if (out[b] && day && day <= today) out[b].push(day); });
  COMP_KEYS.forEach((b) => out[b].sort());
  return out;
}

/**
 * Lo staff con ammonizioni, diffide, squalifiche e storico. `sheets`: schede gara
 * della stagione (contano quelle chiuse); `matches`: partite (per le giornate
 * scontate); `provvedimenti`: voci di disciplina.json; `club`: staff e soglie.
 */
export function staffDiscipline({ club = {}, sheets = [], matches = [], provvedimenti = [], today = dayIso(new Date()) } = {}) {
  const rules = thresholds(club);
  const people = [];
  const add = (name, role, roleLabel, fromClub = false) => {
    let p = people.find((x) => samePerson(x.name, name));
    if (!p) {
      p = { name: display(name), role, roleLabel: roleLabel || STAFF_ROLES[role] || 'Staff', fromClub, cards: { campionato: [], coppa: [] }, cu: [] };
      people.push(p);
    } else if (fromClub && !p.fromClub) Object.assign(p, { name: display(name), role, roleLabel, fromClub });
    return p;
  };
  // Prima Impostazioni: nome scritto bene e ruolo della società.
  Object.entries(CLUB_STAFF).forEach(([k, r]) => { const n = club.staff?.[k]; if (n?.trim()) add(n, r.role, r.label, true); });

  const compOf = Object.fromEntries(matches.map((m) => [m.id, m.competition || '']));
  sheets.filter((s) => s.closed).forEach((s) => {
    const comp = compBucket(s.competition || compOf[s.eventId || s.id] || '');
    if (!COMP_KEYS.includes(comp)) return;
    const day = dayIso(s.date);
    const mine = {};
    (s.events || []).filter((e) => e.type === 'staff' && e.staffName?.trim()).forEach((e) => {
      const p = add(e.staffName, e.staffRole);
      const k = people.indexOf(p);
      mine[k] ||= { p, y: 0, r: 0 };
      if (e.card === 'rossa') mine[k].r += 1; else mine[k].y += 1;
    });
    Object.values(mine).forEach(({ p, y, r }) => p.cards[comp].push({ day, y, r, opponent: s.opponent || '' }));
  });
  provvedimenti.filter((v) => v.ruolo && v.ruolo !== 'calciatore' && v.nome && COMP_KEYS.includes(v.competizione))
    .forEach((v) => add(v.nome, v.ruolo).cu.push(v));

  const played = playedDays(sheets, matches, today);
  return people.map((p) => {
    const suspensions = [];
    p.cu.filter((v) => v.tipo !== 'ammonizione').forEach((v) => {
      const base = { source: 'comunicato', kind: v.tipo, gara: v.gara, date: v.pubblicato, doc: v.doc, url: v.url, text: provvedimentoText(v) };
      // Squalifica a tempo e inibizione valgono per ogni gara fino alla data.
      if (v.fino) { suspensions.push({ ...base, comp: null, until: v.fino, active: today <= v.fino }); return; }
      const games = v.gare || 1;
      const served = played[v.competizione].filter((d) => d > (v.pubblicato || '')).length;
      suspensions.push({ ...base, comp: v.competizione, games, left: Math.max(0, games - served), active: served < games });
    });

    const comps = {};
    COMP_KEYS.forEach((comp) => {
      const list = comp === 'coppa' ? rules.cup : rules.league;
      const cu = p.cu.filter((v) => v.competizione === comp && v.infrazione);
      // Le ammonizioni del comunicato fanno da base: la scheda può non averle tutte.
      const cuBefore = (day) => Math.max(0, ...cu.filter((v) => (v.gara || '') < day).map((v) => v.infrazione));
      let counted = 0, trigger = null;
      const hist = [...p.cards[comp]].sort((a, b) => (a.day || '').localeCompare(b.day || ''));
      hist.forEach((h) => {
        counted = Math.max(counted, cuBefore(h.day || ''));
        // Espulsione (anche per doppia ammonizione): le ammonizioni di quella gara non fanno cumulo.
        if (h.r > 0 || h.y >= 2) { trigger = { day: h.day, why: 'espulsione' }; return; }
        const at = thresholdAfter(list, counted);
        counted += h.y;
        if (counted >= at) trigger = { day: h.day, why: `${at}ª ammonizione` };
      });
      counted = Math.max(counted, ...cu.map((v) => v.infrazione));
      // Squalifica automatica dalla scheda, finché non c'è la gara per scontarla o la decisione del comunicato.
      if (trigger && !played[comp].some((d) => d > trigger.day)
        && !suspensions.some((s) => s.gara === trigger.day)) {
        suspensions.push({ source: 'scheda', kind: 'squalifica', comp, games: 1, left: 1, active: true, gara: trigger.day, date: trigger.day, text: `Squalifica automatica (${trigger.why})` });
      }
      const next = thresholdAfter(list, counted);
      const blocked = suspensions.some((s) => s.active && s.comp === comp);
      comps[comp] = {
        yellow: hist.reduce((a, h) => a + h.y, 0), red: hist.reduce((a, h) => a + h.r, 0),
        counted, next, toSuspension: next - counted, rule: thresholdsText(list),
        diffidato: !blocked && counted > 0 && next - counted === 1
      };
    });

    const log = [
      ...COMP_KEYS.flatMap((comp) => p.cards[comp].map((h) => ({
        day: h.day, comp, icon: h.r || h.y >= 2 ? '🟥' : '🟨',
        text: `${h.r ? 'Espulsione' : h.y >= 2 ? 'Doppia ammonizione (espulsione)' : 'Ammonizione'}${h.opponent ? ` con ${h.opponent}` : ''}`
      }))),
      ...p.cu.map((v) => ({ day: v.pubblicato, comp: v.competizione, icon: v.tipo === 'ammonizione' ? '🟨' : '🟥', text: provvedimentoText(v), doc: v.doc, url: v.url }))
    ].sort((a, b) => (b.day || '').localeCompare(a.day || ''));

    suspensions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return { name: p.name, role: p.role, roleLabel: p.roleLabel, fromClub: p.fromClub, comps, suspensions, active: suspensions.filter((s) => s.active), log };
  }).sort((a, b) => (b.active.length - a.active.length)
    || (COMP_KEYS.some((c) => b.comps[c].diffidato) - COMP_KEYS.some((c) => a.comps[c].diffidato))
    || (b.comps.campionato.counted + b.comps.coppa.counted - a.comps.campionato.counted - a.comps.coppa.counted)
    || (b.fromClub - a.fromClub) || a.name.localeCompare(b.name, 'it'));
}

/**
 * Staff che non può andare in panchina, o in diffida, per una gara di quella
 * competizione in quel giorno. Senza competizione: in almeno una, oppure solo in
 * quelle di `upcoming` (le competizioni con partite in programma: una squalifica
 * di coppa dopo l'eliminazione non è un avviso da Home).
 */
export function staffAlerts(people = [], bucket = null, day = null, upcoming = null) {
  const relevant = (comp) => (bucket ? comp === bucket : !upcoming || upcoming.includes(comp));
  const applies = (s) => s.active && (s.comp == null ? !day || s.until >= day : relevant(s.comp));
  const squalificati = people.filter((p) => p.suspensions.some(applies)).map((p) => ({ person: p, list: p.suspensions.filter(applies) }));
  // La diffida vale dove non c'è già una squalifica: squalificato in coppa e in
  // diffida in campionato sono due avvisi; fermo «fino al» copre tutto.
  const diffidati = people.filter((p) => !p.suspensions.some((s) => s.comp == null && applies(s)))
    .map((p) => ({ person: p, comps: COMP_KEYS.filter((c) => relevant(c) && p.comps[c]?.diffidato) }))
    .filter((x) => x.comps.length);
  return { squalificati, diffidati };
}

/** Il file dei provvedimenti dai comunicati: si legge e basta, lo aggiorna la GitHub Action. */
export function useDisciplina(enabled = true) {
  const [state, setState] = useState({ data: null, loading: enabled, error: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    fetch(DISCIPLINA_URL, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState({ data: null, loading: false, error }));
    return () => { alive = false; };
  }, [enabled]);
  return state;
}

/**
 * Disciplina dello staff per una pagina: schede e partite della stagione e
 * comunicati si leggono qui. Tutte le partite, non solo le recenti: una gara
 * con il risultato ma senza scheda chiusa deve continuare a contare come scontata.
 */
export function useStaffDiscipline({ club, enabled = true }) {
  const { data: file } = useDisciplina(enabled);
  const sheetsQ = useMemo(() => [where('date', '>=', seasonStart(club?.season))], [club?.season]);
  const { data: sheets } = useCollection('matchStats', sheetsQ, enabled);
  const matchesQ = useMemo(() => [where('type', '==', 'match'), where('seasonId', '==', club?.season || '')], [club?.season]);
  const { data: matches } = useCollection('events', matchesQ, enabled);
  return useMemo(
    () => (enabled ? staffDiscipline({ club, sheets, matches, provvedimenti: file?.provvedimenti || [] }) : []),
    [enabled, club, sheets, matches, file]
  );
}
