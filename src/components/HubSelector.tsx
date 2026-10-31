/**
 * HUB SELECTION (Wave 9): search and a card per hub. Coming home starts here.
 */

import React, { useEffect, useState } from 'react';
import { WorldCertificateSystem, IWorldCertificate, WorldType } from '../entities/world/WorldCertificate';
import { useHubStore } from '../entities/hub/store';
import { Button, Chip, Input, Panel } from './ui/kit';

interface HubSelectorProps {
  onSelect: (hubWorldUid: string) => void;
}

export const HubSelector: React.FC<HubSelectorProps> = ({ onSelect }) => {
  const [hubs, setHubs] = useState<IWorldCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const { loadHub } = useHubStore();

  useEffect(() => {
    const fetchHubs = async () => {
      setLoading(true);
      const allWorlds = await WorldCertificateSystem.getPublicWorlds();
      setHubs(allWorlds.filter(w => w.data.worldType === WorldType.HUB));
      setLoading(false);
    };
    fetchHubs();
  }, []);

  const handleEnter = async (hubUid: string) => {
    await loadHub(hubUid);
    onSelect(hubUid);
  };

  const filteredHubs = hubs.filter(h =>
    h.data.worldName.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="ws-ui" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ws-void-1)' }}>
        <span className="ws-dim">Scanning sector frequencies…</span>
      </div>
    );
  }

  return (
    <div className="ws-ui" style={{ minHeight: '100vh', background: 'var(--ws-void-1)', padding: '48px 24px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div className="ws-signal" style={{ fontSize: 'var(--ws-font-display)', fontWeight: 700, letterSpacing: '0.2em' }}>
            HUB SELECTION
          </div>
          <div className="ws-dim">Choose a frequency to materialize your avatar.</div>
        </div>

        <Input placeholder="SEARCH HUBS…" value={search} onChange={e => setSearch(e.target.value)} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {filteredHubs.map(hub => (
            <Panel
              key={hub.data.worldUid}
              title={hub.data.worldName.toUpperCase()}
              right={<Chip tone="proof">POP {hub.data.stats.totalVisitors}</Chip>}
              tone="signal"
            >
              <div className="ws-dim ws-small" style={{ minHeight: 48, marginBottom: 10 }}>
                {hub.data.worldDescription}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Chip>{hub.data.rules.difficulty}</Chip>
                <Button tone="signal" primary onClick={() => handleEnter(hub.data.worldUid)}>
                  MATERIALIZE
                </Button>
              </div>
            </Panel>
          ))}
        </div>

        {filteredHubs.length === 0 && (
          <div className="ws-dim" style={{ textAlign: 'center', marginTop: 40 }}>
            No hub signals detected. (Did the Genesis Protocol run?)
          </div>
        )}
      </div>
    </div>
  );
};
