import { useEffect, useRef, useState } from 'react';
import { useClub } from '../lib/db';
import { Card, Alert, Empty, Loading } from '../components/ui';

const TABS = [
  { key: 'Risultati', label: 'Risultati', height: 600 },
  { key: 'Classifica', label: 'Classifica', height: 800 },
  { key: 'Marcatori', label: 'Marcatori', height: 700 }
];

const WIDGET_WIDTH = 500;

/**
 * Tuttocampo widgets are a fixed 500px wide. Rather than let them be cropped
 * on a phone, we scale the whole frame down and shrink the container to match.
 */
function ScaledFrame({ src, height, title }) {
  const wrap = useRef(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setScale(Math.min(1, el.clientWidth / WIDGET_WIDTH));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrap} style={{ width: '100%', overflow: 'hidden', height: height * scale }}>
      <iframe
        src={src}
        title={title}
        width={WIDGET_WIDTH}
        height={height}
        loading="lazy"
        scrolling="no"
        frameBorder="0"
        style={{ border: 0, transform: `scale(${scale})`, transformOrigin: 'top left', display: 'block' }}
      />
    </div>
  );
}

export default function Campionato() {
  const { club, loading } = useClub();
  const [tab, setTab] = useState('Risultati');
  const id = club.tuttocampoId;

  if (loading) return <Loading />;

  const active = TABS.find((t) => t.key === tab);

  return (
    <>
      <div className="pagehead">
        <div><h1>Campionato</h1><p>Dati ufficiali del girone, aggiornati da Tuttocampo</p></div>
      </div>

      {!id ? (
        <Card>
          <Empty title="Widget non configurato">
            Inserisci il codice del girone in Impostazioni → Campionato. Lo trovi nell'indirizzo dei widget di Tuttocampo.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="chiprow">
            {TABS.map((t) => (
              <button key={t.key} className={`chip ${tab === t.key ? 'chip--on' : ''}`} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          <Card>
            <ScaledFrame
              key={tab}
              src={`https://www.tuttocampo.it/WidgetV2/${active.key}/${id}`}
              height={active.height}
              title={active.label}
            />
          </Card>

          <Alert level="info">
            Classifica, risultati e marcatori arrivano da Tuttocampo e riguardano tutto il girone. Le statistiche della sezione Statistiche restano quelle interne, calcolate dalle schede gara.
          </Alert>
        </>
      )}
    </>
  );
}
