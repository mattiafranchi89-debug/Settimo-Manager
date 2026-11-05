import { Badge } from './ui';
import { COMPS, suspendedIn } from '../lib/discipline';

/**
 * Cartellini e stato disciplinare, una riga per competizione: campionato e
 * Coppa Lombardia non fanno cumulo e hanno soglie diverse.
 */
export default function DisciplineRows({ player, insight }) {
  if (!insight) return null;
  const manual = suspendedIn(player);
  return (
    <div className="stack" style={{ gap: 6 }}>
      {[['campionato', insight.league], ['coppa', insight.cup]].map(([key, d]) => {
        const suspended = manual.includes(key) || insight.autoSuspendedIn?.includes(key);
        const status = suspended
          ? <Badge tone="purple">{d.pending && !manual.includes(key) ? `Squalificato · ${d.pending.why}` : 'Squalificato'}</Badge>
          : insight.diffidaIn?.includes(key)
            ? <Badge tone="orange">In diffida</Badge>
            : <Badge tone="grey">{d.yellow ? `${d.toSuspension} alla squalifica` : 'Pulito'}</Badge>;
        return (
          <div key={key} className="spread" style={{ fontSize: 14 }}>
            <span>
              <b>{COMPS[key].label}</b>
              <span style={{ color: 'var(--muted)', marginLeft: 8 }}>🟨 {d.yellow} · 🟥 {d.red}</span>
              <small style={{ display: 'block', color: 'var(--muted)' }}>squalifica {d.rule} o dopo un'espulsione</small>
            </span>
            {status}
          </div>
        );
      })}
    </div>
  );
}

const fmtDay = (iso = '') => iso.slice(0, 10).split('-').reverse().join('/');
const left = (s) => (s.left === 1 ? '1 gara da scontare' : `${s.left} gare da scontare`);

/**
 * Staff: una scheda per persona con ammonizioni e stato per competizione,
 * squalifiche a tempo e gli ultimi provvedimenti (con il comunicato).
 */
export function StaffDiscipline({ people = [] }) {
  if (!people.length) return <p><small>Nessuno staff in Impostazioni e nessun provvedimento nei comunicati.</small></p>;
  return (
    <div className="stack" style={{ gap: 14 }}>
      {people.map((p) => {
        const timed = p.active.filter((s) => s.comp == null);
        return (
          <div key={p.name} style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
            <div className="spread" style={{ fontSize: 14.5 }}>
              <b>{p.name}</b>
              <small style={{ color: 'var(--muted)' }}>{p.roleLabel}</small>
            </div>
            {timed.map((s) => (
              <div key={`${s.doc}-${s.until}`} style={{ marginTop: 6 }}>
                <Badge tone="purple">{s.kind === 'inibizione' ? 'Inibito' : 'Squalificato'} fino al {fmtDay(s.until)} · ogni gara</Badge>
              </div>
            ))}
            <div className="stack" style={{ gap: 4, marginTop: 6 }}>
              {['campionato', 'coppa'].map((key) => {
                const d = p.comps[key];
                const susp = p.active.find((s) => s.comp === key);
                const status = susp
                  ? <Badge tone="purple">{susp.source === 'scheda' ? `Squalificato · ${susp.text.replace(/^Squalifica automatica \((.*)\)$/, '$1')}` : `Squalificato · ${left(susp)}`}</Badge>
                  : d.diffidato
                    ? <Badge tone="orange">In diffida</Badge>
                    : <Badge tone="grey">{d.counted ? `${d.toSuspension} alla squalifica` : 'Pulito'}</Badge>;
                return (
                  <div key={key} className="spread" style={{ fontSize: 13.5 }}>
                    <span><b>{COMPS[key].label}</b><span style={{ color: 'var(--muted)', marginLeft: 8 }}>🟨 {d.counted} · 🟥 {d.red}</span></span>
                    {status}
                  </div>
                );
              })}
            </div>
            {p.log.slice(0, 3).map((l, i) => (
              <div key={i} style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
                {fmtDay(l.day || '')} · {l.icon} {l.text} · {COMPS[l.comp]?.short || l.comp}
                {l.doc && <> · {l.url ? <a href={l.url} target="_blank" rel="noreferrer">{l.doc.replace('Comunicato Ufficiale', 'CU')}</a> : l.doc}</>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** «Pugliese Luca (allenatore, 1 gara da scontare in Coppa Lombardia)» per gli avvisi. */
export function staffAlertText(list = []) {
  return list.map(({ person, list: s = [] }) => {
    const x = s[0];
    const where = x?.comp ? ` in ${COMPS[x.comp]?.label || x.comp}` : '';
    const why = !x ? '' : x.comp == null ? `fino al ${fmtDay(x.until)}` : `${x.source === 'scheda' ? x.text.toLowerCase() : left(x)}${where}`;
    return `${person.name} (${person.roleLabel.toLowerCase()}${why ? `, ${why}` : ''})`;
  }).join('; ');
}
