import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useClub } from '../lib/db';
import { navFor, tabsFor, ROLES, can, sectionOf, sectionTabs } from '../lib/permissions';
import { Sheet, Button } from './ui';
import ErrorBoundary from './ErrorBoundary';
import { setNotifyUser } from '../lib/notify';
import { refreshPushSubscription } from '../lib/push';

export default function Layout({ theme, toggleTheme }) {
  const { user, logout } = useAuth();
  const { club } = useClub();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [more, setMore] = useState(false);
  const nav = navFor(user?.role, user);
  const tabs = tabsFor(user?.role);
  const canCallup = can(user?.role, 'callup.draft');
  const section = sectionOf(pathname);
  const subTabs = sectionTabs(pathname, user?.role);
  // Una voce resta evidenziata anche nelle sue pagine figlie (es. Calendario su /partite).
  const linkClass = (to) => ({ isActive }) => (isActive || (to !== '/' && section === to) ? 'active' : undefined);
  // Le voci a gruppi, nell'ordine in cui compaiono.
  const groups = nav.reduce((acc, i) => {
    const g = i.group || '';
    const last = acc[acc.length - 1];
    if (last && last.name === g) last.items.push(i); else acc.push({ name: g, items: [i] });
    return acc;
  }, []);

  // Chi salva firma le notifiche; l'iscrizione del telefono si riallinea a ogni apertura.
  useEffect(() => { setNotifyUser(user); }, [user]);
  useEffect(() => { if (user?.uid) refreshPushSubscription(); }, [user?.uid]);

  const go = (to) => { setMore(false); navigate(to); };

  return (
    <div className="app">
      <header className="topbar">
        <img className="topbar__logo" src={club.logoUrl} alt="" onError={(e) => { e.currentTarget.src = '/logo.png'; }} />
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
          {groups.map((g) => (
            <div key={g.name || 'top'}>
              {g.name && <div className="navgroup">{g.name}</div>}
              {g.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === '/'} className={linkClass(i.to)}>
                  <span aria-hidden="true">{i.icon}</span>{i.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <main className="main">
          {subTabs.length > 0 && (
            <nav className="subtabs" aria-label="Sezioni">
              {subTabs.map((t) => (
                <NavLink key={t.to} to={t.to} end className={({ isActive }) => `subtab${isActive ? ' subtab--on' : ''}`}>{t.label}</NavLink>
              ))}
            </nav>
          )}
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <nav className="tabbar" aria-label="Navigazione rapida">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'} className={linkClass(t.to)}>
            <span aria-hidden="true">{t.icon}</span>{t.label}
          </NavLink>
        ))}
        <a href="#menu" onClick={(e) => { e.preventDefault(); setMore(true); }}>
          <span aria-hidden="true">⋯</span>Altro
        </a>
      </nav>

      {more && (
        <Sheet title="Menu" onClose={() => setMore(false)}>
          {groups.map((g) => (
            <div key={g.name || 'top'} style={{ marginBottom: 6 }}>
              {g.name && <div className="navgroup">{g.name}</div>}
              <div className="stack">
                {g.items.map((i) => (
                  <button key={i.to} className={`prow ${section === i.to || pathname === i.to ? 'prow--selected' : ''}`} onClick={() => go(i.to)}>
                    <span className="prow__num" aria-hidden="true">{i.icon}</span>
                    <div className="prow__body"><div className="prow__name">{i.label}</div></div>
                  </button>
                ))}
              </div>
            </div>
          ))}
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
