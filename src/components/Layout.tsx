import React from 'react';
import { AppShell, Group, Text, Badge, Burger, rem } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

interface LayoutProps {
  children: React.ReactNode;
  title: string;
  status: 'ONLINE' | 'OFFLINE' | 'DIVE_ACTIVE';
  // Slots for the Sidebar and Aside to be passed from App.tsx
  navbar?: React.ReactNode;
  aside?: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children, title, status, navbar, aside }) => {
  // Mobile nav toggle
  const [opened, { toggle }] = useDisclosure();

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 300, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      aside={{ width: 250, breakpoint: 'md', collapsed: { mobile: true } }}
      padding="md"
      bg="dark.8" // App background
    >
      <AppShell.Header p="md" bg="dark.7" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
        <Group justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--mantine-color-gold-5)' }} />
            <Text fw={700} size="lg" style={{ letterSpacing: '0.1em' }}>WORLD SEED</Text>
            <Text size="xs" c="dimmed" pt={4}>V.0.1.0</Text>
          </Group>

          <Group gap="xs">
            <Badge variant="outline" color={status === 'DIVE_ACTIVE' ? 'emerald' : 'gold'}>
              {status}
            </Badge>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md" bg="dark.6" style={{ borderRight: '1px solid var(--mantine-color-dark-4)' }}>
        {navbar}
      </AppShell.Navbar>

      <AppShell.Main bg="dark.8">
        {children}
      </AppShell.Main>

      <AppShell.Aside p="md" bg="dark.7" style={{ borderLeft: '1px solid var(--mantine-color-dark-4)' }}>
        {aside}
      </AppShell.Aside>
      
      {/* Footer is optional, can add if needed */}
    </AppShell>
  );
};