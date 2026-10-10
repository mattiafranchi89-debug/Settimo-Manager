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
              <small style={{ display: 'block', color: 'var(--muted)' }}>squalifica ogni {d.per} ammonizioni o dopo un'espulsione</small>
            </span>
            {status}
          </div>
        );
      })}
    </div>
  );
}
