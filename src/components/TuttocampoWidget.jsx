import { useEffect, useRef, useState } from 'react';

// Widget ufficiali di Tuttocampo: si caricano nel telefono di chi guarda,
// direttamente dal sito, senza che l'app copi o salvi i loro dati.

const WIDGET_WIDTH = 500;

/**
 * Tuttocampo widgets are a fixed 500px wide. Rather than let them be cropped
 * on a phone, we scale the whole frame down and shrink the container to match.
 */
export function ScaledFrame({ src, height, title }) {
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


export const widgetUrl = (key, id) => `https://www.tuttocampo.it/WidgetV2/${key}/${id}`;
