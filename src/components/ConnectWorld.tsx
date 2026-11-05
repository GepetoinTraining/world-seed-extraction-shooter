/**
 * CONNECT HUB TO ONLINE WORLD (Pedro, 2026-11-04: "it opens after the player has gone through
 * tutorial, from the nexus menu, and then what they see is the connect hub to online world, we
 * check their account... and serve the world to their hub"). The first thing in the game that asks
 * for an account: the tutorial and a person's own worlds need none. The hub checks the account and
 * this character's standing on our world, then the world joins this hub's zones, to deploy into as
 * into any. A character barred from our world is barred from that world only.
 */
import React, { useEffect, useState } from 'react';
import { Button, Modal } from './ui/kit';
import { HubPanel } from './HubPanel';
import { HubClient } from '../logic/hub/HubClient';
import { useIdentityStore } from '../entities/identity/store';
import { VectorStore } from '../entities/data/VectorStore';
import { ThemeStore } from '../logic/theme/ThemeStore';
import { HostedLink } from '../logic/live/HostedLink';

export const ConnectWorld: React.FC<{ onConnected: () => void }> = ({ onConnected }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button tone="signal" onClick={() => setOpen(true)} title="Our world, hosted for everyone. It asks for an account on the hub.">CONNECT HUB TO ONLINE WORLD</Button>
      {open && (
        <Modal title="CONNECT HUB TO ONLINE WORLD" onClose={() => setOpen(false)} width={660}>
          <ConnectFlow onConnected={() => { onConnected(); }} />
        </Modal>
      )}
    </>
  );
};

const ConnectFlow: React.FC<{ onConnected: () => void }> = ({ onConnected }) => {
  const certificate = useIdentityStore(s => s.certificate);
  const [world, setWorld] = useState<{ name: string } | null | undefined>(undefined);
  const [signedIn, setSignedIn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const look = async () => {
    const [hosted, where] = await Promise.all([HubClient.hosted(), HubClient.where()]);
    setWorld(hosted.ok && hosted.world ? hosted.world : null);
    setSignedIn(where.signedIn);
  };
  useEffect(() => { void look(); }, []);

  if (world === undefined) return <div className="ws-dim ws-small">Asking the hub…</div>;
  if (world === null) return <div className="ws-small">[ ] This hub hosts no online world, or cannot be reached. Everything else plays on as it does.</div>;

  return (
    <div className="ws-ui" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="ws-bright">{world.name}</div>
      <div className="ws-small">A world we host for everyone. Connecting checks your account and this character's standing there, then adds it to your zones. Your own hub and your own worlds need no account, and stay as they are.</div>
      {!signedIn && <HubPanel />}
      {signedIn && certificate && (
        <Button tone="signal" primary disabled={busy} onClick={async () => {
          setBusy(true);
          setNote('');
          try {
            const out = await HubClient.connectHosted(certificate.metadata.uid);
            if (!out.ok || !out.manifest) { setNote(out.reason ?? 'Not connected.'); return; }
            for (const theme of out.manifest.themes ?? []) {
              const banked = await ThemeStore.bank(theme);
              if (!banked.ok) { setNote(`Its theme would not install here: ${banked.reason}`); return; }
            }
            const cert = out.manifest.certificate;
            if (!cert?.data?.worldUid) { setNote('The hub sent no certificate for the world.'); return; }
            await VectorStore.saveContent(cert.data.worldUid, 'world_certificate', cert, cert.data.worldType);
            // Deploying into it plays it live: what its players share is kept on our server (LiveClient)
            HostedLink.remember(cert.data.worldUid);
            setNote(`${world.name} is in your zones now. Deploy into it as into any world; it is played live, with everyone in it.`);
            onConnected();
          } finally {
            setBusy(false);
            await look();
          }
        }}>CONNECT {certificate.metadata.displayName.toUpperCase()} TO {world.name.toUpperCase()}</Button>
      )}
      {note && <div className="ws-small">! {note}</div>}
    </div>
  );
};
