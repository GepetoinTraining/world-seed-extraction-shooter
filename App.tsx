import React, { useState } from 'react';
import { Layout } from './components/Layout';
import { WorldCanvas } from './components/WorldCanvas';
import { ItemFactory } from './utils/ItemFactory';
import { 
  IPlayer, 
  UniversalRank, 
  IItem
} from './types';
import { RANK_COLORS } from './constants';

const INITIAL_PLAYER: IPlayer = {
  id: 'alpha-tester',
  username: 'Kirito_Zero',
  bank: {
    accountId: 'acc_001_alpha',
    gold: 4500,
    stashTabs: [
      {
        name: 'MAIN STASH',
        items: [
          ItemFactory.createItem(UniversalRank.E),
          ItemFactory.createItem(UniversalRank.D),
          ItemFactory.createItem(UniversalRank.F),
          ItemFactory.createItem(),
        ]
      },
      {
        name: 'CRAFTING MATS',
        items: []
      }
    ],
    universalSkills: {
      'swordsmanship': 50,
      'hacking': 12
    }
  },
  currentSession: undefined
};

export default function App() {
  const [player, setPlayer] = useState<IPlayer>(INITIAL_PLAYER);
  const [view, setView] = useState<'BANK' | 'SESSION'>('BANK');

  // Helper to get main stash items
  const mainStashItems = player.bank.stashTabs[0].items;

  // Simulate a "Dive"
  const handleDive = () => {
    if (view === 'SESSION') {
      // Extract - Move session inventory to bank (Simplified)
      const sessionLoot = player.currentSession?.inventory || [];
      if (sessionLoot.length > 0) {
        setPlayer(prev => ({
            ...prev,
            bank: {
                ...prev.bank,
                stashTabs: prev.bank.stashTabs.map((tab, idx) => 
                    idx === 0 ? { ...tab, items: [...tab.items, ...sessionLoot] } : tab
                )
            },
            currentSession: undefined
        }));
      } else {
          setPlayer(prev => ({ ...prev, currentSession: undefined }));
      }
      setView('BANK');
    } else {
      // Enter - Generate a new session
      setPlayer(prev => ({
        ...prev,
        currentSession: {
          sessionId: crypto.randomUUID(),
          layerId: 'layer-01-fantasy',
          inventory: [], // Start empty
          health: 100,
          maxHealth: 100,
          energy: 100,
          position: { x: 0, y: 0, z: 0 },
          statusEffects: []
        }
      }));
      setView('SESSION');
    }
  };

  // Simulation: Loot finding mechanism while in session
  const handleSimulateLoot = () => {
      if (!player.currentSession) return;
      const newItem = ItemFactory.createItem();
      setPlayer(prev => {
          if (!prev.currentSession) return prev;
          return {
              ...prev,
              currentSession: {
                  ...prev.currentSession,
                  inventory: [...prev.currentSession.inventory, newItem]
              }
          };
      });
  };

  // Calculate Player "Rank" roughly based on best item for display
  const playerDisplayRank = mainStashItems.reduce((highest, item) => {
    const ranks = Object.values(UniversalRank);
    const currentIdx = ranks.indexOf(highest);
    const itemIdx = ranks.indexOf(item.rank);
    return itemIdx > currentIdx ? item.rank : highest;
  }, UniversalRank.F);

  return (
    <Layout title="DASHBOARD" status={view === 'SESSION' ? 'DIVE_ACTIVE' : 'ONLINE'}>
      
      {/* LEFT PANEL: PLAYER IDENTITY (Persistent) */}
      <aside className="w-80 border-r border-seed-border bg-seed-panel/50 p-6 flex flex-col gap-6 z-20">
        
        {/* Avatar / Card */}
        <div className="border border-seed-border p-4 relative overflow-hidden group bg-black/60">
          <div className={`absolute top-0 right-0 px-2 py-1 text-xs font-bold bg-black border-l border-b border-seed-border ${RANK_COLORS[playerDisplayRank]}`}>
            RANK {playerDisplayRank}
          </div>
          <div className="w-20 h-20 bg-zinc-800 mb-4 flex items-center justify-center text-2xl ring-1 ring-zinc-700">
            👾
          </div>
          <h2 className="text-xl font-bold text-white">{player.username}</h2>
          <p className="text-xs text-gray-500 font-mono">ID: {player.id.substring(0,8)}</p>
          
          <div className="mt-4 space-y-2 text-sm font-mono">
            <div className="flex justify-between">
              <span className="text-gray-500">GOLD</span>
              <span className="text-seed-gold">{player.bank.gold.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">STASH</span>
              <span className="text-blue-400">{player.bank.stashTabs.length} / 5</span>
            </div>
          </div>
        </div>

        {/* Menu Actions */}
        <nav className="space-y-2 font-mono text-xs">
          <button 
            onClick={() => setView('BANK')}
            disabled={view === 'SESSION'}
            className={`w-full text-left px-4 py-3 border transition-all ${view === 'BANK' ? 'border-seed-gold bg-seed-gold/10 text-white' : 'border-transparent text-gray-500'}`}
          >
            [ F1 ] THE BANK (COLD)
          </button>
          <button disabled className="w-full text-left px-4 py-3 border border-transparent text-gray-600 cursor-not-allowed">
            [ F2 ] MARKETPLACE (LOCKED)
          </button>
          <button disabled className="w-full text-left px-4 py-3 border border-transparent text-gray-600 cursor-not-allowed">
            [ F3 ] CONTRACTS (LOCKED)
          </button>
        </nav>

        {/* Session Stats (Only visible during Dive) */}
        {view === 'SESSION' && player.currentSession && (
             <div className="mt-auto border border-emerald-900/50 bg-emerald-900/10 p-4 text-xs font-mono space-y-2">
                <div className="text-emerald-500 font-bold mb-2">SESSION METRICS</div>
                <div className="flex justify-between">
                    <span>INTEGRITY</span>
                    <span className="text-white">{player.currentSession.health}/{player.currentSession.maxHealth}</span>
                </div>
                <div className="flex justify-between">
                    <span>ENERGY</span>
                    <span className="text-white">{player.currentSession.energy}%</span>
                </div>
                <div className="flex justify-between">
                    <span>CARRIED MASS</span>
                    <span className="text-white">{player.currentSession.inventory.length} ITEMS</span>
                </div>
                <button 
                    onClick={handleSimulateLoot}
                    className="w-full mt-2 py-2 bg-emerald-500/20 border border-emerald-500/50 hover:bg-emerald-500/30 text-emerald-400 transition-colors"
                >
                    DEBUG: FORCE LOOT
                </button>
             </div>
        )}

        {/* Dive Button */}
        <div className={view !== 'SESSION' ? "mt-auto" : "mt-4"}>
          <button 
            onClick={handleDive}
            className={`w-full py-4 font-bold tracking-widest uppercase transition-all border font-mono ${
              view === 'SESSION' 
                ? 'bg-rose-900/20 border-rose-500 text-rose-500 hover:bg-rose-900/40'
                : 'bg-emerald-900/20 border-emerald-500 text-emerald-500 hover:bg-emerald-900/40'
            }`}
          >
            {view === 'SESSION' ? 'EMERGENCY JACK-OUT' : 'LINK START // DIVE'}
          </button>
        </div>
      </aside>

      {/* CENTER PANEL: CONTEXTUAL VIEW */}
      <section className="flex-1 overflow-hidden relative bg-black">
        
        {view === 'BANK' ? (
          <div className="p-8 h-full overflow-y-auto animate-in fade-in duration-500">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-2xl text-white font-light tracking-tight">SECURE STORAGE</h3>
                <p className="text-gray-500 text-xs font-mono mt-1">Items persist across session collapse.</p>
              </div>
              <div className="text-right font-mono">
                <span className="text-2xl">{mainStashItems.length}</span>
                <span className="text-gray-600 text-sm"> / 50</span>
              </div>
            </div>

            {/* Grid of Items */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {mainStashItems.map((item) => (
                <ItemCard key={item.id} item={item} />
              ))}
              
              {/* Empty Slots Visual */}
              {Array.from({ length: Math.max(0, 15 - mainStashItems.length) }).map((_, i) => (
                <div key={i} className="aspect-square border border-dashed border-zinc-800 bg-transparent flex items-center justify-center opacity-20">
                  <span className="text-xl text-zinc-700">+</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          // RENDER PHASE 2: 3D WORLD CANVAS
          <div className="w-full h-full animate-in fade-in duration-1000">
              {player.currentSession && <WorldCanvas session={player.currentSession} />}
          </div>
        )}

      </section>
      
      {/* RIGHT PANEL: WORLD STATE / LOGS */}
      <aside className="w-64 border-l border-seed-border bg-black p-0 flex flex-col z-20">
        <div className="p-3 border-b border-seed-border bg-seed-panel">
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider font-mono">World Log</h3>
        </div>
        <div className="flex-1 p-4 overflow-hidden relative">
          <div className="space-y-3 text-[10px] font-mono opacity-80">
            <div className="text-gray-500">
              <span className="text-blue-500">[SYSTEM]</span> Gateway Latency: 12ms
            </div>
             {view === 'SESSION' && (
                 <div className="text-emerald-500 animate-pulse">
                 <span>[NET]</span> Streaming Layer Data...
                </div>
             )}
             {player.currentSession?.inventory.map((item, i) => (
                 <div key={i} className="text-gray-400">
                     <span className="text-yellow-500">[LOOT]</span> Acquired <span className={RANK_COLORS[item.rank].split(' ')[0]}>{item.name}</span> ({item.itemPower} IP)
                 </div>
             ))}
          </div>
          
          <div className="absolute bottom-0 left-0 w-full h-20 bg-gradient-to-t from-black to-transparent pointer-events-none" />
        </div>
      </aside>

    </Layout>
  );
}

// Sub-component for individual item display
const ItemCard = ({ item }: { item: IItem }) => {
    const qualityPercent = (item.quality * 100).toFixed(0);
    const qualityColor = item.quality > 0 ? 'text-green-400' : item.quality < 0 ? 'text-red-400' : 'text-gray-500';

    return (
        <div className={`aspect-square p-2 border bg-black/40 hover:bg-zinc-900 transition-colors cursor-pointer group relative flex flex-col ${RANK_COLORS[item.rank]}`}>
            <div className="flex justify-between items-start">
              <span className="text-[9px] font-bold border px-1 rounded border-current opacity-70">
                  {item.rank}
              </span>
              <span className={`text-[9px] font-mono ${qualityColor}`}>
                {item.quality > 0 ? '+' : ''}{qualityPercent}%
              </span>
            </div>
            
            <div className="flex-1 flex items-center justify-center text-3xl opacity-60 group-hover:opacity-100 transition-all group-hover:scale-110">
             {/* Simple icon based on slot/type could go here */}
             {item.slot.includes('HAND') ? '⚔️' : '🛡️'}
            </div>

            <div className="mt-auto">
                <div className="text-[10px] font-bold truncate text-gray-300 group-hover:text-white leading-tight">
                    {item.name}
                </div>
                <div className="flex justify-between items-baseline">
                  <div className="text-[9px] text-gray-600 uppercase mt-0.5">
                      {item.slot.replace('_', ' ')}
                  </div>
                  <div className="text-[9px] text-gray-400 font-mono">
                    {item.itemPower} IP
                  </div>
                </div>
            </div>
            
            {/* Hover Tooltip (Complex) */}
            <div className="absolute opacity-0 group-hover:opacity-100 bottom-full left-0 w-64 bg-zinc-950 border border-zinc-700 p-3 z-50 pointer-events-none mb-2 shadow-2xl shadow-black">
                <div className={`text-xs font-bold mb-1 ${RANK_COLORS[item.rank].split(' ')[0]}`}>{item.name}</div>
                <div className="text-[10px] text-gray-400 italic mb-2">{item.description}</div>
                
                {/* Base Stats */}
                <div className="border-t border-zinc-800 py-1 space-y-0.5 mb-2">
                   <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Properties</div>
                    {Object.entries(item.stats).map(([k,v]) => (
                        <div key={k} className="flex justify-between text-[10px] text-gray-300">
                            <span className="capitalize text-gray-400">{k.replace(/_/g, ' ')}</span>
                            <span className="font-mono">{v}</span>
                        </div>
                    ))}
                </div>

                {/* Affixes */}
                {item.affixes.length > 0 && (
                  <div className="border-t border-zinc-800 py-1 space-y-1">
                     <div className="text-[9px] text-blue-400 uppercase tracking-wider mb-1">Modifiers</div>
                     {item.affixes.map((affix, i) => (
                       <div key={i} className="text-[10px] text-blue-200 flex justify-between">
                         <span>{affix.name}</span>
                         <span className="text-gray-500 text-[8px]">{affix.type}</span>
                       </div>
                     ))}
                  </div>
                )}
            </div>
        </div>
    )
}