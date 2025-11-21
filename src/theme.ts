import { createTheme, Button, Modal, Paper, Input, MantineColorsTuple, Card } from '@mantine/core';

// --- PALETTE GENERATION ---

// "Seed Green" (Emerald)
const seedGreen: MantineColorsTuple = [
  '#e2fcf0', '#bbf6da', '#8defc1', '#5ce8a7', '#36e290', 
  '#20de81', '#10c470', '#069855', '#006d3c', '#004323'
];

// "Seed Gold"
const seedGold: MantineColorsTuple = [
  '#fffbdd', '#fff6b3', '#ffef85', '#ffe852', '#ffe125', 
  '#ffd700', '#e6bf00', '#b39500', '#806a00', '#4d4000'
];

// "Void Black" (Dark replacement)
const voidBlack: MantineColorsTuple = [
  '#a1a1aa', '#71717a', '#52525b', '#3f3f46', '#27272a', 
  '#18181b', '#111111', '#0a0a0a', '#050505', '#000000'
];

// --- THEME DEFINITION ---

export const theme = createTheme({
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  
  // Visual Physics: Sharp edges, dark mode
  defaultRadius: 0,
  primaryColor: 'emerald',
  primaryShade: 5,
  
  colors: {
    emerald: seedGreen,
    gold: seedGold,
    dark: voidBlack,
  },

  components: {
    Button: Button.extend({
      defaultProps: { variant: 'outline', size: 'xs' },
      styles: {
        root: {
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          borderWidth: '1px',
          fontWeight: 600,
        },
      },
    }),
    Paper: Paper.extend({
      defaultProps: { withBorder: true, bg: 'dark.6' },
    }),
    Card: Card.extend({
      defaultProps: { withBorder: true, bg: 'dark.6' },
    }),
    Input: Input.extend({
      defaultProps: { variant: 'filled' },
      styles: (theme) => ({
        input: {
          backgroundColor: theme.colors.dark[8],
          borderColor: theme.colors.dark[4],
          color: theme.colors.emerald[5],
          fontFamily: theme.fontFamilyMonospace,
          '&:focus': { borderColor: theme.colors.emerald[5] },
        },
      }),
    }),
  },

  headings: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    sizes: {
      h1: { fontSize: '1.5rem', lineHeight: '1.1', fontWeight: '700' },
      h2: { fontSize: '1.25rem', lineHeight: '1.2', fontWeight: '600' },
    },
  },
});