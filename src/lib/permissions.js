// Single source of truth for role-based access in the UI.
// The same logic is enforced server-side in firestore.rules — this layer only
// decides what to show. Never rely on it for security.

export const ROLES = {
  admin: 'Amministratore',
  head_coach: 'Allenatore',
  assistant_coach: 'Vice allenatore',
  athletic_trainer: 'Preparatore atletico',
  gk_coach: 'Preparatore portieri',
  team_manager: 'Dirigente accompagnatore',
  sporting_director: 'Direttore sportivo',
  readonly: 'Sola lettura',
  player: 'Giocatore'
};

export const STAFF_ROLES = ['admin', 'head_coach', 'assistant_coach', 'athletic_trainer', 'gk_coach', 'team_manager'];

// permission -> roles allowed
const MATRIX = {
  'club.manage': ['admin'],
  'users.manage': ['admin'],
  'audit.read': ['admin', 'head_coach'],

  // La rosa completa, con infortuni e scadenze, resta allo staff.
  'players.read': [...STAFF_ROLES, 'sporting_director'],
  'players.write': ['admin', 'head_coach', 'team_manager'],
  'players.archive': ['admin'],
  'players.delete': ['admin'],
  'events.delete': ['admin', 'head_coach', 'team_manager'],
  'callup.delete': ['admin', 'head_coach'],
  'documents.delete': ['admin', 'team_manager'],
  'players.contacts': ['admin', 'head_coach', 'team_manager'],

  'medical.read': ['admin', 'head_coach', 'athletic_trainer'],
  'medical.write': ['admin', 'athletic_trainer'],

  'events.write': ['admin', 'head_coach', 'assistant_coach', 'athletic_trainer', 'team_manager'],
  'attendance.write': ['admin', 'head_coach', 'assistant_coach', 'athletic_trainer', 'gk_coach'],

  'callup.draft': ['admin', 'head_coach', 'assistant_coach', 'gk_coach', 'team_manager'],
  'callup.publish': ['admin', 'head_coach'],
  'callup.override': ['admin', 'head_coach'],
  'callup.share': ['admin', 'head_coach', 'team_manager'],

  'lineup.write': ['admin', 'head_coach', 'assistant_coach'],
  'matchstats.write': ['admin', 'head_coach', 'assistant_coach'],

  'documents.write': ['admin', 'team_manager'],
  'finance.read': ['admin', 'team_manager', 'sporting_director'],
  'finance.write': ['admin', 'team_manager']
};

export function can(role, permission) {
  const allowed = MATRIX[permission];
  return Array.isArray(allowed) && allowed.includes(role);
}

export function isStaff(role) {
  return STAFF_ROLES.includes(role);
}

/**
 * Due esperienze distinte. Lo staff gestisce la squadra; il giocatore deve
 * sapere se è convocato, quando si gioca e come sta andando lui: tutto il
 * resto è rumore che allontana dall'app.
 */
const PLAYER_VIEW_ROLES = ['player', 'readonly'];
export const isPlayerView = (role) => PLAYER_VIEW_ROLES.includes(role);

const NAV_STAFF = [
  { to: '/', label: 'Dashboard', icon: '🏠', all: true },
  { to: '/rosa', label: 'Rosa', icon: '👥', perm: 'players.read' },
  { to: '/allenamenti', label: 'Allenamenti', icon: '🏃', all: true },
  { to: '/convocazioni', label: 'Convocazioni', icon: '📋', all: true },
  { to: '/partite', label: 'Partite', icon: '⚽', all: true },
  { to: '/calendario', label: 'Calendario', icon: '📅', all: true },
  { to: '/campionato', label: 'Campionato', icon: '🏆', all: true },
  { to: '/statistiche', label: 'Statistiche', icon: '📊', all: true },
  { to: '/analisi', label: 'Analisi', icon: '📈', all: true },
  { to: '/documenti', label: 'Documenti', icon: '📁', perm: 'documents.write' },
  { to: '/quote', label: 'Quote e multe', icon: '💶', perm: 'finance.read' },
  { to: '/cassa', label: 'Cassa multe', icon: '🏺', all: true },
  { to: '/importa', label: 'Importazioni', icon: '⬆️', perm: 'players.write' },
  { to: '/registro', label: 'Registro', icon: '📑', perm: 'audit.read' },
  { to: '/impostazioni', label: 'Impostazioni', icon: '⚙️', all: true },
  { to: '/diagnostica', label: 'Diagnostica', icon: '🩺', perm: 'club.manage' }
];

const NAV_PLAYER = [
  { to: '/', label: 'Home', icon: '🏠', all: true },
  { to: '/calendario', label: 'Calendario', icon: '📅', all: true },
  { to: '/squadra', label: 'Squadra', icon: '👥', all: true },
  { to: '/campionato', label: 'Campionato', icon: '🏆', all: true },
  { to: '/io', label: 'Il mio profilo', icon: '🙋', linked: true },
  { to: '/cassa', label: 'Cassa e quote', icon: '🏺', all: true },
  { to: '/impostazioni', label: 'Il mio account', icon: '⚙️', all: true }
];

/** Le cinque voci in fondo allo schermo: le prime quattro più «Altro». */
export const TABS_STAFF = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/allenamenti', label: 'Allenamenti', icon: '🏃' },
  { to: '/convocazioni', label: 'Convocazioni', icon: '📋' },
  { to: '/calendario', label: 'Calendario', icon: '📅' }
];

export const TABS_PLAYER = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/calendario', label: 'Calendario', icon: '📅' },
  { to: '/squadra', label: 'Squadra', icon: '👥' },
  { to: '/io', label: 'Profilo', icon: '🙋' }
];

export const tabsFor = (role) => (isPlayerView(role) ? TABS_PLAYER : TABS_STAFF);

export const NAV = NAV_STAFF;

export function navFor(role, user) {
  const list = isPlayerView(role) ? NAV_PLAYER : NAV_STAFF;
  return list.filter((i) => (i.linked ? !!user?.playerId : i.all || can(role, i.perm)));
}
