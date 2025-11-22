import React from 'react';
import { IItem, UniversalRank } from '../../../../types';
import { SimpleGrid, Paper, Tooltip, Text, Stack, Badge, Menu, rem } from '@mantine/core';

interface InventoryGridProps {
  items: IItem[];
  capacity: number;
  onItemClick?: (item: IItem) => void; // For transfer
  onItemAction?: (action: 'TRASH' | 'IDENTIFY' | 'STUDY', item: IItem) => void;
  title?: string;
}

// Rank Colors Helper
const RANK_COLORS: Record<UniversalRank, string> = {
  [UniversalRank.F]: 'gray', [UniversalRank.E]: 'gray', [UniversalRank.D]: 'blue',
  [UniversalRank.C]: 'green', [UniversalRank.B]: 'violet', [UniversalRank.A]: 'orange',
  [UniversalRank.S]: 'red', [UniversalRank.SS]: 'red', [UniversalRank.SSS]: 'yellow'
};

export const InventoryGrid: React.FC<InventoryGridProps> = ({ items, capacity, onItemClick, onItemAction, title }) => {
  
  // Create grid slots (filled + empty)
  const slots = Array.from({ length: capacity }).map((_, i) => items[i] || null);

  return (
    <Paper p="xs" bg="dark.8" withBorder style={{ borderColor: '#333' }}>
        {title && <Text size="xs" c="dimmed" mb={4} tt="uppercase" fw={700}>{title} ({items.length}/{capacity})</Text>}
        
        <SimpleGrid cols={5} spacing={4}>
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

const InventorySlot = ({ item, onClick, onAction }: { item: IItem | null, onClick: () => void, onAction?: any }) => {
    if (!item) {
        return <div style={{ width: 40, height: 40, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }} />;
    }

    const color = RANK_COLORS[item.rank] || 'gray';
    const isUnknown = !item.isIdentified;

    return (
        <Menu shadow="md" width={200} trigger="contextmenu">
            <Menu.Target>
                <Tooltip label={isUnknown ? "Unidentified Object" : item.name} color="dark">
                    <div 
                        onClick={onClick}
                        style={{ 
                            width: 40, height: 40, 
                            background: 'rgba(0,0,0,0.5)', 
                            border: `1px solid var(--mantine-color-${color}-6)`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', position: 'relative'
                        }}
                    >
                        {/* Icon Placeholder */}
                        <div style={{ fontSize: 20 }}>
                            {item.visuals?.iconUrl || (item.type === 'GEAR' ? '⚔️' : '📦')}
                        </div>
                        
                        {/* Unidentified Overlay */}
                        {isUnknown && (
                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Text size="xs" c="red">?</Text>
                            </div>
                        )}
                    </div>
                </Tooltip>
            </Menu.Target>

            <Menu.Dropdown>
                <Menu.Label>{item.name}</Menu.Label>
                {!item.isIdentified && <Menu.Item color="blue" onClick={() => onAction('IDENTIFY', item)}>Identify (3s)</Menu.Item>}
                {item.isIdentified && <Menu.Item color="violet" onClick={() => onAction('STUDY', item)}>Study (Destroy)</Menu.Item>}
                <Menu.Divider />
                <Menu.Item color="red" onClick={() => onAction('TRASH', item)}>Trash</Menu.Item>
            </Menu.Dropdown>
        </Menu>
    );
}