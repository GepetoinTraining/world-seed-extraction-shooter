import { GenesisInitializer } from '../../entities/data/GenesisInitializer';
import { WorldCertificateSystem, WorldType, AccessMode } from '../../entities/world/WorldCertificate';
import { VectorStore, VectorNamespace } from '../../entities/data/VectorStore';
import { useHubStore } from '../../entities/hub/store';
import { useIdentityStore } from '../../entities/identity/store';
import { useWorldStore } from '../../entities/world/store';
import { usePlayerStore } from '../../entities/player/store';
// --- FIX START ---
// Import both from the ROOT types file
import { UniversalRank, IPlayer } from '../../../types';
// --- FIX END ---
import { PlayerPersistence } from '../persistence/PlayerPersistence';
import { Ledger } from '../ledger/Ledger';
import { runGoldenCheck } from '../../entities/world/goldens';

export class StartupSequence {

  static async execute() {
    // DEV HOOK: the live store graph for the system console / debugging.
    // (Dynamic imports in devtools resolve a parallel module graph; this is
    // the real one.)
    if (import.meta.env.DEV) {
      const { useHubStore } = await import('../../entities/hub/store');
      const { InteractionEngine } = await import('../../entities/interaction/InteractionEngine');
      (window as any).__ws = { usePlayerStore, useWorldStore, useHubStore, useIdentityStore, VectorStore, VectorNamespace, Ledger, InteractionEngine };
    }
    console.log('[BOOT] Initiating Genesis Protocol...');

    // Wave 3.1: inventory geometry self-test (dev; a real runner lands Wave 7)
    if (import.meta.env.DEV) {
      const { InventorySystem } = await import('../../entities/player/systems/InventorySystem');
      const fails = InventorySystem.selfTest();
      if (fails.length === 0) console.log('[BOOT] Inventory geometry self-test ✓');
      else console.error('[BOOT] ⛔ Inventory self-test failures:', fails);
    }

    // Wave 2.6: GOLDEN VECTOR CHECK — the generator must never drift silently
    const goldens = runGoldenCheck();
    if (goldens.ok) {
      console.log('[BOOT] Golden vectors verified ✓ (world generation is pinned)');
    } else {
      console.error('[BOOT] ⛔ GOLDEN VECTOR MISMATCH — world generation drifted:', goldens.mismatches);
    }

    // 1. IDENTITY CHECK
    const { certificate } = useIdentityStore.getState();
    if (!certificate) {
      console.log('[BOOT] No Identity found. Waiting for user login.');
      return { status: 'WAITING_FOR_IDENTITY' };
    }

    // 2. VECTOR DB GENESIS (The Big Bang)
    // Definitions live in CONTENT (saveContent); ITEMS holds minted instances
    const itemDefs = await VectorStore.query({ namespace: VectorNamespace.CONTENT, limit: 1 });
    if (itemDefs.length === 0) {
      console.log('[BOOT] Vector Ledger empty. Executing Big Bang...');
      await GenesisInitializer.initialize();
    } else {
      console.log('[BOOT] Vector Ledger verified.');
    }

    // 3. GENESIS HUB VERIFICATION
    const worlds = await WorldCertificateSystem.getPublicWorlds();
    let hubCert = worlds.find(w => w.data.worldType === WorldType.HUB);

    if (!hubCert) {
      console.log('[BOOT] Genesis Hub not found. Minting new Reality...');
      
      hubCert = await WorldCertificateSystem.mintWorld(
        certificate,
        "New Carleon",
        "The last bastion of humanity. Trade, rest, and prepare for the drop.",
        WorldType.HUB,
        50, 
        {
          accessMode: AccessMode.PUBLIC,
          difficulty: UniversalRank.F,
          pvpEnabled: false,
          extractionTaxRate: 0.05
        }
      );
      
      if (hubCert) {
        console.log(`[BOOT] Hub Minted: ${hubCert.data.worldUid}`);
      } else {
        console.error('[BOOT] Failed to mint Hub.');
        return { status: 'ERROR' };
      }
    }

    // 4. HYDRATE STORES
console.log('[BOOT] Refreshing World List...');
    await useWorldStore.getState().refreshWorlds();

    // 5. HYDRATE PLAYER (Wave 1.1: signed write-through, verify-on-load)
    if (certificate) {
       console.log('[BOOT] Searching for neural imprint...');

       const result = await PlayerPersistence.hydrate(certificate);

       if (result.status === 'OK') {
           console.log('[BOOT] Neural Imprint verified. Restoring state...');
           usePlayerStore.setState({ player: result.player });
       } else if (result.status === 'TAMPERED') {
           console.error('[BOOT] ⛔ Neural Imprint REJECTED (signature mismatch). Booting clean slate.');
           // The tampered doc stays in the DB as evidence; we refuse to load it.
       } else {
           // EMPTY: this is a genesis — seal the first player doc and open the ledger
           console.log('[BOOT] No previous state found. Sealing genesis imprint...');
           // If the gate auto-passed (existing identity), the store still holds the
           // blank template — initialize the character from the cert first.
           if (usePlayerStore.getState().player.id !== certificate.metadata.uid) {
             usePlayerStore.getState().initializeSession(certificate, 'OPERATOR');
           }
           const saved = await PlayerPersistence.flush('genesis');
           if (saved) {
             await Ledger.append('CHARACTER_GENESIS', {
               certUid: certificate.metadata.uid,
               username: usePlayerStore.getState().player.username
             });
           }
       }

       // Arm the autosave subscription (10s debounce + critical-moment flushes)
       PlayerPersistence.start();
    }

    return { status: 'READY' };
  }
}