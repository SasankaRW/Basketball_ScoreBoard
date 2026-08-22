import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import { ensureFirestoreClient } from '../core/firestoreClient.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

/**
 * Firestore is fetched as a separate chunk and connected before the app pages
 * render, so every page can call the synchronous `getFirestoreClient()`
 * afterwards instead of threading a promise through every component.
 */
void ensureFirestoreClient().then(() => {
  createRoot(container).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
});
