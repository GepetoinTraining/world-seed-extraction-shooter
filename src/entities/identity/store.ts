import { create } from 'zustand';
import { 
  CertificateSystem, 
  IPlayerCertificate, 
  ISignedPayload 
} from './certificateSystem';

export enum IdentityState {
  UNKNOWN = 'UNKNOWN',
  NO_IDENTITY = 'NO_IDENTITY',
  LOADING = 'LOADING',
  READY = 'READY',
  ERROR = 'ERROR'
}

interface IdentityStore {
  state: IdentityState;
  certificate: IPlayerCertificate | null;
  error: string | null;
  pendingExportKey: JsonWebKey | null;

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
      const storedCert = localStorage.getItem('worldseed_certificate');
      
      if (!storedCert) {
        set({ state: IdentityState.NO_IDENTITY });
        return;
      }

      const certificate = JSON.parse(storedCert) as IPlayerCertificate;
      
      const privateKey = await CertificateSystem.getPrivateKey(certificate.metadata.uid);
      
      if (!privateKey) {
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

      localStorage.setItem(
        'worldseed_certificate',
        JSON.stringify(result.certificate)
      );

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
    
    if (!certificate) return null;
    if (!pendingExportKey) return null;

    try {
      const blob = await CertificateSystem.exportIdentity(
        certificate,
        pendingExportKey,
        password
      );
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

      localStorage.setItem(
        'worldseed_certificate',
        JSON.stringify(result.certificate)
      );

      set({ 
        state: IdentityState.READY, 
        certificate: result.certificate 
      });

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
    if (!certificate) return null;

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
      // FIX: Use Version 2 to match CertificateSystem
      const request = indexedDB.open('WorldSeedIdentity', 2);
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (db.objectStoreNames.contains('keys')) {
            const tx = db.transaction('keys', 'readwrite');
            tx.objectStore('keys').delete(certificate.metadata.uid);
        }
      };
    }

    localStorage.removeItem('worldseed_certificate');

    set({ 
      state: IdentityState.NO_IDENTITY, 
      certificate: null,
      pendingExportKey: null 
    });
  }
}));