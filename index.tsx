import './src/logic/theme/installOnLoad';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import App from './App';
import { VaultGate } from './src/components/VaultGate';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { theme } from './src/theme';
import { GameClock } from './src/logic/time/GameClock';
import { StoreClient } from './shared/entities/data/StoreClient';

// Built for the domain (npm run build:site), the game is the page: its save is in this browser,
// and its time is the hub's, beside it on the same domain (DEPLOY.md). Otherwise a server on this
// machine holds both, as in development.
if (import.meta.env.VITE_WS_STORE === 'browser') {
  StoreClient.useLocal(import('./src/entities/data/BrowserStore').then(m => m.openBrowserStore()));
  GameClock.configure({ read: () => GameClock.readHub('/api/hub/clock') });
  // The door is the page's own: the player's machine, or the player's own key, never our servers
  void Promise.all([import('./src/logic/intelligence/PageDoor'), import('./src/logic/intelligence/KeyVault'), import('./src/logic/intelligence/DoorTransport')])
    .then(([{ openPageDoor }, { createKeyVault, indexedDbShelf }, { DoorTransport }]) => DoorTransport.usePage(openPageDoor(), createKeyVault(indexedDbShelf())));
}
void GameClock.keepInStep();

// 1. Core Mantine Styles
import '@mantine/core/styles.css';

// 2. Custom CSS (Must be after Mantine to override)
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = createRoot(rootElement);
root.render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark" forceColorScheme="dark">
      <VaultGate>
        {/* T2: the last thing that can catch an error while drawing. The app's own screens have one each, inside */}
        <ErrorBoundary whole>
          <App />
        </ErrorBoundary>
      </VaultGate>
    </MantineProvider>
  </React.StrictMode>
);