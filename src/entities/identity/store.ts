/**
 * IDENTITY STORE
 * Manages the player's sovereign identity state
 * 
 * This is separate from PlayerStore because:
 * - Identity is PERMANENT (survives across worlds)
 * - Player state is EPHEMERAL (changes per session)
 */

import { create } from 'zustand';
import { 
  CertificateSystem, 
  IPlayerCertificate, 
  ISignedPayload 
} from './CertificateSystem';

export enum IdentityState {
  UNKNOWN = 'UNKNOWN',       // Haven't checked yet
  NO_IDENTITY = 'NO_IDENTITY', // No certificate found
  LOADING = 'LOADING',       // Loading/generating
  READY = 'READY',           // Identity loaded and ready
  ERROR = 'ERROR'            // Something went wrong
}

interface IdentityStore {
  state: IdentityState;
  certificate: IPlayerCertificate | null;
  error: string | null;
  
  // For export flow
  pendingExportKey: JsonWebKey | null;

  // Actions
  checkExistingIdentity: () => Promise<void>;
  createIdentity: (displayName: string) => Promise<boolean>;
  exportIdentity: (password: string) => Promise<Blob | null>;
  importIdentity: (fileContent: string, password: string) => Promise<boolean>;
  signData: <T>(data: T) => Promise<ISignedPayload<T> | null>;
  clearIdentity: () => Promise<void>;
}

export const useIdentityStore = create<IdentityStore>((set, get) => ({
  state: IdentityState.UNKNOWN,
  certificate: null,
  error: null,
  pendingExportKey: null,

  checkExistingIdentity: async () => {
    set({ state: IdentityState.LOADING });

    try {
      // Check localStorage for certificate metadata
      const storedCert = localStorage.getItem('worldseed_certificate');
      
      if (!storedCert) {
        set({ state: IdentityState.NO_IDENTITY });
        return;
      }

      const certificate = JSON.parse(storedCert) as IPlayerCertificate;
      
      // Verify we still have the private key
      const privateKey = await CertificateSystem.getPrivateKey(certificate.metadata.uid);
      
      if (!privateKey) {
        // Certificate exists but key is gone - corrupted state
        console.warn('[IDENTITY] Certificate found but private key missing');
        localStorage.removeItem('worldseed_certificate');
        set({ state: IdentityState.NO_IDENTITY });
        return;
      }

      set({ 
        state: IdentityState.READY, 
        certificate 
      });
      
      console.log(`[IDENTITY] Loaded: ${certificate.metadata.displayName} (${certificate.metadata.uid})`);
    } catch (e) {
      console.error('[IDENTITY] Check failed:', e);
      set({ 
        state: IdentityState.ERROR, 
        error: 'Failed to load identity' 
      });
    }
  },

  createIdentity: async (displayName: string) => {
    set({ state: IdentityState.LOADING, error: null });

    try {
      const result = await CertificateSystem.generateBirthCertificate(
        displayName,
        () => console.log('[IDENTITY] Requesting geolocation permission...')
      );

      // Store certificate in localStorage (public data only)
      localStorage.setItem(
        'worldseed_certificate',
        JSON.stringify(result.certificate)
      );

      // Keep the export key temporarily for backup flow
      set({ 
        state: IdentityState.READY, 
        certificate: result.certificate,
        pendingExportKey: result.privateKeyForExport
      });

      console.log(`[IDENTITY] Created: ${result.certificate.metadata.uid}`);
      return true;
    } catch (e) {
      console.error('[IDENTITY] Creation failed:', e);
      set({ 
        state: IdentityState.ERROR, 
        error: e instanceof Error ? e.message : 'Unknown error' 
      });
      return false;
    }
  },

  exportIdentity: async (password: string) => {
    const { certificate, pendingExportKey } = get();
    
    if (!certificate) {
      console.error('[IDENTITY] No certificate to export');
      return null;
    }

    // If we don't have the pending key, we need to get it from IndexedDB
    // This is only possible right after creation
    if (!pendingExportKey) {
      console.error('[IDENTITY] Export key not available. Can only export immediately after creation.');
      return null;
    }

    try {
      const blob = await CertificateSystem.exportIdentity(
        certificate,
        pendingExportKey,
        password
      );

      // Clear the pending key after successful export
      set({ pendingExportKey: null });

      return blob;
    } catch (e) {
      console.error('[IDENTITY] Export failed:', e);
      return null;
    }
  },

  importIdentity: async (fileContent: string, password: string) => {
    set({ state: IdentityState.LOADING, error: null });

    try {
      const result = await CertificateSystem.importIdentity(fileContent, password);

      if (!result.success) {
        set({ 
          state: IdentityState.NO_IDENTITY, 
          error: 'Invalid password or corrupted file' 
        });
        return false;
      }

      // Store certificate
      localStorage.setItem(
        'worldseed_certificate',
        JSON.stringify(result.certificate)
      );

      set({ 
        state: IdentityState.READY, 
        certificate: result.certificate 
      });

      console.log(`[IDENTITY] Imported: ${result.certificate.metadata.uid}`);
      return true;
    } catch (e) {
      console.error('[IDENTITY] Import failed:', e);
      set({ 
        state: IdentityState.ERROR, 
        error: 'Import failed' 
      });
      return false;
    }
  },

  signData: async <T>(data: T) => {
    const { certificate } = get();
    
    if (!certificate) {
      console.error('[IDENTITY] Cannot sign: no identity');
      return null;
    }

    try {
      return await CertificateSystem.signPayload(
        certificate.metadata.uid,
        data
      );
    } catch (e) {
      console.error('[IDENTITY] Signing failed:', e);
      return null;
    }
  },

  clearIdentity: async () => {
    const { certificate } = get();
    
    if (certificate) {
      // Clear from IndexedDB
      const request = indexedDB.open('WorldSeedIdentity', 1);
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const tx = db.transaction('keys', 'readwrite');
        tx.objectStore('keys').delete(certificate.metadata.uid);
      };
    }

    // Clear localStorage
    localStorage.removeItem('worldseed_certificate');

    set({ 
      state: IdentityState.NO_IDENTITY, 
      certificate: null,
      pendingExportKey: null 
    });

    console.log('[IDENTITY] Cleared');
  }
}));