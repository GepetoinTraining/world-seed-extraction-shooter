import './src/logic/theme/installOnLoad';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import App from './App';
import { VaultGate } from './src/components/VaultGate';
import { theme } from './src/theme';
import { GameClock } from './src/logic/time/GameClock';

// The game's time comes from its own server, and through it from its hub (D135)
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
        <App />
      </VaultGate>
    </MantineProvider>
  </React.StrictMode>
);