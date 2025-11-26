/**
 * GenreCreator - Admin Tool for Content Generation
 * 
 * Provides UI to:
 * 1. Input genre concept
 * 2. Run content pipeline
 * 3. View generated content
 * 4. Export to game definitions
 */

import React, { useState, useCallback } from 'react';
import { 
  Container, Paper, Stack, Group, TextInput, Textarea, Button, 
  Text, Badge, Progress, Accordion, Code, Alert, Tabs, SimpleGrid,
  Card, ThemeIcon, Loader, Divider
} from '@mantine/core';
import { 
  ContentPipeline, 
  IPipelineState, 
  IPipelineNode,
  ContentStore,
  IGeneratedGenre,
  IGeneratedWeapon,
  IGeneratedMob,
  IGeneratedAffix
} from '../../entities/generation/ContentPipeline';

// =============================================================================
// COMPONENT
// =============================================================================

export const GenreCreator: React.FC = () => {
  // Form State
  const [genreName, setGenreName] = useState('');
  const [genreDescription, setGenreDescription] = useState('');
  
  // Pipeline State
  const [pipelineState, setPipelineState] = useState<IPipelineState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // API Key (in real app, would come from env/settings)
  const apiKey = (window as any).process?.env?.GEMINI_API_KEY || 
                 import.meta.env?.VITE_GEMINI_API_KEY || 
                 '';
  
  // =========================================================================
  // HANDLERS
  // =========================================================================
  
  const handleGenerate = useCallback(async () => {
    if (!genreName.trim() || !genreDescription.trim()) {
      setError('Please provide both a name and description');
      return;
    }
    
    if (!apiKey) {
      setError('Gemini API key not configured. Set GEMINI_API_KEY in .env.local');
      return;
    }
    
    setIsRunning(true);
    setError(null);
    
    try {
      const pipeline = new ContentPipeline(
        genreName, 
        apiKey,
        (state) => setPipelineState({ ...state })
      );
      
      const finalState = await pipeline.generate({
        name: genreName,
        description: genreDescription
      });
      
      // Store generated content
      if (finalState.nodes[0]?.output) {
        ContentStore.store('genres', [finalState.nodes[0].output]);
      }
      if (finalState.nodes[1]?.output) {
        ContentStore.store('weapons', finalState.nodes[1].output);
      }
      if (finalState.nodes[2]?.output) {
        ContentStore.store('mobs', finalState.nodes[2].output);
      }
      if (finalState.nodes[3]?.output) {
        ContentStore.store('affixes', finalState.nodes[3].output);
      }
      
      setPipelineState(finalState);
      
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsRunning(false);
    }
  }, [genreName, genreDescription, apiKey]);
  
  const handleExport = useCallback(() => {
    const data = ContentStore.export();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `generated_content_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);
  
  // =========================================================================
  // RENDER HELPERS
  // =========================================================================
  
  const getNodeStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETE': return 'emerald';
      case 'RUNNING': return 'blue';
      case 'ERROR': return 'red';
      default: return 'gray';
    }
  };
  
  const getNodeIcon = (type: string) => {
    switch (type) {
      case 'GENRE': return '🎭';
      case 'WEAPONS': return '⚔️';
      case 'MOBS': return '👾';
      case 'AFFIXES': return '✨';
      case 'SPELLS': return '🔮';
      default: return '📦';
    }
  };
  
  const calculateProgress = () => {
    if (!pipelineState) return 0;
    const complete = pipelineState.nodes.filter(n => n.status === 'COMPLETE').length;
    return (complete / pipelineState.nodes.length) * 100;
  };
  
  // =========================================================================
  // RENDER
  // =========================================================================
  
  return (
    <Container size="xl" py="xl">
      <Stack gap="xl">
        
        {/* Header */}
        <Group justify="space-between">
          <div>
            <Text size="xl" fw={900} c="emerald">GENRE CREATOR</Text>
            <Text size="sm" c="dimmed">Content Generation Pipeline</Text>
          </div>
          <Badge color={apiKey ? 'emerald' : 'red'} size="lg">
            API: {apiKey ? 'CONNECTED' : 'NOT CONFIGURED'}
          </Badge>
        </Group>
        
        {/* Input Form */}
        <Paper p="lg" withBorder>
          <Stack gap="md">
            <Text fw={700}>Define Your Genre</Text>
            
            <TextInput
              label="Genre Name"
              placeholder="e.g., Biopunk Wasteland"
              value={genreName}
              onChange={(e) => setGenreName(e.target.value)}
              disabled={isRunning}
            />
            
            <Textarea
              label="Description"
              placeholder="A world where genetic engineering has gone wrong. Mutated creatures roam toxic marshlands. Technology is grown, not built. Flesh and machine are one."
              value={genreDescription}
              onChange={(e) => setGenreDescription(e.target.value)}
              minRows={3}
              disabled={isRunning}
            />
            
            <Group>
              <Button 
                color="emerald" 
                size="md"
                onClick={handleGenerate}
                loading={isRunning}
                disabled={!apiKey}
              >
                {isRunning ? 'Generating...' : 'Generate Content'}
              </Button>
              
              {pipelineState?.isComplete && (
                <Button 
                  variant="outline" 
                  color="gold"
                  onClick={handleExport}
                >
                  Export JSON
                </Button>
              )}
            </Group>
            
            {error && (
              <Alert color="red" title="Error">
                {error}
              </Alert>
            )}
          </Stack>
        </Paper>
        
        {/* Pipeline Progress */}
        {pipelineState && (
          <Paper p="lg" withBorder>
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={700}>Pipeline Progress</Text>
                <Badge color={pipelineState.isComplete ? 'emerald' : 'blue'}>
                  {pipelineState.isComplete ? 'COMPLETE' : 'RUNNING'}
                </Badge>
              </Group>
              
              <Progress 
                value={calculateProgress()} 
                color="emerald" 
                size="lg" 
                animated={isRunning}
              />
              
              <SimpleGrid cols={4} spacing="md">
                {pipelineState.nodes.map((node, i) => (
                  <Card key={node.id} withBorder p="sm" bg="dark.8">
                    <Stack gap="xs" align="center">
                      <Text size="xl">{getNodeIcon(node.type)}</Text>
                      <Text size="sm" fw={600}>{node.type}</Text>
                      <Badge 
                        color={getNodeStatusColor(node.status)} 
                        size="sm"
                        leftSection={node.status === 'RUNNING' ? <Loader size={10} /> : null}
                      >
                        {node.status}
                      </Badge>
                    </Stack>
                  </Card>
                ))}
              </SimpleGrid>
            </Stack>
          </Paper>
        )}
        
        {/* Generated Content Viewer */}
        {pipelineState?.isComplete && (
          <Paper p="lg" withBorder>
            <Tabs defaultValue="genre">
              <Tabs.List>
                <Tabs.Tab value="genre">🎭 Genre</Tabs.Tab>
                <Tabs.Tab value="weapons">⚔️ Weapons</Tabs.Tab>
                <Tabs.Tab value="mobs">👾 Mobs</Tabs.Tab>
                <Tabs.Tab value="affixes">✨ Affixes</Tabs.Tab>
                <Tabs.Tab value="raw">📄 Raw JSON</Tabs.Tab>
              </Tabs.List>
              
              {/* Genre Tab */}
              <Tabs.Panel value="genre" pt="md">
                {pipelineState.nodes[0]?.output && (
                  <GenreDisplay genre={pipelineState.nodes[0].output} />
                )}
              </Tabs.Panel>
              
              {/* Weapons Tab */}
              <Tabs.Panel value="weapons" pt="md">
                <SimpleGrid cols={2} spacing="md">
                  {(pipelineState.nodes[1]?.output as IGeneratedWeapon[] || []).map(weapon => (
                    <WeaponCard key={weapon.id} weapon={weapon} />
                  ))}
                </SimpleGrid>
              </Tabs.Panel>
              
              {/* Mobs Tab */}
              <Tabs.Panel value="mobs" pt="md">
                <SimpleGrid cols={2} spacing="md">
                  {(pipelineState.nodes[2]?.output as IGeneratedMob[] || []).map(mob => (
                    <MobCard key={mob.id} mob={mob} />
                  ))}
                </SimpleGrid>
              </Tabs.Panel>
              
              {/* Affixes Tab */}
              <Tabs.Panel value="affixes" pt="md">
                <SimpleGrid cols={2} spacing="md">
                  {(pipelineState.nodes[3]?.output as IGeneratedAffix[] || []).map(affix => (
                    <AffixCard key={affix.id} affix={affix} />
                  ))}
                </SimpleGrid>
              </Tabs.Panel>
              
              {/* Raw JSON Tab */}
              <Tabs.Panel value="raw" pt="md">
                <Code block style={{ maxHeight: 400, overflow: 'auto' }}>
                  {JSON.stringify(pipelineState, null, 2)}
                </Code>
              </Tabs.Panel>
            </Tabs>
          </Paper>
        )}
        
      </Stack>
    </Container>
  );
};

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

const GenreDisplay: React.FC<{ genre: IGeneratedGenre }> = ({ genre }) => (
  <Stack gap="md">
    <Group>
      <Text size="xl" fw={900}>{genre.name}</Text>
      <Badge color="gold">{genre.techLevel}</Badge>
    </Group>
    <Text c="dimmed">{genre.description}</Text>
    <Text size="sm"><strong>Aesthetic:</strong> {genre.aesthetic}</Text>
    <Group gap="xs">
      <Text size="sm" fw={600}>Keywords:</Text>
      {genre.keywords.map(kw => (
        <Badge key={kw} variant="outline" size="sm">{kw}</Badge>
      ))}
    </Group>
    <Group gap="xs">
      <Text size="sm" fw={600}>Palette:</Text>
      {genre.colorPalette.map(color => (
        <div 
          key={color} 
          style={{ 
            width: 24, height: 24, 
            backgroundColor: color, 
            border: '1px solid #fff',
            borderRadius: 4
          }} 
          title={color}
        />
      ))}
    </Group>
  </Stack>
);

const WeaponCard: React.FC<{ weapon: IGeneratedWeapon }> = ({ weapon }) => (
  <Card withBorder p="sm" bg="dark.8">
    <Group justify="space-between" mb="xs">
      <Text fw={700}>{weapon.name}</Text>
      <Badge color="blue" size="sm">{weapon.baseRank}</Badge>
    </Group>
    <Text size="sm" c="dimmed" mb="xs">{weapon.description}</Text>
    <Group gap={4} mb="xs">
      <Badge variant="light" size="xs">{weapon.type}</Badge>
      {weapon.tags.map(tag => (
        <Badge key={tag} variant="outline" size="xs" color="gray">{tag}</Badge>
      ))}
    </Group>
    <Text size="xs" fs="italic" c="gold.4">"{weapon.flavorText}"</Text>
  </Card>
);

const MobCard: React.FC<{ mob: IGeneratedMob }> = ({ mob }) => (
  <Card withBorder p="sm" bg="dark.8">
    <Group mb="xs">
      <div style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: mob.colorHex }} />
      <Text fw={700}>{mob.name}</Text>
      <Badge color="red" size="sm">{mob.baseRank}</Badge>
    </Group>
    <Text size="sm" c="dimmed" mb="xs">{mob.description}</Text>
    <Group gap={4} mb="xs">
      <Badge variant="light" size="xs">{mob.behavior}</Badge>
      {mob.tags.map(tag => (
        <Badge key={tag} variant="outline" size="xs" color="gray">{tag}</Badge>
      ))}
    </Group>
    <Text size="xs"><strong>Abilities:</strong> {mob.abilities.join(', ')}</Text>
  </Card>
);

const AffixCard: React.FC<{ affix: IGeneratedAffix }> = ({ affix }) => (
  <Card withBorder p="sm" bg="dark.8">
    <Group justify="space-between" mb="xs">
      <Text fw={700}>{affix.name}</Text>
      <Badge color={affix.type === 'PREFIX' ? 'cyan' : 'orange'} size="sm">
        {affix.type}
      </Badge>
    </Group>
    <Text size="sm" c="dimmed" mb="xs">{affix.description}</Text>
    <Stack gap={2}>
      {affix.statModifiers.map((mod, i) => (
        <Text key={i} size="xs" c="emerald.4">
          +{mod.min}-{mod.max} {mod.stat}
        </Text>
      ))}
    </Stack>
  </Card>
);

export default GenreCreator;