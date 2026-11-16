import { useEffect, useRef, useState } from 'react';
import { Sheet } from './ui';
import { ask, createData, speechRecognition, SUGGESTIONS } from '../lib/assistant';
import { dayIso } from '../lib/format';

const TOOL_LABEL = {
  calendario: 'calendario', classifica: 'classifica', rosa: 'rosa', giocatore: 'giocatore', scheda_gara: 'scheda gara',
  presenze: 'presenze', convocazione: 'convocazione', disciplina: 'disciplina', andamento: 'andamento', avversario: 'avversario', cassa: 'cassa'
};
const hasSpeech = () => typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

/** Testo della risposta: paragrafi, elenchi con «- » e **grassetto**. Niente HTML dal modello. */
function Rich({ text = '' }) {
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : part));
  const blocks = [];
  text.split('\n').forEach((line) => {
    const t = line.trim();
    if (!t) return;
    const item = /^[-•]\s+/.test(t);
    const last = blocks[blocks.length - 1];
    if (item && last?.type === 'ul') last.items.push(t.replace(/^[-•]\s+/, ''));
    else if (item) blocks.push({ type: 'ul', items: [t.replace(/^[-•]\s+/, '')] });
    else blocks.push({ type: 'p', text: t });
  });
  return blocks.map((b, i) => (b.type === 'ul'
    ? <ul key={i} style={{ margin: '4px 0', paddingLeft: 18 }}>{b.items.map((x, k) => <li key={k}>{inline(x)}</li>)}</ul>
    : <p key={i} style={{ margin: '4px 0' }}>{inline(b.text)}</p>));
}

/**
 * L'assistente: una chat che risponde sui dati della squadra, con la dettatura
 * del browser. Per ora solo per l'amministratore, e solo in lettura: le azioni
 * si fanno ancora nelle pagine.
 */
export default function Assistente({ club }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [listening, setListening] = useState(false);
  const history = useRef([]);
  const data = useRef(null);
  const rec = useRef(null);
  const endRef = useRef(null);
  const boxRef = useRef(null);

  // I dati si rileggono a ogni apertura: una presenza registrata un minuto fa deve contare.
  useEffect(() => { if (open) data.current = createData(club); }, [open, club]);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [turns, status]);
  useEffect(() => () => rec.current?.abort?.(), []);

  const send = async (raw) => {
    const question = String(raw ?? input).trim();
    if (!question || busy) return;
    setInput('');
    setTurns((t) => [...t, { role: 'me', text: question }]);
    setBusy(true); setStatus('');
    try {
      const r = await ask({
        history: history.current, question, data: data.current || (data.current = createData(club)),
        context: { clubName: club.clubName, season: club.season, today: dayIso(new Date()) },
        onStatus: (names) => setStatus(`Sto guardando: ${names.map((n) => TOOL_LABEL[n] || n).join(', ')}…`)
      });
      history.current = r.messages;
      setTurns((t) => [...t, { role: 'ai', text: r.text, tools: r.tools }]);
    } catch (e) {
      setTurns((t) => [...t, { role: 'ai', text: String(e?.message || e), error: true }]);
    } finally {
      setBusy(false); setStatus('');
    }
  };

  const reset = () => { history.current = []; setTurns([]); setInput(''); data.current = createData(club); };

  const toggleMic = () => {
    if (listening) { rec.current?.stop(); return; }
    const r = speechRecognition();
    if (!r) return;
    r.lang = 'it-IT'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    let heard = '';
    r.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i += 1) text += e.results[i][0].transcript;
      setInput(text);
      if (e.results[e.results.length - 1].isFinal) heard = text;
    };
    r.onerror = () => setListening(false);
    r.onend = () => { setListening(false); rec.current = null; if (heard.trim()) send(heard); };
    rec.current = r;
    setListening(true);
    try { r.start(); } catch { setListening(false); }
  };

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  return (
    <>
      <button className="fab fab--ai" onClick={() => setOpen(true)} aria-label="Chiedi all'assistente">✨ Chiedi</button>
      {open && (
        <Sheet title="Assistente" onClose={() => setOpen(false)}>
          <div className="chat" ref={boxRef} aria-live="polite">
            {turns.length === 0 && (
              <div className="chat__hint">
                <p style={{ margin: '0 0 8px' }}>Chiedi quello che vuoi sapere della squadra: rispondo con i dati dell'app, senza inventare. Per ora informo e basta: le azioni si fanno nelle pagine.</p>
                <div className="btnrow">
                  {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`chat__msg ${t.role === 'me' ? 'chat__msg--me' : 'chat__msg--ai'}${t.error ? ' chat__msg--err' : ''}`}>
                {t.role === 'me' ? t.text : <Rich text={t.text} />}
                {t.tools?.length > 0 && <div className="chat__meta">Da: {t.tools.map((n) => TOOL_LABEL[n] || n).join(', ')}</div>}
              </div>
            ))}
            {busy && <div className="chat__msg chat__msg--ai chat__msg--wait">{status || 'Un attimo…'}</div>}
            <div ref={endRef} />
          </div>
          <div className="chat__input">
            <textarea className="textarea" rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey}
              placeholder={listening ? 'Ti ascolto…' : 'Scrivi o detta una domanda'} aria-label="Domanda" disabled={busy} />
            {hasSpeech() && (
              <button className={`iconbtn chat__mic${listening ? ' chat__mic--on' : ''}`} onClick={toggleMic} disabled={busy} aria-pressed={listening} aria-label={listening ? 'Ferma la dettatura' : 'Detta la domanda'}>🎤</button>
            )}
            <button className="btn btn--primary chat__send" onClick={() => send()} disabled={busy || !input.trim()} aria-label="Invia">➤</button>
          </div>
          <div className="spread" style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            <span>{hasSpeech() ? 'Con il microfono la domanda parte da sola a fine frase.' : 'Su iPhone usa il microfono della tastiera.'}</span>
            {turns.length > 0 && <button className="linkbtn" onClick={reset} disabled={busy}>Nuova conversazione</button>}
          </div>
        </Sheet>
      )}
    </>
  );
}
