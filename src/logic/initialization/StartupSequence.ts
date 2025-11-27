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

export class StartupSequence {
  
  static async execute() {
    console.log('[BOOT] Initiating Genesis Protocol...');

    // 1. IDENTITY CHECK
    const { certificate } = useIdentityStore.getState();
    if (!certificate) {
      console.log('[BOOT] No Identity found. Waiting for user login.');
      return { status: 'WAITING_FOR_IDENTITY' };
    }

    // 2. VECTOR DB GENESIS (The Big Bang)
    const itemDefs = await VectorStore.query({ namespace: VectorNamespace.ITEMS, limit: 1 });
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

    // 5. HYDRATE PLAYER (If exists)
    if (certificate) {
       console.log('[BOOT] Searching for neural imprint...');
       
       const playerDoc = await VectorStore.get<IPlayer>(
         VectorNamespace.CHARACTERS, 
         certificate.metadata.uid
       );
       
       if (playerDoc && playerDoc.data) {
           console.log('[BOOT] Neural Imprint Found. Restoring state...');
           usePlayerStore.setState({ player: playerDoc.data });
       } else {
           console.log('[BOOT] No previous state found. Standing by for Character Creation.');
       }
    }

    return { status: 'READY' };
  }
}