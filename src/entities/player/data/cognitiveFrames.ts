import { ICognitiveFrame } from '../../../../types';

export const COGNITIVE_FRAMES: Record<string, ICognitiveFrame> = {
  // --- LOGIC FRAMES (Blue) ---
  'frame_analytic': {
    id: 'frame_analytic',
    name: 'Analytic Engine',
    description: 'Suppresses emotion to maximize pattern recognition.',
    type: 'LOGIC',
    colorHex: '#0ea5e9', // Sky Blue
    modifiers: {
      intelligence: 3,
      engineering: 2,
      hacking: 1,
      charisma: -2,
      intimidation: -2
    }
  },
  'frame_architect': {
    id: 'frame_architect',
    name: 'Structural Vision',
    description: 'Overlays geometry and stress points on the visual cortex.',
    type: 'LOGIC',
    colorHex: '#6366f1', // Indigo
    modifiers: {
      engineering: 4,
      focus: 2,
      agility: -2,
      perception: -1
    }
  },

  // --- INSTINCT FRAMES (Red) ---
  'frame_predator': {
    id: 'frame_predator',
    name: 'Apex Protocol',
    description: 'Heightens senses and aggression. Reduces complex thought.',
    type: 'INSTINCT',
    colorHex: '#ef4444', // Red
    modifiers: {
      perception: 3,
      intimidation: 3,
      strength: 1,
      intelligence: -2,
      bartering: -3
    }
  },
  'frame_flow': {
    id: 'frame_flow',
    name: 'Kinetic Flow',
    description: 'Synaptic acceleration for movement.',
    type: 'INSTINCT',
    colorHex: '#f59e0b', // Amber
    modifiers: {
      dexterity: 3,
      agility: 3,
      focus: 1,
      constitution: -2,
      strength: -1
    }
  },

  // --- SOCIAL FRAMES (Purple) ---
  'frame_diplomat': {
    id: 'frame_diplomat',
    name: 'Mirror Neurons',
    description: 'Emulates empathy and predicts social outcomes.',
    type: 'SOCIAL',
    colorHex: '#a855f7', // Purple
    modifiers: {
      charisma: 4,
      bartering: 2,
      subterfuge: 1,
      strength: -2,
      intimidation: -2
    }
  },
  'frame_shadow': {
    id: 'frame_shadow',
    name: 'Grey Man',
    description: 'Minimizes presence and vocal projection.',
    type: 'SOCIAL',
    colorHex: '#64748b', // Slate
    modifiers: {
      subterfuge: 4,
      hacking: 2,
      leadership: -3,
      charisma: -2
    }
  }
};