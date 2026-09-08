/**
 * Seed Firestore with the club configuration and the 2026/2027 squad.
 *
 *   1. Firebase console > Project settings > Service accounts > Generate new private key
 *   2. Save it as serviceAccount.json in the project root (already git-ignored)
 *   3. Create your own user in Authentication > Users
 *   4. ADMIN_UID=<your-uid> npm run seed
 *
 * Re-running is safe: documents are keyed by a slug of the player name.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const svc = JSON.parse(readFileSync(new URL('../serviceAccount.json', import.meta.url)));
initializeApp({ credential: cert(svc) });
const db = getFirestore();

import { SQUAD, slug, emptyStats } from '../src/lib/seedData.js';

const CLUB = {
  clubName: 'Settimo Milanese',
  teamName: 'Prima Squadra',
  season: '2026/2027',
  logoUrl: '/logo-fallback.svg',
  colors: { primary: '#D40000', primaryDark: '#A80000' },
  homeStadium: 'Centro Sportivo Comunale, Settimo Milanese',
  defaultMeetingPoint: 'Spogliatoi campo di casa',
  defaultKit: 'Tuta sociale, borsa personale, parastinchi, scarpini',
  maxCallup: 20,
  closingLine: 'Forza Settimo! 🔴⚪',
  defaultModule: '4-3-1-2',
  competitions: ['Prima Categoria', 'Coppa Lombardia', 'Amichevole'],
  trainingLocations: ['Campo comunale — sintetico', 'Campo comunale — erba'],
  staff: { head_coach: 'Mattia Franchi', assistant_coach: '', team_manager: '', athletic_trainer: '', gk_coach: '' },
  updatedAt: FieldValue.serverTimestamp()
};


async function run() {
  await db.doc('config/club').set(CLUB, { merge: true });
  await db.doc('config/branding').set(
    { clubName: CLUB.clubName, season: CLUB.season, logoUrl: CLUB.logoUrl }, { merge: true }
  );
  console.log('✓ configurazione società');

  const batch = db.batch();
  SQUAD.forEach((p) => {
    batch.set(db.doc(`players/${slug(p.fullName)}`), {
      ...p,
      birthDate: new Date(p.birthDate),
      secondaryPosition: '',
      shirtNumber: null,
      preferredFoot: 'destro',
      phone: '', email: '',
      active: true,
      registered: true,
      injury: { active: false },
      stats: emptyStats(),
      createdAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
  await batch.commit();
  console.log(`✓ ${SQUAD.length} giocatori caricati`);

  const uid = process.env.ADMIN_UID;
  if (uid) {
    await db.doc(`users/${uid}`).set({
      name: 'Mattia Franchi', role: 'admin', active: true, createdAt: FieldValue.serverTimestamp()
    }, { merge: true });
    console.log(`✓ utente ${uid} impostato come amministratore`);
  } else {
    console.log('! ADMIN_UID non impostato: assegna il ruolo admin manualmente in users/{uid}');
  }
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
