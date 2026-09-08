import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export const Card = ({ title, action, children, className = '' }) => (
  <section className={`card ${className}`}>
    {(title || action) && (
      <div className="card__head">
        {title && <h2>{title}</h2>}
        {action}
      </div>
    )}
    {children}
  </section>
);

export const Kpi = ({ value, label, accent = false, tone }) => (
  <div className={`kpi ${accent ? 'kpi--accent' : ''}`}>
    <div className="kpi__value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
    <div className="kpi__label">{label}</div>
  </div>
);

export const Button = ({ variant = 'primary', size, block, as: As = 'button', children, ...rest }) => (
  <As className={`btn btn--${variant} ${size === 'sm' ? 'btn--sm' : ''} ${block ? 'btn--block' : ''}`} {...rest}>
    {children}
  </As>
);

export const Field = ({ label, hint, error, children }) => (
  <div className="field">
    {label && <label>{label}</label>}
    {children}
    {hint && !error && <div className="field__hint">{hint}</div>}
    {error && <div className="field__error">{error}</div>}
  </div>
);

export const Input = (props) => <input className="input" {...props} />;
export const Textarea = (props) => <textarea className="textarea" {...props} />;
export const Select = ({ options = [], children, ...rest }) => (
  <select className="select" {...rest}>
    {children || options.map((o) => (
      <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
    ))}
  </select>
);

export const Badge = ({ tone = 'grey', children }) => <span className={`badge badge--${tone}`}>{children}</span>;

export const Alert = ({ level = 'info', children }) => (
  <div className={`alert alert--${level}`}>
    <span aria-hidden="true">{level === 'error' ? '⛔' : level === 'warn' ? '⚠️' : level === 'ok' ? '✅' : 'ℹ️'}</span>
    <div>{children}</div>
  </div>
);

export const Empty = ({ title, children, action }) => (
  <div className="empty">
    <h3>{title}</h3>
    {children && <p>{children}</p>}
    {action}
  </div>
);

export const Loading = () => <div className="spinner" role="status" aria-label="Caricamento" />;

export function Sheet({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet__head">
          <h2>{title}</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Chiudi">✕</button>
        </div>
        {children}
        {footer && <div className="btnrow" style={{ marginTop: 16 }}>{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Conferma', destructive, onConfirm, onClose, requireReason }) {
  const [reason, setReason] = useState('');
  return (
    <Sheet title={title} onClose={onClose}>
      <p>{message}</p>
      {requireReason && (
        <Field label="Motivazione (registrata nel log)" hint="Obbligatoria per procedere.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Es. portiere di riserva indisponibile, scelta tecnica…" />
        </Field>
      )}
      <div className="btnrow">
        <Button variant={destructive ? 'danger' : 'primary'} disabled={requireReason && reason.trim().length < 5}
          onClick={() => { onConfirm(reason.trim()); onClose(); }}>
          {confirmLabel}
        </Button>
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
      </div>
    </Sheet>
  );
}

/* ---------- toast ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div style={{ position: 'fixed', left: 12, right: 12, bottom: 'calc(var(--tabbar-h) + 74px)', zIndex: 80, display: 'grid', gap: 8, pointerEvents: 'none' }}>
        {toasts.map((t) => (
          <div key={t.id} className={`alert alert--${t.tone}`} style={{ boxShadow: 'var(--shadow-lg)', margin: 0 }} role="status">
            <span aria-hidden="true">{t.tone === 'error' ? '⛔' : '✅'}</span><div>{t.message}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
