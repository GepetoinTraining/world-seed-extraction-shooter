import React from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import App from './App';
import { theme } from './src/theme';

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
      <App />
    </MantineProvider>
  </React.StrictMode>
);