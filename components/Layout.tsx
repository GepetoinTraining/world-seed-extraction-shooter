import React from 'react';

interface LayoutProps {
  children: React.ReactNode;
  title: string;
  status: 'ONLINE' | 'OFFLINE' | 'DIVE_ACTIVE';
}

export const Layout: React.FC<LayoutProps> = ({ children, title, status }) => {
  return (
    <div className="min-h-screen bg-seed-black text-gray-300 font-mono flex flex-col overflow-hidden relative selection:bg-seed-gold selection:text-black">
      
      {/* Background Grid Effect (CSS-only implementation for performance) */}
      <div className="absolute inset-0 z-0 opacity-10 pointer-events-none" 
           style={{
             backgroundImage: 'linear-gradient(#222 1px, transparent 1px), linear-gradient(90deg, #222 1px, transparent 1px)',
             backgroundSize: '40px 40px'
           }}>
      </div>

      {/* Top Header / HUD */}
      <header className="relative z-10 flex items-center justify-between px-6 py-3 border-b border-seed-border bg-seed-dark/90 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <div className="w-3 h-3 bg-seed-gold animate-pulse rounded-full shadow-[0_0_10px_rgba(255,215,0,0.5)]" />
          <h1 className="text-lg font-bold tracking-widest text-seed-silver uppercase">
            WORLD SEED <span className="text-xs text-gray-500 align-top">V.0.1.0</span>
          </h1>
        </div>
        
        <div className="flex items-center gap-8 text-xs tracking-wider">
          <div className="flex flex-col items-end">
            <span className="text-gray-500">SYSTEM STATUS</span>
            <span className={status === 'DIVE_ACTIVE' ? 'text-emerald-500' : 'text-seed-gold'}>
              {status}
            </span>
          </div>
          <div className="flex flex-col items-end">
             <span className="text-gray-500">LATENCY</span>
             <span className="text-emerald-500">12ms</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 overflow-hidden flex">
        {children}
      </main>

      {/* Footer / Debug Console Line */}
      <footer className="relative z-10 px-6 py-1 bg-seed-black border-t border-seed-border text-[10px] text-gray-600 flex justify-between">
        <span>ID: USER_ALPHA_001</span>
        <span>MEM_USAGE: 128MB // RENDERER: READY</span>
      </footer>
    </div>
  );
};