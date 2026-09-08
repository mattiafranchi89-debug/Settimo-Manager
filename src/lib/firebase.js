import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, serverTimestamp } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const config = {
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FB_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FB_APP_ID
};

export const configMissing = !config.apiKey || !config.projectId;

const app = initializeApp(
  configMissing ? { apiKey: 'demo', projectId: 'demo-settimo', appId: 'demo' } : config
);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const now = serverTimestamp;
export default app;
