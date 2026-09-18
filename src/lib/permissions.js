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

  // 'readonly' can see everything the staff sees, but appears in no write list.
  'players.read': [...STAFF_ROLES, 'readonly', 'sporting_director'],
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

// Navigation is derived from permissions so a Player never sees staff sections.
export const NAV = [
  { to: '/', label: 'Dashboard', icon: '🏠', all: true },
  { to: '/rosa', label: 'Rosa', icon: '👥', perm: 'players.read' },
  { to: '/allenamenti', label: 'Allenamenti', icon: '🏃', all: true },
  { to: '/convocazioni', label: 'Convocazioni', icon: '📋', all: true },
  { to: '/partite', label: 'Partite', icon: '⚽', all: true },
  { to: '/calendario', label: 'Calendario', icon: '📅', all: true },
  { to: '/campionato', label: 'Campionato', icon: '🏆', all: true },
  { to: '/statistiche', label: 'Statistiche', icon: '📊', all: true },
  { to: '/analisi', label: 'Analisi', icon: '📈', all: true },
  { to: '/io', label: 'La mia pagina', icon: '🙋', linked: true },
  { to: '/documenti', label: 'Documenti', icon: '📁', perm: 'documents.write' },
  { to: '/quote', label: 'Quote e multe', icon: '💶', all: true },
  { to: '/importa', label: 'Importazioni', icon: '⬆️', perm: 'players.write' },
  { to: '/registro', label: 'Registro', icon: '📑', perm: 'audit.read' },
  { to: '/impostazioni', label: 'Impostazioni', icon: '⚙️', all: true },
  { to: '/diagnostica', label: 'Diagnostica', icon: '🩺', perm: 'club.manage' }
];

export function navFor(role, user) {
  return NAV.filter((i) => (i.linked ? !!user?.playerId : i.all || can(role, i.perm)));
}
