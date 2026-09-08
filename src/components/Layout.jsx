import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useClub } from '../lib/db';
import { navFor, ROLES, can } from '../lib/permissions';
import { Sheet, Button } from './ui';

const TABS = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/allenamenti', label: 'Allenamenti', icon: '🏃' },
  { to: '/convocazioni', label: 'Convocazioni', icon: '📋' },
  { to: '/calendario', label: 'Calendario', icon: '📅' }
];

export default function Layout({ theme, toggleTheme }) {
  const { user, logout } = useAuth();
  const { club } = useClub();
  const navigate = useNavigate();
  const [more, setMore] = useState(false);
  const nav = navFor(user?.role);
  const canCallup = can(user?.role, 'callup.draft');

  const go = (to) => { setMore(false); navigate(to); };

  return (
    <div className="app">
      <header className="topbar">
        <img className="topbar__logo" src={club.logoUrl} alt="" onError={(e) => { e.currentTarget.src = '/logo-fallback.svg'; }} />
        <div className="topbar__titles">
          <div className="topbar__club">{club.clubName}</div>
          <div className="topbar__meta">{club.teamName} · Stagione {club.season}</div>
        </div>
        <div className="topbar__actions">
          <button className="iconbtn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button className="iconbtn" onClick={() => setMore(true)} aria-label="Menu">☰</button>
        </div>
      </header>

      <div className="shell">
        <nav className="sidebar" aria-label="Navigazione principale">
          {canCallup && (
            <div className="sidebar__cta">
              <Button block onClick={() => navigate('/convocazioni/nuova')}>＋ Nuova convocazione</Button>
            </div>
          )}
          {nav.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'}>
              <span aria-hidden="true">{i.icon}</span>{i.label}
            </NavLink>
          ))}
        </nav>

        <main className="main">
          <Outlet />
        </main>
      </div>

      {canCallup && (
        <button className="fab" onClick={() => navigate('/convocazioni/nuova')}>＋ NUOVA CONVOCAZIONE</button>
      )}

      <nav className="tabbar" aria-label="Navigazione rapida">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'}>
            <span aria-hidden="true">{t.icon}</span>{t.label}
          </NavLink>
        ))}
        <a href="#menu" onClick={(e) => { e.preventDefault(); setMore(true); }}>
          <span aria-hidden="true">⋯</span>Altro
        </a>
      </nav>

      {more && (
        <Sheet title="Menu" onClose={() => setMore(false)}>
          <div className="stack">
            {nav.map((i) => (
              <button key={i.to} className="prow" onClick={() => go(i.to)}>
                <span className="prow__num" aria-hidden="true">{i.icon}</span>
                <div className="prow__body"><div className="prow__name">{i.label}</div></div>
              </button>
            ))}
          </div>
          <hr style={{ border: 'none', borderTop: '1px solid var(--line-soft)', margin: '16px 0' }} />
          <div className="spread">
            <div>
              <div style={{ fontWeight: 600 }}>{user?.name}</div>
              <small>{ROLES[user?.role] || 'Ruolo non assegnato'}</small>
            </div>
            <Button variant="ghost" size="sm" onClick={logout}>Esci</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
