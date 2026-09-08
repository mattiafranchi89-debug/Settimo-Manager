import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { writeBatch, doc, collection, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/auth';
import { useCollection, useClub, audit } from '../lib/db';
import { SCHEMAS, parseCsv, downloadCsv, validateRows, normName } from '../lib/bulk';
import { deleteImportBatch } from '../lib/remove';
import { slug, emptyStats } from '../lib/seedData';
import { saveDocumentNumber } from '../lib/players';
import { Card, Button, Badge, Alert, Loading, useToast, Select, Field, ConfirmDialog } from '../components/ui';
import { errorText } from './Rosa';
import { can } from '../lib/permissions';

export default function Importa() {
  const { user } = useAuth();
  const { club } = useClub();
  const toast = useToast();
  const { data: players, loading } = useCollection('players');
  const { data: imports } = useCollection('imports');
  const [undoing, setUndoing] = useState(null);
  const [params] = useSearchParams();
  const [kind, setKind] = useState(SCHEMAS[params.get('tipo')] ? params.get('tipo') : 'giocatori');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');

  const schema = SCHEMAS[kind];
  const canImport = can(user?.role, 'players.write');

  const byName = useMemo(() => {
    const m = {};
    players.forEach((p) => { m[normName(p.fullName)] = p.id; });
    return m;
  }, [players]);

  const ctx = useMemo(() => ({ club, findPlayer: (n) => byName[normName(n || '')] || '' }), [club, byName]);

  const downloadTemplate = () => {
    downloadCsv(schema.file, schema.headers, schema.example);
    toast(`Template ${schema.label.toLowerCase()} scaricato`);
  };

  const readFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    const { headers, rows } = parseCsv(text);
    if (!rows.length) { setPreview({ rows: [], headers, empty: true }); return; }
    const missingCols = schema.required.filter((h) => !headers.includes(h));
    setPreview({ rows: validateRows(schema, rows, ctx), headers, missingCols });
  };

  const commit = async () => {
    const valid = preview.rows.filter((r) => !r.errors.length);
    if (!valid.length) return;
    setBusy(true);
    const batchId = `imp_${Date.now()}`;
    try {
      // Batches cap at 500 writes; a season of fixtures stays well below.
      for (let i = 0; i < valid.length; i += 400) {
        const batch = writeBatch(db);
        valid.slice(i, i + 400).forEach((r) => {
          const base = { ...r.data, importBatchId: batchId, createdBy: user.uid, createdAt: serverTimestamp() };
          if (schema.collection === 'players') {
            // Same id as the seed loader, so re-importing updates instead of duplicating.
            batch.set(doc(db, 'players', slug(r.data.fullName)), { ...base, stats: emptyStats() }, { merge: true });
          } else {
            batch.set(doc(collection(db, schema.collection)), base);
          }
        });
        await batch.commit();
      }
      if (schema.collection === 'players') {
        // Written outside the batch: it lands in a sub-collection with its own rules.
        await Promise.all(valid
          .filter((r) => r.privateData?.numeroDocumento)
          .map((r) => saveDocumentNumber(slug(r.data.fullName), r.privateData.numeroDocumento, user.uid)));
      }

      await setDoc(doc(db, 'imports', batchId), {
        kind, label: schema.label, collection: schema.collection, count: valid.length,
        file: fileName, by: user.name, at: serverTimestamp()
      });
      await audit(user, 'bulk.import', schema.collection, { count: valid.length, file: fileName, batchId });
      toast(`${valid.length} righe importate in ${schema.label}`);
      setPreview(null); setFileName('');
    } catch (e) {
      toast(errorText(e), 'error');
    }
    setBusy(false);
  };

  if (loading) return <Loading />;

  const valid = preview?.rows?.filter((r) => !r.errors.length) || [];
  const invalid = preview?.rows?.filter((r) => r.errors.length) || [];

  return (
    <>
      <div className="pagehead">
        <div><h1>Importazioni</h1><p>Scarica il modello, compilalo, ricaricalo</p></div>
      </div>

      {!canImport && <Alert level="error">Non hai i permessi per importare dati.</Alert>}

      <Field label="Cosa vuoi caricare">
        <Select value={kind} onChange={(e) => { setKind(e.target.value); setPreview(null); setFileName(''); }}
          options={Object.entries(SCHEMAS).map(([k, v]) => ({ value: k, label: v.label }))} />
      </Field>

      <Alert level="info">Le righe importate finiscono nella sezione <strong>{schema.label}</strong>.</Alert>

      <Card title={`1. Scarica il modello — ${schema.label}`}>
        <p>{schema.help}</p>
        <p><small>Colonne: {schema.headers.join(' · ')}<br />Obbligatorie: <strong>{schema.required.join(', ')}</strong></small></p>
        <Button onClick={downloadTemplate}>⬇ Scarica {schema.file}</Button>
        <p style={{ marginTop: 10 }}><small>Il file contiene già una riga di esempio: cancellala prima di caricare. Si apre con Excel, Numbers o Google Fogli; salva sempre in formato CSV.</small></p>
      </Card>

      <Card title="2. Carica il file compilato">
        <label className="btn btn--secondary" style={{ cursor: 'pointer' }}>
          {fileName || 'Scegli file CSV'}
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => readFile(e.target.files?.[0])} />
        </label>
        {schema.needsPlayers && players.length === 0 && (
          <Alert level="warn">La rosa è vuota: carica prima i giocatori, altrimenti i nomi non verranno riconosciuti.</Alert>
        )}
      </Card>

      {imports.length > 0 && (
        <Card title="Importazioni recenti">
          <p><small>Se hai caricato il file sbagliato, qui puoi rimuovere in un colpo solo tutte le righe di quell'importazione.</small></p>
          <div className="plist">
            {[...imports].sort((a, b) => (b.at?.seconds || 0) - (a.at?.seconds || 0)).slice(0, 8).map((imp) => (
              <div key={imp.id} className="prow">
                <span className="prow__num">{imp.count}</span>
                <span className="prow__body">
                  <span className="prow__name">{imp.label}</span>
                  <span className="prow__meta"><span>{imp.file}</span><span>{imp.by}</span></span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => setUndoing(imp)}>Elimina</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {undoing && (
        <ConfirmDialog
          title="Annullare l'importazione?"
          destructive
          confirmLabel={`Elimina ${undoing.count} righe`}
          message={`Verranno cancellate le ${undoing.count} righe caricate da ${undoing.file} nella sezione ${undoing.label}. Per le partite e gli allenamenti spariscono anche convocazioni e presenze collegate. L'operazione non è reversibile.`}
          onConfirm={async () => {
            try {
              const n = await deleteImportBatch(undoing.id, undoing.collection);
              await audit(user, 'bulk.undo', undoing.collection, { batchId: undoing.id, deleted: n });
              toast(`${n} documenti eliminati`);
            } catch (e) { toast(errorText(e), 'error'); }
          }}
          onClose={() => setUndoing(null)}
        />
      )}

      {preview && (
        <Card title="3. Controlla e conferma">
          {preview.empty && <Alert level="error">Il file non contiene righe di dati.</Alert>}
          {preview.missingCols?.length > 0 && (
            <Alert level="error">Mancano colonne obbligatorie: {preview.missingCols.join(', ')}. Riparti dal modello scaricato.</Alert>
          )}

          {!preview.empty && (
            <>
              <div className="chiprow">
                <span className="badge badge--green">Pronte: {valid.length}</span>
                {invalid.length > 0 && <span className="badge badge--red">Da correggere: {invalid.length}</span>}
              </div>

              {invalid.length > 0 && (
                <>
                  <div className="grouphead">Righe con errori</div>
                  <div className="plist">
                    {invalid.slice(0, 15).map((r) => (
                      <div key={r.line} className="prow">
                        <span className="prow__num">{r.line}</span>
                        <span className="prow__body">
                          <span className="prow__name">{r.label}</span>
                          <span className="prow__meta"><span>{r.errors.join(' · ')}</span></span>
                        </span>
                      </div>
                    ))}
                  </div>
                  {invalid.length > 15 && <p><small>e altre {invalid.length - 15} righe da correggere.</small></p>}
                  <Alert level="info">Le righe con errori vengono semplicemente saltate: puoi importare le altre e ricaricare in seguito il file corretto.</Alert>
                </>
              )}

              {valid.length > 0 && (
                <>
                  <div className="grouphead">Anteprima</div>
                  <div className="plist">
                    {valid.slice(0, 10).map((r) => (
                      <div key={r.line} className="prow">
                        <span className="prow__num">{r.line}</span>
                        <span className="prow__body">
                          <span className="prow__name">{r.label}</span>
                          <span className="prow__meta"><span>{r.detail}</span></span>
                        </span>
                        <Badge tone="green">ok</Badge>
                      </div>
                    ))}
                  </div>
                  {valid.length > 10 && <p><small>…e altre {valid.length - 10} righe pronte.</small></p>}

                  {kind === 'giocatori' && (
                    <Alert level="info">I giocatori già presenti con lo stesso nome vengono aggiornati, non duplicati.</Alert>
                  )}

                  <div className="btnrow" style={{ marginTop: 12 }}>
                    <Button onClick={commit} disabled={busy || !canImport}>
                      {busy ? 'Importo…' : `Importa ${valid.length} righe`}
                    </Button>
                    <Button variant="ghost" onClick={() => { setPreview(null); setFileName(''); }}>Annulla</Button>
                  </div>
                </>
              )}
            </>
          )}
        </Card>
      )}
    </>
  );
}
