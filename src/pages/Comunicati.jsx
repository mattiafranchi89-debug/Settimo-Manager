import { useMemo, useState } from 'react';
import { Card, Badge, Empty, Loading, Alert } from '../components/ui';
import { useCrl, sortCrl, CRL_TYPES, fmtIso, CrlItem } from '../lib/crl';

/**
 * Cosa dicono di noi i comunicati del Comitato Regionale Lombardia:
 * risultati, squalifiche, variazioni di orario, sorteggi di coppa.
 * Il file viene aggiornato ogni due giorni in automatico.
 */
export default function Comunicati() {
  const { data, loading, error } = useCrl();
  const [type, setType] = useState('');
  const items = useMemo(() => sortCrl(data?.items || []).filter((i) => !type || i.type === type), [data, type]);

  if (loading) return <Loading />;

  // Raggruppati per comunicato, nell'ordine in cui sono usciti.
  const groups = [];
  items.forEach((i) => {
    const key = `${i.date}|${i.doc}`;
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, doc: i.doc, date: i.date, url: i.url, items: [] }));
    g.items.push(i);
  });
  const types = [...new Set((data?.items || []).map((i) => i.type))];
  // Squalificati e diffidati delle prossime avversarie (campionato e coppa):
  // solo le partite ancora da giocare.
  const today = new Date().toISOString().slice(0, 10);
  const opponents = (data?.avversari || []).filter((o) => o?.squadra && (!o.data || o.data >= today));

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Comunicati CRL</h1>
          <p>Dove compare il Settimo Milanese, più gli squalificati della prossima avversaria{data?.lastChecked ? ` · controllati il ${fmtIso(data.lastChecked)}` : ''}</p>
        </div>
      </div>

      {error && <Alert level="error">Non riesco a leggere gli estratti dei comunicati ({error.message}).</Alert>}

      {types.length > 1 && (
        <div className="chiprow" style={{ marginBottom: 12 }}>
          <button className={`chip ${!type ? 'chip--on' : ''}`} onClick={() => setType('')}>Tutti</button>
          {types.map((t) => (
            <button key={t} className={`chip ${type === t ? 'chip--on' : ''}`} onClick={() => setType(t)}>
              {CRL_TYPES[t]?.icon} {CRL_TYPES[t]?.label || t}
            </button>
          ))}
        </div>
      )}

      {opponents.map((o) => <OpponentCard key={`${o.squadra}|${o.data}`} o={o} />)}

      {!groups.length && !error && (
        <Card><Empty title="Nessuna citazione">Negli ultimi comunicati controllati il Settimo Milanese non compare.</Empty></Card>
      )}

      {groups.map((g) => (
        <Card key={g.key} title={g.doc} action={<Badge tone="grey">{fmtIso(g.date)}</Badge>}>
          <div className="stack">
            {g.items.map((i) => <CrlItem key={i.id} item={i} />)}
          </div>
          {g.url && (
            <a href={g.url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 10, fontSize: 13.5 }}>
              Apri il comunicato ↗
            </a>
          )}
        </Card>
      ))}

      <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 12 }}>
        Estratti automatici dal sito del CRL: per squalifiche e orari fa fede il comunicato originale.
      </p>
    </>
  );
}

/** Prossima avversaria: chi non potrà giocare contro di noi secondo i comunicati. */
function OpponentCard({ o }) {
  const squalificati = o.squalificati || [];
  const diffidati = o.diffidati || [];
  return (
    <Card title={`🟥 Squalificati · ${o.squadra}`} action={o.data && <Badge tone="red">{fmtIso(o.data)}</Badge>}>
      {o.partita && <p style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 0 }}>{o.partita}</p>}
      {squalificati.length ? (
        <div className="stack" style={{ gap: 6 }}>
          {squalificati.map((x, i) => (
            <div key={i} style={{ fontSize: 14.5 }}>
              <b>{x.nome}</b>{x.ruolo && x.ruolo !== 'calciatore' ? ` (${x.ruolo})` : ''} · {x.sanzione}
              {x.competizione === 'coppa' ? ' · Coppa' : ''}
              <small style={{ display: 'block', color: 'var(--muted)' }}>
                {x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer">{x.doc}</a> : x.doc}{x.date ? ` · ${fmtIso(x.date)}` : ''}
              </small>
            </div>
          ))}
        </div>
      ) : <p style={{ fontSize: 14, margin: 0 }}>Nessuno squalificato nei comunicati delle ultime settimane.</p>}
      {diffidati.length > 0 && (
        <p style={{ fontSize: 13.5, marginBottom: 0 }}>⚠️ Diffidati: {diffidati.map((x) => x.nome).join(', ')}</p>
      )}
      <small style={{ display: 'block', marginTop: 8, color: 'var(--muted)' }}>
        Squalifiche a giornate: valgono finché la squadra non ha giocato quelle gare, controlla il comunicato.
        {o.aggiornato ? ` Aggiornato il ${fmtIso(o.aggiornato)}.` : ''}
      </small>
    </Card>
  );
}
