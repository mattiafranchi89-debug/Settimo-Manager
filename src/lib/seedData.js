// Initial squad and club defaults, 2026/2027. Used by the in-app loader
// (Impostazioni → Carica rosa iniziale) and by scripts/seed.mjs.
export const SQUAD = [
  { fullName: 'BARONI MATTIA NESTORE', position: 'CC', birthDate: '2005-02-17' },
  { fullName: 'BIANCO FRANCESCO CARLO', position: 'DC', birthDate: '2007-05-10' },
  { fullName: 'BOIDO FABIO', position: 'ATT', birthDate: '2006-05-05' },
  { fullName: 'CANESTRINI GABRIEL', position: 'DC', birthDate: '2004-03-08' },
  { fullName: 'CANESTRINI SAMUEL', position: 'CC', birthDate: '2004-03-08' },
  { fullName: 'CECCARELLI ALESSANDRO', position: 'TS', birthDate: '1995-02-13' },
  { fullName: 'CORAZZA ALESSIO', position: 'DC', birthDate: '1992-05-29' },
  { fullName: 'CROCE ANDREA EDOARDO', position: 'POR', birthDate: '1992-07-08' },
  { fullName: 'DI BENEDETTO ANDREA', position: 'ATT', birthDate: '2001-07-19' },
  { fullName: 'DOSSENA MATTIA', position: 'TD', birthDate: '2005-10-18' },
  { fullName: 'FIORI STEFANO', position: 'CC', birthDate: '2004-12-24' },
  { fullName: 'GAMARRA SIMON', position: 'ATT', birthDate: '2005-01-11' },
  { fullName: 'GRUOSSO CHRISTIAN', position: 'TD', birthDate: '2005-05-23' },
  { fullName: 'LAMONACA JACOPO', position: 'ATT', birthDate: '2003-09-30' },
  { fullName: 'MACCARONE CLAUDIO', position: 'CC', birthDate: '1986-11-26' },
  { fullName: 'MATESO ANDREA', position: 'DC', birthDate: '2000-03-07' },
  { fullName: 'MIRANDA ARIZA MATTIAS', position: 'TS', birthDate: '2005-04-05' },
  { fullName: 'MUGNAINI TOMMASO', position: 'DC', birthDate: '2004-08-26' },
  { fullName: 'OPIZZI LORENZO', position: 'TD', birthDate: '1999-12-10' },
  { fullName: 'PONZI DANIELE', position: 'ATT', birthDate: '2005-02-19' },
  { fullName: 'QUISINI NATHAN', position: 'CC', birthDate: '2005-04-19' },
  { fullName: 'RUTIGLIANO MATTIA', position: 'CC', birthDate: '2006-10-22' },
  { fullName: 'SCARAMUZZI RICCARDO', position: 'POR', birthDate: '2007-06-13' },
  { fullName: 'TERRANEO GIACOMO', position: 'CC', birthDate: '2004-02-23' },
  { fullName: 'THOMAS VERDE', position: 'CC', birthDate: '2000-01-10' }
];

export const slug = (name) =>
  name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');

export const emptyStats = () => ({
  appearances: 0, starts: 0, subs: 0, minutes: 0, goals: 0, assists: 0,
  yellowCards: 0, redCards: 0, avgRating: null, callups: 0, trainingsAttended: 0
});
