import { Component } from 'react';

/**
 * Rete di sicurezza: un errore in una pagina non deve più lasciare lo schermo
 * bianco. Mostra cosa è successo e una via d'uscita.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) {
    console.error('Errore nella pagina', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const detail = `${this.state.error?.message || this.state.error}\n${window.location.pathname}`;
    return (
      <div className="login">
        <div className="login__card">
          <img className="login__logo" src="/logo.png" alt="" />
          <h1 className="login__title">Qualcosa è andato storto</h1>
          <p className="login__sub">La pagina ha incontrato un errore. I dati non sono stati toccati.</p>
          <div className="btnrow" style={{ justifyContent: 'center' }}>
            <a className="btn btn--primary" href="/">Torna alla home</a>
            <button className="btn btn--ghost" onClick={() => window.location.reload()}>Ricarica</button>
          </div>
          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--muted)' }}>Dettaglio tecnico da inviare</summary>
            <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--grey-50)', padding: 10, borderRadius: 8 }}>{detail}</pre>
          </details>
        </div>
      </div>
    );
  }
}
