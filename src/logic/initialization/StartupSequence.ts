import { LootBook } from '../theme/LootBook';
import { ThemeStore } from '../theme/ThemeStore';
import { WorldCertificateSystem, WorldType, AccessMode } from '../../entities/world/WorldCertificate';
import { VectorStore, VectorNamespace } from '../../../shared/entities/data/VectorStore';
import { useHubStore } from '../../entities/hub/store';
import { useIdentityStore } from '../../entities/identity/store';
import { useWorldStore } from '../../entities/world/store';
import { usePlayerStore, playerPort } from '../../entities/player/store';
// --- FIX START ---
// Import both from the ROOT types file
import { UniversalRank, IPlayer } from '../../../shared/types';
// --- FIX END ---
import { PlayerPersistence } from '../persistence/PlayerPersistence';
import { Ledger } from '../ledger/Ledger';
import { GoldCommit } from '../economy/GoldCommit';
import { HomeHub } from '../persistence/HomeHub';
import { FIRST_THEME_VECTORS, runGoldenCheck } from '../../entities/world/goldens';
import { ContentRegistry } from '../../../shared/logic/theme/ContentRegistry';
import { FIRST_THEME_PACK } from '../../../shared/logic/theme/boot';

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
      const { LoadoutSystem } = await import('../../../shared/entities/player/systems/LoadoutSystem');
      const { CartSystem } = await import('../../entities/world/CartSystem');
      const { CartOverlay } = await import('../../entities/world/CartOverlay');
      // Wave 10C (D21): the dev hook for the slot-protection contract — the
      // items that grant protection are 10E's; until then the console is the charm:
      //   __ws.protectSlot('CHEST', 'Dev Ward')
      const protectSlot = (slot: any, by = 'Dev Ward (console)') => usePlayerStore.getState().markSlotProtected(slot, by);
      // Wave 10D: the anatomy's own instruments join the console
      const { CompositionSystem } = await import('../../../shared/logic/economy/CompositionSystem');
      const { MintRegistry } = await import('../../../shared/logic/economy/MintRegistry');
      // D27: the web's own instruments
      const { WebBank } = await import('../../../shared/logic/content/WebBank');
      const { WebSystem: Web } = await import('../../../shared/logic/systems/WebSystem');
      const { NpcSheet } = await import('../../../shared/logic/systems/NpcSheet');
      // D113: the talk's own instruments
      const { useTalk } = await import('../../entities/interaction/talkStore');
      const { MonsterMind } = await import('../systems/MonsterMind');
      (window as any).__ws = { useTalk, MonsterMind, usePlayerStore, useWorldStore, useHubStore, useIdentityStore, VectorStore, VectorNamespace, Ledger, InteractionEngine, GoldAudit, Treasury, DeedSystem, AvatarExport, Provenance, WorldExport, LoadoutSystem, CartSystem, CartOverlay, protectSlot, CompositionSystem, MintRegistry, WebBank, WebSystem: Web, NpcSheet };
    }
    console.log('[BOOT] Initiating Genesis Protocol...');

    // Wave 3.1: inventory geometry self-test (dev; a real runner lands Wave 7)
    if (import.meta.env.DEV) {
      const { InventorySystem } = await import('../../../shared/entities/player/systems/InventorySystem');
      const fails = InventorySystem.selfTest();
      if (fails.length === 0) console.log('[BOOT] Inventory geometry self-test ✓');
      else console.error('[BOOT] ⛔ Inventory self-test failures:', fails);
    }

    // Wave 2.6: GOLDEN VECTOR CHECK — the generator must never drift silently
    // The shipped theme's land: pinned by bar, and checked here against this build
    const goldens = runGoldenCheck(ContentRegistry.contextFor(FIRST_THEME_PACK.themeId), FIRST_THEME_VECTORS);
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

    // 2. THE THEMES THIS HUB HOLDS: each judged again as it is read, as anything from a store is
    // A shipped theme is banked too, so a later build changing its bytes retires no world pinned to it
    await ThemeStore.bank(FIRST_THEME_PACK);
    await ThemeStore.loadBanked();
    // Loot tables after the themes they stand on, each judged again (LootLaw.ts). The shipped world's own come first
    LootBook.admitShipped();
    await LootBook.loadBanked();

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

    // An avatar's home: the hub it knows, or, for a new one, the one it just found.
    // A wiped browser finds this pin again in the database.
    if (!(await HomeHub.of(certificate.metadata.uid))) {
      await HomeHub.pin(certificate.metadata.uid, hubCert.data.worldUid);
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
           const { LoadoutSystem } = await import('../../../shared/entities/player/systems/LoadoutSystem');
           // D28: and old skill tracks land on lawful ids, once, without loss
           const { WebSystem } = await import('../../../shared/logic/systems/WebSystem');
           // D83, D84: and a rank its experience earned is stored, once, with skills kept where they stood
           const { ProgressionSystem } = await import('../../../shared/entities/player/systems/ProgressionSystem');
           // D118: and lore already read is held as a resource, once
           const { LoreSystem } = await import('../systems/LoreSystem');
           usePlayerStore.setState({ player: LoreSystem.migrate(ProgressionSystem.migrate(WebSystem.migrate(LoadoutSystem.migrate(result.player)))) });
           // D72: nobody is locked out of a pocket world, once
           const { WorldDeedDoor } = await import('../systems/WorldDeedDoor');
           await WorldDeedDoor.grantOnLoad(playerPort);
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
           const { CreationDoor } = await import('../systems/CreationDoor');
           console.log('[BOOT] No previous state found. Sealing genesis imprint...');
           // If the gate auto-passed (existing identity), the store still holds the
           // blank template — initialize the character from the cert first.
           if (usePlayerStore.getState().player.id !== certificate.metadata.uid) {
             // Wave 9.3: genesis uses the archetype chosen at the gate, not a default
             const { AvatarRoster } = await import('../../entities/identity/roster');
             usePlayerStore.getState().initializeSession(certificate, AvatarRoster.archetypeOf(certificate.metadata.uid) ?? 'OPERATOR', CreationDoor.heldSheet(certificate.metadata.uid));
           }
           // The first bank doc and the birthright's row land as one.
           // What the creation flow granted lands with them: the kit, the deed and the words, signed.
           await GoldCommit.commit({ player: usePlayerStore.getState().player, rows: [{ type: 'CHARACTER_GENESIS', data: {
             certUid: certificate.metadata.uid,
             username: usePlayerStore.getState().player.username,
             gold: usePlayerStore.getState().player.bank.gold // the birthright grant (audited)
           } }, ...CreationDoor.genesisRows(usePlayerStore.getState().player, CreationDoor.heldSheet(certificate.metadata.uid)?.usage)] });
           CreationDoor.releaseSheet(certificate.metadata.uid);
           void CreationDoor.provenance(usePlayerStore.getState().player);
       }

       // Arm the autosave subscription (10s debounce + critical-moment flushes)
       PlayerPersistence.start(playerPort);
    }

    return { status: 'READY' };
  }
}