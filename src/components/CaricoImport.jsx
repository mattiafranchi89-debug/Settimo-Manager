import { useState } from 'react';
import { Button, Textarea, Alert, Badge } from './ui';
import { fmtShort, dayIso } from '../lib/format';
import { RPE_LABELS } from '../lib/srpe';
import { rowsFromText, entriesFromRows, matchEntries } from '../lib/srpeImport';
import { readXlsx } from '../lib/xlsxRead';

const num = (v) => (v == null ? '' : v.toLocaleString('it-IT', { maximumFractionDigits: 1 }));
const STATUS = {
  absent: 'assente per il mister: non conta',
  unknown: 'nome non trovato fra le presenze',
  ambiguous: 'più giocatori con questo nome',
  duplicate: 'già presente più sopra: vale la prima riga',
  error: ''
};

/**
 * Carico di una seduta in blocco: si incolla l'elenco (da Excel, Fogli,
 * WhatsApp) o si sceglie un file .xlsx/.csv, si controlla l'abbinamento dei
 * nomi e lo si applica al modulo. Il salvataggio resta quello del modulo.
 */
export default function CaricoImport({ session, names, present, absent, onApply, onClose }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState({});
  const date = dayIso(session.date);

  const result = rows ? entriesFromRows(rows, { date }) : null;
  const matched = result ? matchEntries(result.entries, { present, absent, names }) : [];
  // Righe da abbinare a mano: si sceglie fra i presenti non ancora presi.
  const resolved = matched.map((e, i) => (pick[i] && ['unknown', 'ambiguous'].includes(e.status) ? { ...e, pid: pick[i], status: 'ok', manual: true } : e));
  const taken = new Set(resolved.filter((e) => e.status === 'ok').map((e) => e.pid));
  const ok = resolved.filter((e) => e.status === 'ok');
  const todo = resolved.filter((e) => ['unknown', 'ambiguous'].includes(e.status));

  const read = async (f) => {
    setError(''); setPick({}); setBusy(true);
    try {
      if (f) {
        setFile(f.name);
        if (/\.xlsx$/i.test(f.name)) {
          const sheets = await readXlsx(await f.arrayBuffer());
          const sheet = sheets.find((s) => /registro/i.test(s.name)) || sheets[0];
          setRows(sheet?.rows || []);
        } else setRows(rowsFromText(await f.text()));
      } else {
        setFile(null);
        setRows(rowsFromText(text));
      }
    } catch (e) {
      setRows(null);
      setError(e.message || 'File non leggibile.');
    }
    setBusy(false);
  };

  return (
    <div className="card" style={{ marginBottom: 12, background: 'var(--grey-50)' }}>
      <div className="spread" style={{ marginBottom: 8 }}>
        <strong>Importa un elenco</strong>
        <button className="chip" onClick={onClose} style={{ minHeight: 34, padding: '6px 12px' }}>Chiudi</button>
      </div>

      {!rows && (
        <>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
            Una riga per giocatore: nome, RPE e, se diversi dalla durata, i minuti; poi una nota.
            Va bene copiato da Excel o Fogli, da WhatsApp o scritto a mano. Oppure scegli un file:
            dal foglio del preparatore si prendono le righe del {fmtShort(session.date)}.
          </p>
          <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} aria-label="Elenco da importare"
            placeholder={'Baroni Mattia 7\nBoido Fabio 5,5\nCanestrini G. 6 60 uscito prima'} />
          <div className="btnrow" style={{ marginTop: 8 }}>
            <Button size="sm" disabled={busy || !text.trim()} onClick={() => read(null)}>Leggi l'elenco</Button>
            <label className="btn btn--secondary btn--sm" style={{ cursor: 'pointer' }}>
              📄 Scegli file (.xlsx, .csv)
              <input type="file" accept=".xlsx,.csv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(f); }} />
            </label>
          </div>
        </>
      )}
      {busy && <p style={{ fontSize: 13 }}>Leggo…</p>}
      {error && <Alert level="error">{error}</Alert>}

      {result && (
        <>
          {file && <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>📄 {file}</p>}
          {!result.entries.length ? (
            <Alert level="warn">
              {result.dates.length && !result.dates.includes(date)
                ? `Nel file non ci sono righe del ${fmtShort(session.date)}: ci sono ${result.dates.map((d) => fmtShort(d)).join(', ')}.`
                : 'Nessuna riga con nome e RPE: controlla l\'elenco.'}
            </Alert>
          ) : (
            <>
              <div className="chiprow" style={{ flexWrap: 'wrap' }}>
                <Badge tone="green">{ok.length} da inserire</Badge>
                {todo.length > 0 && <Badge tone="orange">{todo.length} da abbinare</Badge>}
                {resolved.length - ok.length - todo.length > 0 && <Badge tone="grey">{resolved.length - ok.length - todo.length} saltate</Badge>}
                {result.skipped > 0 && <Badge tone="grey">{result.skipped} assenti nel file</Badge>}
                {result.empty > 0 && <Badge tone="grey">{result.empty} {result.empty === 1 ? 'riga' : 'righe'} senza RPE</Badge>}
              </div>
              <div className="plist">
                {resolved.map((e, i) => {
                  const open = ['unknown', 'ambiguous'].includes(matched[i].status);
                  const options = (matched[i].status === 'ambiguous' ? matched[i].options : present).filter((pid) => present.includes(pid) && (!taken.has(pid) || pick[i] === pid));
                  return (
                    <div key={i} className="prow prow--card" style={{ gap: 6, minHeight: 0, padding: '8px 10px', opacity: ['absent', 'duplicate', 'error'].includes(e.status) ? 0.6 : 1 }}>
                      <div style={{ flex: '1 1 100%', minWidth: 0, fontSize: 13.5 }}>
                        <b>{e.name}</b>
                        {e.status === 'ok' && <span> → {names[e.pid]}{e.manual ? ' (scelto)' : ''}</span>}
                        <div style={{ fontSize: 12, color: e.status === 'ok' ? 'var(--muted)' : 'var(--orange)' }}>
                          {e.error || [e.rpe != null && `RPE ${num(e.rpe)} · ${RPE_LABELS[Math.round(e.rpe)]}`, e.minutes != null && `${e.minutes}′`, e.note, STATUS[e.status]].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      {open && (
                        <select className="select" aria-label={`Giocatore per «${e.name}»`} value={pick[i] || ''} style={{ minHeight: 40, padding: '6px 8px' }}
                          onChange={(ev) => setPick((p) => ({ ...p, [i]: ev.target.value }))}>
                          <option value="">Scegli il giocatore…</option>
                          {options.map((pid) => <option key={pid} value={pid}>{names[pid] || pid}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <div className="btnrow" style={{ marginTop: 10 }}>
            <Button size="sm" disabled={!ok.length} onClick={() => onApply(ok)}>Inserisci {ok.length} nel modulo</Button>
            <Button size="sm" variant="ghost" onClick={() => { setRows(null); setFile(null); setPick({}); }}>Rifai</Button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 0 }}>
            Sostituisce i valori già scritti per questi giocatori; gli altri restano come sono. Poi controlla e premi Salva.
          </p>
        </>
      )}
    </div>
  );
}
