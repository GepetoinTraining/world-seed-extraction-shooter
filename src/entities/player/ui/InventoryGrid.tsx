import React, { useState } from 'react';
import { IItem, UniversalRank, Rarity } from '../../../../types';
import { SimpleGrid, Paper, Tooltip, Text, Menu, Indicator, rem } from '@mantine/core';

// --- VISUAL CONSTANTS ---
const RARITY_COLORS: Record<Rarity, string> = {
  [Rarity.SCRAP]: 'gray',
  [Rarity.COMMON]: 'dark', // Defaults to borderless/standard
  [Rarity.UNCOMMON]: 'green',
  [Rarity.RARE]: 'blue',
  [Rarity.EPIC]: 'violet',
  [Rarity.LEGENDARY]: 'orange', // Gold/Orange
  [Rarity.ARTIFACT]: 'red'
};

const RANK_BADGE_COLORS: Record<UniversalRank, string> = {
  'F': 'gray', 'E': 'gray', 'D': 'green', 'C': 'blue', 
  'B': 'violet', 'A': 'orange', 'S': 'red', 'SS': 'red', 'SSS': 'yellow'
};

interface InventoryGridProps {
  items: IItem[];
  capacity: number;
  onItemClick?: (item: IItem) => void;
  onItemAction?: (action: 'TRASH' | 'IDENTIFY' | 'STUDY' | 'EQUIP', item: IItem) => void;
  title?: string;
}

export const InventoryGrid: React.FC<InventoryGridProps> = ({ items, capacity, onItemClick, onItemAction, title }) => {
  // Create fixed-size grid (filled items + nulls for empty slots)
  const slots = Array.from({ length: capacity }).map((_, i) => items[i] || null);

  return (
    <Paper p="sm" bg="dark.8" withBorder style={{ borderColor: '#333' }}>
        {title && (
          <Text size="xs" c="dimmed" mb="xs" tt="uppercase" fw={700} style={{ letterSpacing: 1 }}>
            {title} <span style={{ color: '#555' }}>//</span> {items.length}/{capacity}
          </Text>
        )}
        
        <SimpleGrid cols={{ base: 4, sm: 6, md: 8, lg: 10 }} spacing={6}>
            {slots.map((item, idx) => (
                <InventorySlot 
                    key={item ? item.id : `empty-${idx}`} 
                    item={item} 
                    onClick={() => item && onItemClick?.(item)}
                    onAction={onItemAction}
                />
            ))}
        </SimpleGrid>
    </Paper>
  );
};

// ============================================================================
// SUB-COMPONENT: THE SLOT
// ============================================================================

const InventorySlot = ({ item, onClick, onAction }: { item: IItem | null, onClick: () => void, onAction?: any }) => {
    const [menuOpened, setMenuOpened] = useState(false);

    // 1. EMPTY SLOT RENDER
    if (!item) {
        return (
            <div 
                style={{ 
                    aspectRatio: '1/1', 
                    background: 'rgba(255,255,255,0.02)', 
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: 4
                }} 
            />
        );
    }

    // 2. ITEM VISUALS
    const colorName = RARITY_COLORS[item.rarity] || 'gray';
    const isUnknown = !item.isIdentified;
    const borderStyle = item.rarity === Rarity.COMMON 
        ? '1px solid #333' 
        : `1px solid var(--mantine-color-${colorName}-8)`;
    
    // Glowing effect for high tier loot
    const boxShadow = (item.rarity === Rarity.LEGENDARY || item.rarity === Rarity.ARTIFACT)
        ? `0 0 8px var(--mantine-color-${colorName}-9)` 
        : 'none';

    return (
        <Menu shadow="md" width={200} opened={menuOpened} onChange={setMenuOpened}>
            <Menu.Target>
                <Tooltip 
                    label={<TooltipContent item={item} />} 
                    color="dark.9" 
                    withArrow 
                    multiline 
                    w={220}
                    transitionProps={{ duration: 0 }}
                >
                    <div 
                        onClick={(e) => { e.stopPropagation(); onClick(); }}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpened(true); }}
                        style={{ 
                            aspectRatio: '1/1',
                            position: 'relative',
                            background: 'rgba(0,0,0,0.6)', 
                            border: borderStyle,
                            borderRadius: 4,
                            boxShadow: boxShadow,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer',
                            transition: 'transform 0.1s',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                    >
                        {/* ICON */}
                        <div style={{ fontSize: 24, filter: isUnknown ? 'blur(4px)' : 'none' }}>
                            {item.visuals?.iconUrl || item.icon || '📦'}
                        </div>
                        
                        {/* UNIDENTIFIED OVERLAY */}
                        {isUnknown && (
                            <div style={{ 
                                position: 'absolute', inset: 0, 
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'rgba(0,0,0,0.3)'
                            }}>
                                <Text size="lg" fw={900} c="red.5">?</Text>
                            </div>
                        )}

                        {/* RANK BADGE (Bottom Right) */}
                        <div style={{ 
                            position: 'absolute', bottom: 2, right: 2, 
                            fontSize: 9, fontWeight: 900, 
                            color: `var(--mantine-color-${RANK_BADGE_COLORS[item.rank]}-4)`,
                            fontFamily: 'monospace'
                        }}>
                            {item.rank}
                        </div>
                    </div>
                </Tooltip>
            </Menu.Target>

            {/* CONTEXT MENU */}
            <Menu.Dropdown>
                <Menu.Label>{item.isIdentified ? item.name : 'Unknown Object'}</Menu.Label>
                
                {/* Identification */}
                {!item.isIdentified && (
                    <Menu.Item 
                        leftSection="👁️" 
                        color="cyan" 
                        onClick={() => onAction?.('IDENTIFY', item)}
                    >
                        Identify
                    </Menu.Item>
                )}

                {/* Standard Actions */}
                {item.isIdentified && (
                    <>
                        <Menu.Item leftSection="⚔️" onClick={() => onAction?.('EQUIP', item)}>
                            Equip
                        </Menu.Item>
                        <Menu.Item leftSection="🔬" color="violet" onClick={() => onAction?.('STUDY', item)}>
                            Study (Destroy)
                        </Menu.Item>
                    </>
                )}
                
                <Menu.Divider />
                
                <Menu.Item 
                    leftSection="🗑️" 
                    color="red" 
                    onClick={() => onAction?.('TRASH', item)}
                >
                    Discard
                </Menu.Item>
            </Menu.Dropdown>
        </Menu>
    );
};

// ============================================================================
// HELPER: TOOLTIP CONTENT
// ============================================================================

const TooltipContent = ({ item }: { item: IItem }) => {
    if (!item.isIdentified) {
        return (
            <Text size="xs" c="red.4" fs="italic">
                Unidentified Signal.<br/>
                Stats obscured by quantum noise.
            </Text>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* Header */}
            <div>
                <Text fw={700} c={RARITY_COLORS[item.rarity] || 'white'}>
                    {item.name}
                </Text>
                <Text size="xs" c="dimmed">
                    {item.rarity} {item.type} • Rank {item.rank}
                </Text>
            </div>

            {/* Main Stats */}
            {Object.keys(item.stats).length > 0 && (
                <div style={{ padding: '4px 0', borderTop: '1px solid #444', borderBottom: '1px solid #444' }}>
                    {Object.entries(item.stats).map(([key, val]) => (
                        <div key={key} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Text size="xs" c="gray.4" tt="capitalize">{key.replace(/_/g, ' ')}</Text>
                            <Text size="xs" fw={700} c="white">{val}</Text>
                        </div>
                    ))}
                </div>
            )}

            {/* Affixes */}
            {item.affixes && item.affixes.length > 0 && (
                <div>
                    {item.affixes.map((affix, i) => (
                        <Text key={i} size="xs" c="blue.3">
                            ♦ {affix.name}
                        </Text>
                    ))}
                </div>
            )}

            {/* Flavor */}
            <Text size="xs" c="dimmed" fs="italic" mt={4}>
                "{item.description}"
            </Text>
        </div>
    );
};