import { useEffect, useRef, useState } from 'react';

/**
 * Salvataggio automatico: quando `key` (lo stato serializzato) cambia rispetto
 * all'ultimo salvato, aspetta `delay` ms di calma e chiama `save()`.
 * Restituisce lo stato da mostrare e `pending` (modifiche non ancora scritte),
 * che serve a non sovrascrivere ciò che si sta modificando con i dati in arrivo.
 */
export function useAutosave({ key, savedKey, save, enabled = true, delay = 1200 }) {
  const [status, setStatus] = useState({ state: 'idle', at: null, error: null });
  const timer = useRef(null);
  const inFlight = useRef(false);
  const latest = useRef(save);
  latest.current = save;

  const pending = enabled && key !== savedKey;

  const run = async () => {
    if (inFlight.current) { timer.current = setTimeout(run, 400); return; }
    inFlight.current = true;
    setStatus((s) => ({ ...s, state: 'saving' }));
    try {
      await latest.current();
      setStatus({ state: 'saved', at: new Date(), error: null });
    } catch (e) {
      setStatus({ state: 'error', at: null, error: e });
    }
    inFlight.current = false;
  };

  useEffect(() => {
    if (!pending) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(run, delay);
    return () => clearTimeout(timer.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pending]);

  // Prima di chiudere la pagina con modifiche in sospeso, si salva subito.
  useEffect(() => {
    if (!pending) return undefined;
    const flush = () => { clearTimeout(timer.current); run(); };
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  return { ...status, pending, retry: run };
}

/** Piccola etichetta di stato: «Salvato alle 21:40», «Salvataggio…», errore con «Riprova». */
export function AutosaveBadge({ status }) {
  const style = { fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' };
  if (status.state === 'error') {
    return (
      <button onClick={status.retry} style={{ ...style, color: 'var(--red)', background: 'none', border: 0, cursor: 'pointer' }}>
        ⚠️ Non salvato · Riprova
      </button>
    );
  }
  if (status.state === 'saving' || status.pending) return <span style={{ ...style, color: 'var(--muted)' }}>Salvataggio…</span>;
  if (status.at) {
    const t = status.at.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    return <span style={{ ...style, color: 'var(--green)' }}>✓ Salvato alle {t}</span>;
  }
  return <span style={{ ...style, color: 'var(--muted)' }}>Salvataggio automatico</span>;
}
