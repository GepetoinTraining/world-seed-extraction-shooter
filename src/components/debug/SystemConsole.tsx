import React, { useEffect, useRef, useState } from 'react';
import { useLogStore } from './LogStore';
import { 
  Paper, Stack, Text, ScrollArea, TextInput, 
  Badge, Group, ActionIcon, Kbd, Transition
} from '@mantine/core';

const LEVEL_COLORS = {
  info: 'emerald',
  warn: 'yellow',
  error: 'red',
  debug: 'gray'
};

export const SystemConsole: React.FC = () => {
  const { logs, isOpen, toggle, clear } = useLogStore();
  const [filter, setFilter] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Global Keybind listener for `~`
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '`' || e.key === '~') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle]);

  // Filter logic
  const filteredLogs = logs.filter(l => 
    l.message.toLowerCase().includes(filter.toLowerCase()) || 
    l.tag.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <Transition transition="slide-up" mounted={isOpen} duration={200}>
      {(styles) => (
        <Paper
          style={{ 
            ...styles,
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            height: '40vh',
            zIndex: 9999,
            borderTop: '2px solid var(--mantine-color-emerald-6)',
            backgroundColor: 'rgba(5, 5, 5, 0.95)',
            display: 'flex',
            flexDirection: 'column'
          }}
          shadow="xl"
          radius={0}
        >
          {/* Toolbar */}
          <Group p="xs" justify="space-between" bg="dark.8" style={{ borderBottom: '1px solid #333' }}>
            <Group>
              <Text fw={900} c="emerald" size="sm" tt="uppercase" style={{ letterSpacing: 1 }}>
                NerveGear Console
              </Text>
              <Badge variant="outline" color="gray" size="xs">{logs.length} EVENTS</Badge>
            </Group>
            
            <Group>
              <TextInput 
                placeholder="Filter logs..." 
                size="xs" 
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                styles={{ input: { backgroundColor: '#111', borderColor: '#333' } }}
              />
              <ActionIcon variant="subtle" color="gray" onClick={clear} title="Clear Log">
                🗑️
              </ActionIcon>
              <ActionIcon variant="subtle" color="red" onClick={toggle} title="Close (~) ">
                ✕
              </ActionIcon>
            </Group>
          </Group>

          {/* Log Stream */}
          <ScrollArea flex={1} p="xs" viewportRef={scrollRef}>
            <Stack gap={2}>
              {filteredLogs.map((log) => (
                <Group key={log.id} gap="xs" align="flex-start" wrap="nowrap">
                  <Text size="xs" c="dimmed" ff="monospace" style={{ minWidth: 60 }}>
                    {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}
                  </Text>
                  
                  <Badge 
                    size="xs" 
                    variant="filled" 
                    color={LEVEL_COLORS[log.level]} 
                    style={{ minWidth: 70 }}
                  >
                    {log.tag}
                  </Badge>
                  
                  <Text 
                    size="xs" 
                    ff="monospace" 
                    c={log.level === 'error' ? 'red.4' : 'gray.3'}
                    style={{ wordBreak: 'break-all' }}
                  >
                    {log.message.replace(`[${log.tag}]`, '')}
                  </Text>
                </Group>
              ))}
              {filteredLogs.length === 0 && (
                <Text c="dimmed" size="xs" ta="center" mt="md">-- NO SIGNALS DETECTED --</Text>
              )}
            </Stack>
          </ScrollArea>
        </Paper>
      )}
    </Transition>
  );
};