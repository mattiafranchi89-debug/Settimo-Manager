import { useEffect, useState } from 'react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { writeBatch, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { SQUAD, slug, emptyStats } from '../lib/seedData';
import { errorText } from './Rosa';
import { storage } from '../lib/firebase';
import { useAuth } from '../lib/auth';
import { useClub, useCollection, setDocument, updateDocument, serverTimestamp, audit, DEFAULT_CLUB } from '../lib/db';
import { Card, Button, Field, Input, Select, Badge, Alert, Loading, useToast } from '../components/ui';
import { ROLES } from '../lib/permissions';
import { can } from '../lib/permissions';

const MAX_LOGO = 2 * 1024 * 1024;
const OK_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

export default function Impostazioni() {
  const { user, logout } = useAuth();
  const { club, loading } = useClub();
  const toast = useToast();
  const isAdmin = can(user?.role, 'club.manage');

  const [form, setForm] = useState(club);
  const [uploading, setUploading] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // One-tap alternative to scripts/seed.mjs for people without a computer.
  const loadSquad = async () => {
    setSeeding(true);
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'config', 'club'), { ...DEFAULT_CLUB, updatedAt: serverTimestamp() }, { merge: true });
      batch.set(doc(db, 'config', 'branding'), { clubName: DEFAULT_CLUB.clubName, season: DEFAULT_CLUB.season, logoUrl: DEFAULT_CLUB.logoUrl }, { merge: true });
      SQUAD.forEach((p) => batch.set(doc(db, 'players', slug(p.fullName)), {
        ...p, birthDate: new Date(p.birthDate), secondaryPosition: '', shirtNumber: null, preferredFoot: 'destro',
        phone: '', email: '', active: true, registered: true, injury: { active: false }, stats: emptyStats(),
        createdAt: serverTimestamp()
      }, { merge: true }));
      await batch.commit();
      await audit(user, 'seed.squad', 'players', { count: SQUAD.length });
      toast(`Caricati ${SQUAD.length} giocatori e la configurazione della società`);
    } catch (e) {
      toast(errorText(e), 'error');
    }
    setSeeding(false);
  };
  useEffect(() => { setForm(club); }, [club]);

  const { data: users } = useCollection('users', [], isAdmin);
  const { data: players } = useCollection('players', [], isAdmin);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setStaff = (k) => (e) => setForm((f) => ({ ...f, staff: { ...f.staff, [k]: e.target.value } }));

  const save = async () => {
    try {
    await setDocument('config', 'club', { ...form, maxCallup: Number(form.maxCallup) || 20, cardsPerSuspension: Number(form.cardsPerSuspension) || 4, updatedAt: serverTimestamp() });
    await setDocument('config', 'branding', { clubName: form.clubName, season: form.season, logoUrl: form.logoUrl });
    await audit(user, 'club.update', 'config/club');
    toast('Configurazione salvata');
    } catch (e) { toast(errorText(e), 'error'); }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    if (!OK_TYPES.includes(file.type)) return toast('Formato non supportato: usa PNG, JPG, SVG o WebP', 'error');
    if (file.size > MAX_LOGO) return toast('File troppo grande: massimo 2 MB', 'error');
    setUploading(true);
    try {
      const r = ref(storage, `club/logo-${Date.now()}-${file.name}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      setForm((f) => ({ ...f, logoUrl: url }));
      await setDocument('config', 'club', { logoUrl: url, updatedAt: serverTimestamp() });
      await setDocument('config', 'branding', { clubName: form.clubName, season: form.season, logoUrl: url });
      toast('Logo aggiornato');
    } catch {
      toast('Caricamento non riuscito. Verifica le regole di Storage.', 'error');
    }
    setUploading(false);
  };

  if (loading) return <Loading />;

  if (!isAdmin) {
    return (
      <>
        <div className="pagehead"><div><h1>Impostazioni</h1><p>Profilo personale</p></div></div>
        <Card title="Il tuo account">
          <table className="data" style={{ minWidth: 0 }}>
            <tbody>
              <tr><th>Nome</th><td>{user.name}</td></tr>
              <tr><th>Email</th><td>{user.email}</td></tr>
              <tr><th>Ruolo</th><td>{ROLES[user.role]}</td></tr>
            </tbody>
          </table>
          <Button variant="ghost" onClick={logout} style={{ marginTop: 12 }}>Esci</Button>
        </Card>
        <Alert level="info">Solo un amministratore può modificare la configurazione della società.</Alert>
      </>
    );
  }

  return (
    <>
      <div className="pagehead">
        <div><h1>Impostazioni</h1><p>Identità società, staff e regole di default</p></div>
        <Button size="sm" onClick={save}>Salva</Button>
      </div>

      {players.length === 0 && (
        <Card title="Primo avvio">
          <p>La rosa è vuota. Carica i 25 giocatori della stagione 2026/2027 e i valori di default della società con un tocco.</p>
          <div className="btnrow">
            <Button onClick={loadSquad} disabled={seeding}>{seeding ? 'Carico…' : 'Carica rosa iniziale'}</Button>
            <Button variant="secondary" as="a" href="#/importa" onClick={(e) => { e.preventDefault(); window.location.assign('/importa'); }}>Importa da file CSV</Button>
          </div>
        </Card>
      )}

      <Card title="Identità">
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 14 }}>
          <img src={form.logoUrl} alt="" style={{ height: 62 }} onError={(e) => { e.currentTarget.src = '/logo-fallback.svg'; }} />
          <div>
            <label className="btn btn--secondary btn--sm" style={{ cursor: 'pointer' }}>
              {uploading ? 'Carico…' : 'Carica logo'}
              <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden
                onChange={(e) => uploadLogo(e.target.files?.[0])} />
            </label>
            <div className="field__hint">PNG, JPG, SVG o WebP fino a 2 MB. Le proporzioni restano invariate.</div>
          </div>
        </div>
        <div className="row2">
          <Field label="Nome società"><Input value={form.clubName} onChange={set('clubName')} /></Field>
          <Field label="Squadra"><Input value={form.teamName} onChange={set('teamName')} /></Field>
        </div>
        <div className="row2">
          <Field label="Stagione"><Input value={form.season} onChange={set('season')} /></Field>
          <Field label="Modulo di riferimento"><Input value={form.defaultModule} onChange={set('defaultModule')} /></Field>
        </div>
        <Field label="Frase di chiusura dei messaggi"><Input value={form.closingLine} onChange={set('closingLine')} /></Field>
      </Card>

      <Card title="Staff">
        {Object.entries({ head_coach: 'Allenatore', assistant_coach: 'Vice allenatore', team_manager: 'Dirigente accompagnatore', athletic_trainer: 'Preparatore atletico', gk_coach: 'Preparatore portieri' }).map(([k, label]) => (
          <Field key={k} label={label}><Input value={form.staff?.[k] || ''} onChange={setStaff(k)} /></Field>
        ))}
      </Card>

      <Card title="Default di gara">
        <Field label="Impianto di casa"><Input value={form.homeStadium} onChange={set('homeStadium')} /></Field>
        <div className="row2">
          <Field label="Massimo convocati"><Input type="number" min="11" max="30" value={form.maxCallup} onChange={set('maxCallup')} /></Field>
          <Field label="Ammonizioni per squalifica" hint="In Prima Categoria di norma 4.">
            <Input type="number" min="2" max="10" value={form.cardsPerSuspension ?? 4} onChange={set('cardsPerSuspension')} />
          </Field>
        </div>
        <Field label="Competizioni" hint="Separate da virgola.">
          <Input value={(form.competitions || []).join(', ')}
            onChange={(e) => setForm((f) => ({ ...f, competitions: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))} />
        </Field>
        <Field label="Campi di allenamento" hint="Separati da virgola.">
          <Input value={(form.trainingLocations || []).join(', ')}
            onChange={(e) => setForm((f) => ({ ...f, trainingLocations: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))} />
        </Field>
      </Card>

      <Card title="Come aggiungere una persona">
        <ol style={{ paddingLeft: 20, margin: '0 0 8px' }}>
          <li>Console Firebase → Authentication → Users → <strong>Aggiungi utente</strong>: inserisci email e una password provvisoria.</li>
          <li>Comunica email e password all'interessato e digli di fare un primo accesso al sito.</li>
          <li>Dopo quell'accesso comparirà qui sotto come <em>in attesa</em>: assegnagli il ruolo e diventa operativo.</li>
        </ol>
        <p><small>Chi non ha ancora un ruolo vede solo un avviso di attesa. Le password si cambiano da soli con "Password dimenticata" nella pagina di accesso.</small></p>
      </Card>

      <Card title="Distinta">
        <Field label="WhatsApp di chi compila la distinta"
          hint="Solo cifre, con il prefisso internazionale e senza + o spazi: 393331234567. L'allenatore invierà qui la formazione.">
          <Input value={form.distintaPhone || ''} onChange={set('distintaPhone')} placeholder="393331234567" inputMode="numeric" />
        </Field>
      </Card>

      <Card title="Campionato (Tuttocampo)">
        <Field label="Codice girone"
          hint="È la parte finale dell'indirizzo dei widget: .../WidgetV2/Classifica/CODICE. Cambia a ogni stagione.">
          <Input value={form.tuttocampoId || ''} onChange={set('tuttocampoId')} placeholder="bc1d2cc7-2af1-4ed3-bf50-b4c12bf0afaa" />
        </Field>
        <p><small>Lascia vuoto per nascondere la sezione Campionato.</small></p>
      </Card>

      <Card title="Utenti e ruoli">
        <div className="plist">
          {[...users].sort((a, b) => (a.active === false ? -1 : 1) - (b.active === false ? -1 : 1)).map((u) => (
            <div key={u.id} className="prow" style={{ flexWrap: 'wrap' }}>
              <span className="prow__body">
                <span className="prow__name">{u.name || u.email}</span>
                <span className="prow__meta"><span>{u.email}</span>{u.active === false && <span>⏳ in attesa di un ruolo</span>}</span>
              </span>
              <div className="btnrow" style={{ gap: 6 }}>
                <Select value={u.role || 'player'} style={{ minHeight: 38, width: 'auto' }}
                  onChange={async (e) => {
                    await updateDocument('users', u.id, { role: e.target.value, active: true });
                    await audit(user, 'user.role', u.id, { role: e.target.value });
                    toast('Ruolo aggiornato');
                  }}
                  options={Object.entries(ROLES).map(([v, l]) => ({ value: v, label: l }))} />
                {u.role === 'player' && (
                  <Select value={u.playerId || ''} style={{ minHeight: 38, width: 'auto' }}
                    onChange={(e) => updateDocument('users', u.id, { playerId: e.target.value })}>
                    <option value="">Collega a…</option>
                    {players.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
                  </Select>
                )}
              </div>
            </div>
          ))}
        </div>
        <Alert level="info">
          <strong>Sola lettura</strong>: vede rosa, calendario, partite e convocazioni, senza poter modificare nulla — adatto a un dirigente in fase di prova.<br />
          <strong>Allenatore</strong>: unico ruolo che può pubblicare le convocazioni, oltre a formazioni, presenze e valutazioni.<br />
          <strong>Dirigente accompagnatore</strong>: come sola lettura ma può gestire logistica, documenti, quote e condividere le convocazioni.<br />
          I giocatori vanno collegati alla scheda della rosa per vedere i propri dati.
        </Alert>
      </Card>

      <Button variant="ghost" onClick={() => setForm(DEFAULT_CLUB)}>Ripristina valori predefiniti</Button>
    </>
  );
}
