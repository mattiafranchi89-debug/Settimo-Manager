import React, { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './styles.css';
import { AuthProvider, useAuth } from './lib/auth';
import { ToastProvider, Loading, Alert, Card } from './components/ui';
import { can } from './lib/permissions';
import { configMissing } from './lib/firebase';

import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

// Loaded on demand: a player opening the calendar never downloads the
// call-up editor, the import screen or the match sheet.
const Rosa = lazy(() => import('./pages/Rosa'));
const Allenamenti = lazy(() => import('./pages/Allenamenti'));
const Partite = lazy(() => import('./pages/Partite'));
const SchedaGara = lazy(() => import('./pages/SchedaGara'));
const Convocazioni = lazy(() => import('./pages/Convocazioni'));
const ConvocazioneEditor = lazy(() => import('./pages/ConvocazioneEditor'));
const Formazioni = lazy(() => import('./pages/Formazioni'));
const Calendario = lazy(() => import('./pages/Calendario'));
const Campionato = lazy(() => import('./pages/Campionato'));
const Impostazioni = lazy(() => import('./pages/Impostazioni'));
const Importa = lazy(() => import('./pages/Importa'));
const Diagnostica = lazy(() => import('./pages/Diagnostica'));
const Statistiche = lazy(() => import('./pages/registri').then((m) => ({ default: m.Statistiche })));
const Valutazioni = lazy(() => import('./pages/registri').then((m) => ({ default: m.Valutazioni })));
const Documenti = lazy(() => import('./pages/registri').then((m) => ({ default: m.Documenti })));
const QuoteMulte = lazy(() => import('./pages/registri').then((m) => ({ default: m.QuoteMulte })));

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

function Shell() {
  const [theme, setTheme] = useState(() => localStorage.getItem('sm-theme') || 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('sm-theme', theme);
  }, [theme]);
  return <Layout theme={theme} toggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} />;
}

function App() {
  if (configMissing) {
    return (
      <div className="login">
        <div className="login__card">
          <img className="login__logo" src="/logo-fallback.svg" alt="" />
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
        <Route index element={<Dashboard />} />
        <Route path="rosa" element={<Protected perm="players.read"><Rosa /></Protected>} />
        <Route path="allenamenti" element={<Allenamenti />} />
        <Route path="partite" element={<Partite />} />
        <Route path="partite/:id" element={<SchedaGara />} />
        <Route path="convocazioni" element={<Convocazioni />} />
        <Route path="convocazioni/nuova" element={<Protected perm="callup.draft"><ConvocazioneEditor /></Protected>} />
        <Route path="convocazioni/:id" element={<ConvocazioneEditor />} />
        <Route path="formazioni" element={<Protected perm="lineup.write"><Formazioni /></Protected>} />
        <Route path="calendario" element={<Calendario />} />
        <Route path="campionato" element={<Campionato />} />
        <Route path="statistiche" element={<Statistiche />} />
        <Route path="valutazioni" element={<Protected perm="ratings.write"><Valutazioni /></Protected>} />
        <Route path="documenti" element={<Protected perm="documents.write"><Documenti /></Protected>} />
        <Route path="quote" element={<QuoteMulte />} />
        <Route path="importa" element={<Protected perm="players.write"><Importa /></Protected>} />
        <Route path="diagnostica" element={<Protected perm="club.manage"><Diagnostica /></Protected>} />
        <Route path="impostazioni" element={<Impostazioni />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
