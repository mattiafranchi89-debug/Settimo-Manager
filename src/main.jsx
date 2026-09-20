import React, { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './styles.css';
import { AuthProvider, useAuth } from './lib/auth';
import { ToastProvider, Loading, Alert, Card } from './components/ui';
import { can, isPlayerView } from './lib/permissions';
import { configMissing } from './lib/firebase';

import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

/**
 * Dopo un rilascio il browser può avere in cache la pagina vecchia, che punta
 * a file non più esistenti. In quel caso ricarica una volta sola, così prende
 * la versione nuova invece di mostrare un errore.
 */
const RELOAD_FLAG = 'sm-chunk-reload';
const lazyPage = (factory) =>
  lazy(() =>
    factory()
      .then((m) => { sessionStorage.removeItem(RELOAD_FLAG); return m; })
      .catch((err) => {
        if (!sessionStorage.getItem(RELOAD_FLAG)) {
          sessionStorage.setItem(RELOAD_FLAG, '1');
          window.location.reload();
          return new Promise(() => {}); // la pagina si sta ricaricando
        }
        throw err;
      })
  );

// Loaded on demand: a player opening the calendar never downloads the
// call-up editor, the import screen or the match sheet.
const Rosa = lazyPage(() => import('./pages/Rosa'));
const Allenamenti = lazyPage(() => import('./pages/Allenamenti'));
const Partite = lazyPage(() => import('./pages/Partite'));
const SchedaGara = lazyPage(() => import('./pages/SchedaGara'));
const Convocazioni = lazyPage(() => import('./pages/Convocazioni'));
const ConvocazioneEditor = lazyPage(() => import('./pages/ConvocazioneEditor'));
const Formazioni = lazyPage(() => import('./pages/Formazioni'));
const Calendario = lazyPage(() => import('./pages/Calendario'));
const Campionato = lazyPage(() => import('./pages/Campionato'));
const Impostazioni = lazyPage(() => import('./pages/Impostazioni'));
const Importa = lazyPage(() => import('./pages/Importa'));
const Diagnostica = lazyPage(() => import('./pages/Diagnostica'));
const Registro = lazyPage(() => import('./pages/Registro'));
const Analisi = lazyPage(() => import('./pages/Analisi'));
const MiaPagina = lazyPage(() => import('./pages/MiaPagina'));
const Cassa = lazyPage(() => import('./pages/Cassa'));
const HomeGiocatore = lazyPage(() => import('./pages/HomeGiocatore'));
const Squadra = lazyPage(() => import('./pages/Squadra'));
const Statistiche = lazyPage(() => import('./pages/registri').then((m) => ({ default: m.Statistiche })));
const Documenti = lazyPage(() => import('./pages/registri').then((m) => ({ default: m.Documenti })));
const QuoteMulte = lazyPage(() => import('./pages/registri').then((m) => ({ default: m.QuoteMulte })));

function Protected({ perm, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!user.active) {
    return (
      <Card title="Account in attesa di attivazione">
        <p>Il tuo account non è ancora attivo. Chiedi a un amministratore di assegnarti un ruolo.</p>
      </Card>
    );
  }
  if (perm && !can(user.role, perm)) {
    return <Alert level="error">Non hai i permessi per questa sezione.</Alert>;
  }
  return children;
}

/** Staff e giocatori entrano dalla stessa porta ma in due stanze diverse. */
function Home() {
  const { user } = useAuth();
  return isPlayerView(user?.role) ? <HomeGiocatore /> : <Dashboard />;
}

function Shell() {
  const [theme, setTheme] = useState(() => localStorage.getItem('sm-theme') || 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('sm-theme', theme);
  }, [theme]);
  useEffect(hideSplash, []);
  return <Layout theme={theme} toggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} />;
}

function App() {
  useEffect(hideSplash, []);
  if (configMissing) {
    return (
      <div className="login">
        <div className="login__card">
          <img className="login__logo" src="/logo.png" alt="" />
          <h1 className="login__title">Configurazione mancante</h1>
          <p className="login__sub">Copia <code>.env.example</code> in <code>.env</code> e inserisci le chiavi del progetto Firebase, poi riavvia <code>npm run dev</code>.</p>
        </div>
      </div>
    );
  }
  return (
    <Suspense fallback={<Loading />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><Shell /></Protected>}>
        <Route index element={<Home />} />
        <Route path="rosa" element={<Protected perm="players.read"><Rosa /></Protected>} />
        <Route path="allenamenti" element={<Protected perm="players.read"><Allenamenti /></Protected>} />
        <Route path="partite" element={<Protected perm="players.read"><Partite /></Protected>} />
        <Route path="partite/:id" element={<Protected perm="players.read"><SchedaGara /></Protected>} />
        <Route path="convocazioni" element={<Protected perm="players.read"><Convocazioni /></Protected>} />
        <Route path="convocazioni/nuova" element={<Protected perm="callup.draft"><ConvocazioneEditor /></Protected>} />
        <Route path="convocazioni/:id" element={<Protected perm="players.read"><ConvocazioneEditor /></Protected>} />
        {/* Raggiungibile solo dal pulsante della convocazione, non dal menu. */}
        <Route path="formazioni" element={<Protected perm="lineup.write"><Formazioni /></Protected>} />
        <Route path="calendario" element={<Calendario />} />
        <Route path="campionato" element={<Campionato />} />
        <Route path="statistiche" element={<Protected perm="players.read"><Statistiche /></Protected>} />
        <Route path="analisi" element={<Protected perm="players.read"><Analisi /></Protected>} />
        <Route path="io" element={<MiaPagina />} />
        <Route path="cassa" element={<Cassa />} />
        <Route path="squadra" element={<Squadra />} />
        <Route path="documenti" element={<Protected perm="documents.write"><Documenti /></Protected>} />
        <Route path="quote" element={<Protected perm="finance.read"><QuoteMulte /></Protected>} />
        <Route path="importa" element={<Protected perm="players.write"><Importa /></Protected>} />
        <Route path="registro" element={<Protected perm="audit.read"><Registro /></Protected>} />
        <Route path="diagnostica" element={<Protected perm="club.manage"><Diagnostica /></Protected>} />
        <Route path="impostazioni" element={<Impostazioni />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}

/** Toglie la schermata di apertura una volta che l'interfaccia è pronta. */
function hideSplash() {
  const el = document.getElementById('splash');
  if (!el) return;
  el.classList.add('is-hidden');
  setTimeout(() => el.remove(), 300);
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
