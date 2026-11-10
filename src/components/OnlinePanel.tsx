/**
 * ONLINE, WHICH IS NOT FINISHED (Pedro, 2026-11-10: "online (wip)"). The entry says where it stands
 * instead of offering a button that leads nowhere: what a hub does today, what is not built, and whether
 * this game has a hub at all (DEPLOY.md). Signing in to one is inside the game, under SYSTEM.
 */
import React, { useEffect, useState } from 'react';
import { Panel } from './ui/kit';
import { HubClient, IHubWhere } from '../logic/hub/HubClient';

const STANDS = [
  'A hub keeps accounts and checks what a game sends it, as arithmetic.',
  'One hosted world can be walked by several people at once. Its chests are shared, and the first to reach one has it.'
];
const NOT_YET = [
  'Creatures are each player\'s own, so two people cannot fight the same one.',
  'A market, its currency, and goods carried between hubs.',
  'Charging for a model\'s use.'
];

export const OnlinePanel: React.FC<{ style?: React.CSSProperties }> = ({ style }) => {
  const [where, setWhere] = useState<IHubWhere | null>(null);
  useEffect(() => { void HubClient.where().then(setWhere); }, []);

  return (
    <Panel title="ONLINE" right={<span className="ws-small">WORK IN PROGRESS</span>} style={{ whiteSpace: 'normal', ...style }}>
      <div className="ws-bright">WHAT STANDS</div>
      {STANDS.map(line => <div key={line} className="ws-small">[■] {line}</div>)}

      <div className="ws-bright" style={{ marginTop: 10 }}>NOT BUILT YET</div>
      {NOT_YET.map(line => <div key={line} className="ws-small">[ ] {line}</div>)}

      <div className="ws-bright" style={{ marginTop: 10 }}>THIS GAME</div>
      <div className="ws-small">
        {!where
          ? 'Asking this game\'s own server…'
          : where.configured
            ? `Its hub is ${where.url}.${where.signedIn ? ` Signed in as ${where.signedIn}.` : ' Nobody is signed in.'}`
            : (where.reason ?? 'No hub is set for this game, so it plays on this machine alone.')}
      </div>
      <div className="ws-small ws-dim" style={{ marginTop: 6 }}>An account on a hub is made and signed in to inside the game, under SYSTEM, THE HUB.</div>
    </Panel>
  );
};
