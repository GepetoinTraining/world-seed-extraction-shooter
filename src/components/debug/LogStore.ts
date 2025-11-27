import { create } from 'zustand';

export interface ILogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  tag: string; // e.g. "BOOT", "VECTOR", "SYSTEM"
}

interface LogState {
  logs: ILogEntry[];
  isOpen: boolean;
  toggle: () => void;
  addLog: (level: ILogEntry['level'], args: any[]) => void;
  clear: () => void;
}

// Helper to extract "[TAG] Message" pattern
const parseTag = (msg: string): string => {
  const match = msg.match(/^\[([A-Z_]+)\]/);
  return match ? match[1] : 'SYSTEM';
};

export const useLogStore = create<LogState>((set, get) => ({
  logs: [],
  isOpen: false, // Default closed (toggle with `~` key)
  
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  
  clear: () => set({ logs: [] }),

  addLog: (level, args) => {
    // specific formatting for objects
    const message = args.map(a => 
      typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
    ).join(' ');

    const newEntry: ILogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      level,
      message,
      tag: parseTag(message)
    };

    set((state) => ({
      logs: [newEntry, ...state.logs].slice(0, 500) // Keep last 500 logs
    }));
  }
}));

// --- THE INTERCEPTOR ---
// Run this once in App.tsx to hook into the matrix
export const installConsoleInterceptor = () => {
  if ((window as any).__consoleInterceptorsInstalled) return;
  (window as any).__consoleInterceptorsInstalled = true;

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args) => {
    useLogStore.getState().addLog('info', args);
    originalLog(...args);
  };

  console.warn = (...args) => {
    useLogStore.getState().addLog('warn', args);
    originalWarn(...args);
  };

  console.error = (...args) => {
    useLogStore.getState().addLog('error', args);
    originalError(...args);
  };
  
  console.log('[SYSTEM] NerveGear Link Established. Console intercepted.');
};