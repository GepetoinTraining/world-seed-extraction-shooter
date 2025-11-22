/**
 * ContentPipeline - Opal-Style DAG for Procedural Content Generation
 * 
 * Flow: Genre → Weapons → Mobs → Affixes → Spells
 * Each node feeds context to the next, creating coherent themed content.
 * 
 * Uses Gemini API for actual generation.
 */

import { UniversalRank, Rarity, GenreType } from '../../../types';

// =============================================================================
// TYPES
// =============================================================================

export interface IPipelineNode {
  id: string;
  type: 'GENRE' | 'WEAPONS' | 'MOBS' | 'AFFIXES' | 'SPELLS' | 'BIOMES';
  status: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'ERROR';
  input: any;
  output: any;
  error?: string;
}

export interface IPipelineState {
  id: string;
  name: string;
  createdAt: number;
  nodes: IPipelineNode[];
  currentNodeIndex: number;
  isComplete: boolean;
}

export interface IGeneratedGenre {
  id: string;
  name: string;
  description: string;
  aesthetic: string;
  keywords: string[];
  colorPalette: string[];
  techLevel: 'PRIMITIVE' | 'MEDIEVAL' | 'INDUSTRIAL' | 'MODERN' | 'FUTURISTIC' | 'TRANSCENDENT';
}

export interface IGeneratedWeapon {
  id: string;
  name: string;
  description: string;
  type: 'MELEE' | 'RANGED' | 'MAGIC' | 'HYBRID';
  baseRank: UniversalRank;
  tags: string[];
  implicitStats: { stat: string; min: number; max: number }[];
  flavorText: string;
}

export interface IGeneratedMob {
  id: string;
  name: string;
  description: string;
  behavior: string;
  baseRank: UniversalRank;
  tags: string[];
  abilities: string[];
  dropHints: string[];
  colorHex: string;
}

export interface IGeneratedAffix {
  id: string;
  name: string;
  type: 'PREFIX' | 'SUFFIX';
  description: string;
  statModifiers: { stat: string; min: number; max: number }[];
  allowedTags: string[];
  tier: number;
}

// =============================================================================
// PROMPTS
// =============================================================================

const PROMPTS = {
  GENRE: (input: { name: string; description: string }) => `
You are a game content designer. Create a detailed game genre/theme based on this concept:

Name: ${input.name}
Description: ${input.description}

Respond with a JSON object (no markdown, just raw JSON):
{
  "id": "genre_[snake_case_name]",
  "name": "[Display Name]",
  "description": "[2-3 sentence description]",
  "aesthetic": "[Visual style description]",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "colorPalette": ["#hex1", "#hex2", "#hex3", "#hex4"],
  "techLevel": "[PRIMITIVE|MEDIEVAL|INDUSTRIAL|MODERN|FUTURISTIC|TRANSCENDENT]"
}
`,

  WEAPONS: (genre: IGeneratedGenre) => `
You are a game content designer. Create 5 unique weapons for this genre:

Genre: ${genre.name}
Aesthetic: ${genre.aesthetic}
Tech Level: ${genre.techLevel}
Keywords: ${genre.keywords.join(', ')}

Create weapons that fit the theme. Respond with a JSON array (no markdown):
[
  {
    "id": "wpn_[snake_case]",
    "name": "[Weapon Name]",
    "description": "[Brief description]",
    "type": "MELEE|RANGED|MAGIC|HYBRID",
    "baseRank": "F|E|D|C|B|A|S",
    "tags": ["tag1", "tag2"],
    "implicitStats": [
      { "stat": "damage", "min": 10, "max": 20 },
      { "stat": "attack_speed", "min": 1.0, "max": 1.2 }
    ],
    "flavorText": "[Short evocative text]"
  }
]

Include variety: one low-rank common weapon, one mid-rank rare, one high-rank legendary.
`,

  MOBS: (genre: IGeneratedGenre, weapons: IGeneratedWeapon[]) => `
You are a game content designer. Create 6 enemy mobs for this genre:

Genre: ${genre.name}
Aesthetic: ${genre.aesthetic}
Available Weapons (mobs may wield similar): ${weapons.map(w => w.name).join(', ')}

Create mobs that fit the theme. Include grunts, elites, and one boss.
Respond with a JSON array (no markdown):
[
  {
    "id": "mob_[snake_case]",
    "name": "[Mob Name]",
    "description": "[Brief description]",
    "behavior": "PASSIVE|NEUTRAL|AGGRESSIVE|SWARM|SIEGE",
    "baseRank": "F|E|D|C|B|A|S|SS|SSS",
    "tags": ["grunt|elite|boss", "other_tags"],
    "abilities": ["ability1", "ability2"],
    "dropHints": ["drops themed loot", "rare material"],
    "colorHex": "#hexcolor"
  }
]

Include: 2-3 grunts (F-D rank), 2 elites (C-B rank), 1 boss (A-SSS rank).
`,

  AFFIXES: (genre: IGeneratedGenre, weapons: IGeneratedWeapon[]) => `
You are a game content designer. Create 8 item affixes (modifiers) for this genre:

Genre: ${genre.name}
Keywords: ${genre.keywords.join(', ')}
Weapon Types: ${[...new Set(weapons.flatMap(w => w.tags))].join(', ')}

Create affixes that enhance items thematically. Respond with a JSON array (no markdown):
[
  {
    "id": "affix_[snake_case]",
    "name": "[Affix Name]",
    "type": "PREFIX|SUFFIX",
    "description": "[What it does thematically]",
    "statModifiers": [
      { "stat": "damage|defense|speed|crit|etc", "min": 5, "max": 15 }
    ],
    "allowedTags": ["melee", "ranged", etc],
    "tier": 1
  }
]

Include 4 prefixes and 4 suffixes. Mix offensive and defensive bonuses.
`
};

// =============================================================================
// PIPELINE ENGINE
// =============================================================================

export class ContentPipeline {
  private state: IPipelineState;
  private apiKey: string;
  private onProgress?: (state: IPipelineState) => void;
  
  constructor(name: string, apiKey: string, onProgress?: (state: IPipelineState) => void) {
    this.apiKey = apiKey;
    this.onProgress = onProgress;
    this.state = {
      id: crypto.randomUUID(),
      name,
      createdAt: Date.now(),
      nodes: [],
      currentNodeIndex: 0,
      isComplete: false
    };
  }
  
  /**
   * Run the full generation pipeline
   */
  async generate(genreInput: { name: string; description: string }): Promise<IPipelineState> {
    console.log('[PIPELINE] Starting generation:', genreInput.name);
    
    // Initialize nodes
    this.state.nodes = [
      { id: 'node_genre', type: 'GENRE', status: 'PENDING', input: genreInput, output: null },
      { id: 'node_weapons', type: 'WEAPONS', status: 'PENDING', input: null, output: null },
      { id: 'node_mobs', type: 'MOBS', status: 'PENDING', input: null, output: null },
      { id: 'node_affixes', type: 'AFFIXES', status: 'PENDING', input: null, output: null }
    ];
    
    this.notifyProgress();
    
    try {
      // Stage 1: Genre
      await this.runNode(0, async (node) => {
        const prompt = PROMPTS.GENRE(genreInput);
        const result = await this.callGemini(prompt);
        return this.parseJSON<IGeneratedGenre>(result);
      });
      
      const genre = this.state.nodes[0].output as IGeneratedGenre;
      
      // Stage 2: Weapons (depends on Genre)
      this.state.nodes[1].input = genre;
      await this.runNode(1, async (node) => {
        const prompt = PROMPTS.WEAPONS(genre);
        const result = await this.callGemini(prompt);
        return this.parseJSON<IGeneratedWeapon[]>(result);
      });
      
      const weapons = this.state.nodes[1].output as IGeneratedWeapon[];
      
      // Stage 3: Mobs (depends on Genre + Weapons)
      this.state.nodes[2].input = { genre, weapons };
      await this.runNode(2, async (node) => {
        const prompt = PROMPTS.MOBS(genre, weapons);
        const result = await this.callGemini(prompt);
        return this.parseJSON<IGeneratedMob[]>(result);
      });
      
      // Stage 4: Affixes (depends on Genre + Weapons)
      this.state.nodes[3].input = { genre, weapons };
      await this.runNode(3, async (node) => {
        const prompt = PROMPTS.AFFIXES(genre, weapons);
        const result = await this.callGemini(prompt);
        return this.parseJSON<IGeneratedAffix[]>(result);
      });
      
      this.state.isComplete = true;
      this.notifyProgress();
      
      console.log('[PIPELINE] Generation complete!');
      return this.state;
      
    } catch (error: any) {
      console.error('[PIPELINE] Fatal error:', error);
      throw error;
    }
  }
  
  /**
   * Run a single node
   */
  private async runNode(index: number, executor: (node: IPipelineNode) => Promise<any>): Promise<void> {
    const node = this.state.nodes[index];
    node.status = 'RUNNING';
    this.state.currentNodeIndex = index;
    this.notifyProgress();
    
    try {
      const output = await executor(node);
      node.output = output;
      node.status = 'COMPLETE';
      console.log(`[PIPELINE] Node ${node.type} complete:`, output);
    } catch (error: any) {
      node.status = 'ERROR';
      node.error = error.message;
      throw error;
    }
    
    this.notifyProgress();
  }
  
  /**
   * Call Gemini API
   */
  private async callGemini(prompt: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 2048
        }
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Invalid Gemini response structure');
    }
    
    return data.candidates[0].content.parts[0].text;
  }
  
  /**
   * Parse JSON from LLM response (handles markdown code blocks)
   */
  private parseJSON<T>(text: string): T {
    // Strip markdown code blocks if present
    let clean = text.trim();
    if (clean.startsWith('```json')) {
      clean = clean.slice(7);
    } else if (clean.startsWith('```')) {
      clean = clean.slice(3);
    }
    if (clean.endsWith('```')) {
      clean = clean.slice(0, -3);
    }
    clean = clean.trim();
    
    try {
      return JSON.parse(clean);
    } catch (e) {
      console.error('[PIPELINE] JSON parse error. Raw:', text);
      throw new Error(`Failed to parse JSON: ${e}`);
    }
  }
  
  /**
   * Notify progress callback
   */
  private notifyProgress() {
    if (this.onProgress) {
      this.onProgress({ ...this.state });
    }
  }
  
  /**
   * Get current state
   */
  getState(): IPipelineState {
    return { ...this.state };
  }
}

// =============================================================================
// VECTOR STORAGE INTEGRATION
// =============================================================================

export class ContentStore {
  private static storage: Map<string, any> = new Map();
  
  /**
   * Store generated content by type
   */
  static store(type: string, items: any[]): void {
    const existing = this.storage.get(type) || [];
    this.storage.set(type, [...existing, ...items]);
    console.log(`[CONTENT_STORE] Stored ${items.length} ${type} items`);
  }
  
  /**
   * Retrieve all content of a type
   */
  static getAll(type: string): any[] {
    return this.storage.get(type) || [];
  }
  
  /**
   * Search content by keyword
   */
  static search(type: string, query: string): any[] {
    const items = this.storage.get(type) || [];
    const q = query.toLowerCase();
    return items.filter((item: any) => 
      JSON.stringify(item).toLowerCase().includes(q)
    );
  }
  
  /**
   * Get content by ID
   */
  static getById(type: string, id: string): any | null {
    const items = this.storage.get(type) || [];
    return items.find((item: any) => item.id === id) || null;
  }
  
  /**
   * Clear all stored content
   */
  static clear(): void {
    this.storage.clear();
  }
  
  /**
   * Export all content as JSON
   */
  static export(): Record<string, any[]> {
    const result: Record<string, any[]> = {};
    this.storage.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
}