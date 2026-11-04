/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'browser' when built for the domain: the save lives in this browser (DEPLOY.md). */
  readonly VITE_WS_STORE?: 'browser';
  /** This game's own origin, the only one a player's Ollama is told to answer (LocalSetup.ts). */
  readonly VITE_WS_ORIGIN?: string;
}
