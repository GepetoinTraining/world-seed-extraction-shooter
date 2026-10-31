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
      const { GoldAudit } = await import('../economy/GoldAudit');
      const { Treasury } = await import('../economy/Treasury');
      const { DeedSystem } = await import('../systems/DeedSystem');
      const { AvatarExport } = await import('../sovereignty/AvatarExport');
      const { Provenance } = await import('../sovereignty/Provenance');
      const { WorldExport } = await import('../sovereignty/WorldExport');
      const { LoadoutSystem } = await import('../../entities/player/systems/LoadoutSystem');
      const { CartSystem } = await import('../../entities/world/CartSystem');
      const { CartOverlay } = await import('../../entities/world/CartOverlay');
      // Wave 10C (D21): the dev hook for the slot-protection contract — the
      // items that grant protection are 10E's; until then the console is the charm:
      //   __ws.protectSlot('CHEST', 'Dev Ward')
      const protectSlot = (slot: any, by = 'Dev Ward (console)') => usePlayerStore.getState().markSlotProtected(slot, by);
      // Wave 10D: the anatomy's own instruments join the console
      const { CompositionSystem } = await import('../economy/CompositionSystem');
      const { MintRegistry } = await import('../economy/MintRegistry');
      // D27: the web's own instruments
      const { WebBank } = await import('../content/WebBank');
      const { WebSystem: Web } = await import('../systems/WebSystem');
      const { NpcSheet } = await import('../systems/NpcSheet');
      (window as any).__ws = { usePlayerStore, useWorldStore, useHubStore, useIdentityStore, VectorStore, VectorNamespace, Ledger, InteractionEngine, GoldAudit, Treasury, DeedSystem, AvatarExport, Provenance, WorldExport, LoadoutSystem, CartSystem, CartOverlay, protectSlot, CompositionSystem, MintRegistry, WebBank, WebSystem: Web, NpcSheet };
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
           // Wave 10C: the three Wave-4 buckets migrate into the slot tree, once
           const { LoadoutSystem } = await import('../../entities/player/systems/LoadoutSystem');
           // D28: and old skill tracks land on lawful ids, once, without loss
           const { WebSystem } = await import('../systems/WebSystem');
           usePlayerStore.setState({ player: WebSystem.migrate(LoadoutSystem.migrate(result.player)) });
           usePlayerStore.getState().recalcAttributes();
           usePlayerStore.getState().recalcWeight();
           // Wave 9.3: the select screen learns the real archetype from the save
           if (result.player.archetype) {
             const { AvatarRoster } = await import('../../entities/identity/roster');
             AvatarRoster.remember(certificate, result.player.archetype);
           }
       } else if (result.status === 'TAMPERED') {
           console.error('[BOOT] ⛔ Neural Imprint REJECTED (signature mismatch). Booting clean slate.');
           // The tampered doc stays in the DB as evidence; we refuse to load it.
       } else {
           // EMPTY: this is a genesis — seal the first player doc and open the ledger
           console.log('[BOOT] No previous state found. Sealing genesis imprint...');
           // If the gate auto-passed (existing identity), the store still holds the
           // blank template — initialize the character from the cert first.
           if (usePlayerStore.getState().player.id !== certificate.metadata.uid) {
             // Wave 9.3: genesis uses the archetype chosen at the gate, not a default
             const { AvatarRoster } = await import('../../entities/identity/roster');
             usePlayerStore.getState().initializeSession(certificate, AvatarRoster.archetypeOf(certificate.metadata.uid) ?? 'OPERATOR');
           }
           const saved = await PlayerPersistence.flush('genesis');
           if (saved) {
             await Ledger.append('CHARACTER_GENESIS', {
               certUid: certificate.metadata.uid,
               username: usePlayerStore.getState().player.username,
               gold: usePlayerStore.getState().player.bank.gold // the birthright grant (audited)
             });
           }
       }

       // Arm the autosave subscription (10s debounce + critical-moment flushes)
       PlayerPersistence.start();
    }

    return { status: 'READY' };
  }
}