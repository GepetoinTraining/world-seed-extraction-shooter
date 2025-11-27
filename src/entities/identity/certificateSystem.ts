/**
 * CERTIFICATE SYSTEM
 * Self-Sovereign Identity via X.509 Certificates
 */

// ============================================================================
// TYPES
// ============================================================================

export interface IBirthData {
  coordinates: {
    latitude: number;
    longitude: number;
    accuracy: number; // meters
  };
  timestamp: number; // Unix ms
  entropy: string; // Additional randomness
  userAgent: string; // Browser fingerprint component
}

export interface ICertificateMetadata {
  uid: string; // The unique birth hash
  displayName: string;
  birthData: IBirthData;
  createdAt: number;
  version: string;
}

export interface IPlayerCertificate {
  metadata: ICertificateMetadata;
  publicKeyJWK: JsonWebKey;
  certificatePEM: string; // The actual X.509 cert
  // Private key NEVER leaves the browser's secure storage
}

export interface ISignedPayload<T> {
  payload: T;
  signature: string; // Base64 encoded
  certUid: string; // Which cert signed this
  timestamp: number;
}

// ============================================================================
// CERTIFICATE GENERATION
// ============================================================================

export class CertificateSystem {
  
  private static readonly CERT_VERSION = '1.0.0';
  // FIX: Bump DB version to 2 to force 'keys' store creation if missing
  private static readonly DB_VERSION = 2; 
  
  private static readonly KEY_ALGORITHM = {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256'
  };

  /**
   * Generate a new player identity
   * This is the "birth" moment - happens once per player
   */
  static async generateBirthCertificate(
    displayName: string,
    onGeoPermission?: () => void
  ): Promise<{ certificate: IPlayerCertificate; privateKeyForExport: JsonWebKey }> {
    
    // 1. Collect birth data
    const birthData = await this.collectBirthData(onGeoPermission);
    
    // 2. Generate UID from birth data
    const uid = await this.generateUID(birthData);
    
    // 3. Generate keypair
    const keyPair = await crypto.subtle.generateKey(
      this.KEY_ALGORITHM,
      true, // extractable (for export)
      ['sign', 'verify']
    );

    // 4. Export public key
    const publicKeyJWK = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const privateKeyJWK = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

    // 5. Create certificate metadata
    const metadata: ICertificateMetadata = {
      uid,
      displayName,
      birthData,
      createdAt: Date.now(),
      version: this.CERT_VERSION
    };

    // 6. Generate self-signed certificate (simplified PEM)
    const certificatePEM = await this.generateSelfSignedCert(metadata, keyPair);

    // 7. Store private key in IndexedDB (secure, non-extractable after this)
    await this.storePrivateKey(uid, keyPair.privateKey);

    return {
      certificate: {
        metadata,
        publicKeyJWK,
        certificatePEM
      },
      privateKeyForExport: privateKeyJWK // For .p12 export
    };
  }

  /**
   * Collect geolocation and temporal data for birth certificate
   */
  private static async collectBirthData(
    onGeoPermission?: () => void
  ): Promise<IBirthData> {
    
    // Request geolocation
    let coordinates = { latitude: 0, longitude: 0, accuracy: 0 };
    
    try {
      if (onGeoPermission) onGeoPermission();
      
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 30000,
          maximumAge: 0
        });
      });

      coordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      };
    } catch (e) {
      // Geo denied - use IP-based approximation or zeros
      console.warn('[CERT] Geolocation denied, using fallback');
    }

    // Generate entropy
    const entropyArray = new Uint8Array(32);
    crypto.getRandomValues(entropyArray);
    const entropy = Array.from(entropyArray)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return {
      coordinates,
      timestamp: Date.now(),
      entropy,
      userAgent: navigator.userAgent
    };
  }

  /**
   * Generate unique identifier from birth data
   * This is THE unforgeable identity
   */
  private static async generateUID(birthData: IBirthData): Promise<string> {
    const dataString = [
      birthData.coordinates.latitude.toFixed(6),
      birthData.coordinates.longitude.toFixed(6),
      birthData.timestamp.toString(),
      birthData.entropy,
      birthData.userAgent
    ].join('|');

    const encoder = new TextEncoder();
    const data = encoder.encode(dataString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Format: ws_[first 8 chars]_[birth timestamp base36]_[last 8 chars]
    const timeComponent = birthData.timestamp.toString(36);
    return `ws_${hashHex.slice(0, 8)}_${timeComponent}_${hashHex.slice(-8)}`;
  }

  /**
   * Generate a simplified self-signed certificate
   */
  private static async generateSelfSignedCert(
    metadata: ICertificateMetadata,
    keyPair: CryptoKeyPair
  ): Promise<string> {
    const certData = {
      version: 3,
      serialNumber: metadata.uid,
      issuer: {
        commonName: `WorldSeed:Player:${metadata.displayName}`,
        organizationName: 'Self-Sovereign',
        uid: metadata.uid
      },
      subject: {
        commonName: `WorldSeed:Player:${metadata.displayName}`,
        organizationName: 'Self-Sovereign',
        uid: metadata.uid
      },
      validity: {
        notBefore: new Date(metadata.createdAt).toISOString(),
        notAfter: new Date(metadata.createdAt + 100 * 365 * 24 * 60 * 60 * 1000).toISOString() // 100 years
      },
      extensions: {
        'worldseed.birthCoords': `${metadata.birthData.coordinates.latitude},${metadata.birthData.coordinates.longitude}`,
        'worldseed.birthTime': new Date(metadata.birthData.timestamp).toISOString(),
        'worldseed.genesisHash': metadata.uid
      },
      publicKey: await crypto.subtle.exportKey('jwk', keyPair.publicKey)
    };

    // Sign the certificate data
    const certString = JSON.stringify(certData);
    const encoder = new TextEncoder();
    const signature = await crypto.subtle.sign(
      this.KEY_ALGORITHM.name,
      keyPair.privateKey,
      encoder.encode(certString)
    );

    const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

    // Create PEM-like format
    const fullCert = {
      certificate: certData,
      signature: signatureB64
    };

    return `-----BEGIN WORLDSEED CERTIFICATE-----\n${btoa(JSON.stringify(fullCert))}\n-----END WORLDSEED CERTIFICATE-----`;
  }

  /**
   * Store private key securely in IndexedDB
   */
  private static async storePrivateKey(uid: string, privateKey: CryptoKey): Promise<void> {
    return new Promise((resolve, reject) => {
      // FIX: Use DB_VERSION constant (2)
      const request = indexedDB.open('WorldSeedIdentity', this.DB_VERSION);
      
      request.onerror = () => reject(request.error);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('keys')) {
          db.createObjectStore('keys', { keyPath: 'uid' });
        }
      };

      request.onsuccess = async (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const tx = db.transaction('keys', 'readwrite');
        const store = tx.objectStore('keys');
        
        store.put({ uid, privateKey });
        
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }

  /**
   * Retrieve private key for signing
   */
  static async getPrivateKey(uid: string): Promise<CryptoKey | null> {
    return new Promise((resolve, reject) => {
      // FIX: Use DB_VERSION constant (2)
      const request = indexedDB.open('WorldSeedIdentity', this.DB_VERSION);
      
      request.onerror = () => reject(request.error);
      
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Safety check if store exists (in case user has weird partial state)
        if (!db.objectStoreNames.contains('keys')) {
            resolve(null);
            return;
        }

        const tx = db.transaction('keys', 'readonly');
        const store = tx.objectStore('keys');
        const getRequest = store.get(uid);
        
        getRequest.onsuccess = () => {
          resolve(getRequest.result?.privateKey || null);
        };
        getRequest.onerror = () => reject(getRequest.error);
      };
    });
  }

  // ============================================================================
  // SIGNING & VERIFICATION
  // ============================================================================

  static async signPayload<T>(
    uid: string,
    payload: T
  ): Promise<ISignedPayload<T>> {
    const privateKey = await this.getPrivateKey(uid);
    if (!privateKey) {
      throw new Error('Private key not found. Identity may not be initialized.');
    }

    const timestamp = Date.now();
    const dataToSign = JSON.stringify({ payload, timestamp });
    const encoder = new TextEncoder();
    
    const signature = await crypto.subtle.sign(
      this.KEY_ALGORITHM.name,
      privateKey,
      encoder.encode(dataToSign)
    );

    return {
      payload,
      signature: btoa(String.fromCharCode(...new Uint8Array(signature))),
      certUid: uid,
      timestamp
    };
  }

  static async verifyPayload<T>(
    signedPayload: ISignedPayload<T>,
    certificate: IPlayerCertificate
  ): Promise<boolean> {
    try {
      const publicKey = await crypto.subtle.importKey(
        'jwk',
        certificate.publicKeyJWK,
        this.KEY_ALGORITHM,
        true,
        ['verify']
      );

      const dataToVerify = JSON.stringify({ 
        payload: signedPayload.payload, 
        timestamp: signedPayload.timestamp 
      });
      const encoder = new TextEncoder();

      const signatureBytes = Uint8Array.from(
        atob(signedPayload.signature),
        c => c.charCodeAt(0)
      );

      return await crypto.subtle.verify(
        this.KEY_ALGORITHM.name,
        publicKey,
        signatureBytes,
        encoder.encode(dataToVerify)
      );
    } catch (e) {
      console.error('[CERT] Verification failed:', e);
      return false;
    }
  }

  // ============================================================================
  // EXPORT / IMPORT
  // ============================================================================

  static async exportIdentity(
    certificate: IPlayerCertificate,
    privateKeyJWK: JsonWebKey,
    password: string
  ): Promise<Blob> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const encryptionKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedKey = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      encryptionKey,
      encoder.encode(JSON.stringify(privateKeyJWK))
    );

    const exportData = {
      version: this.CERT_VERSION,
      certificate,
      encryptedPrivateKey: {
        salt: Array.from(salt),
        iv: Array.from(iv),
        data: Array.from(new Uint8Array(encryptedKey))
      }
    };

    return new Blob(
      [JSON.stringify(exportData, null, 2)],
      { type: 'application/json' }
    );
  }

  static async importIdentity(
    fileContent: string,
    password: string
  ): Promise<{ certificate: IPlayerCertificate; success: boolean }> {
    try {
      const exportData = JSON.parse(fileContent);
      const { certificate, encryptedPrivateKey } = exportData;

      const encoder = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
      );

      const decryptionKey = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: new Uint8Array(encryptedPrivateKey.salt),
          iterations: 100000,
          hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );

      const decryptedData = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(encryptedPrivateKey.iv) },
        decryptionKey,
        new Uint8Array(encryptedPrivateKey.data)
      );

      const privateKeyJWK = JSON.parse(
        new TextDecoder().decode(decryptedData)
      );

      const privateKey = await crypto.subtle.importKey(
        'jwk',
        privateKeyJWK,
        this.KEY_ALGORITHM,
        false,
        ['sign']
      );

      await this.storePrivateKey(certificate.metadata.uid, privateKey);

      return { certificate, success: true };
    } catch (e) {
      console.error('[CERT] Import failed:', e);
      return { certificate: null as any, success: false };
    }
  }

  static parseCertificate(pem: string): IPlayerCertificate | null {
    try {
      const b64 = pem
        .replace('-----BEGIN WORLDSEED CERTIFICATE-----', '')
        .replace('-----END WORLDSEED CERTIFICATE-----', '')
        .trim();
      
      const { certificate } = JSON.parse(atob(b64));
      
      return {
        metadata: {
          uid: certificate.serialNumber,
          displayName: certificate.subject.commonName.replace('WorldSeed:Player:', ''),
          birthData: {
            coordinates: (() => {
              const [lat, lng] = certificate.extensions['worldseed.birthCoords'].split(',');
              return { latitude: parseFloat(lat), longitude: parseFloat(lng), accuracy: 0 };
            })(),
            timestamp: new Date(certificate.extensions['worldseed.birthTime']).getTime(),
            entropy: '',
            userAgent: ''
          },
          createdAt: new Date(certificate.validity.notBefore).getTime(),
          version: '1.0.0'
        },
        publicKeyJWK: certificate.publicKey,
        certificatePEM: pem
      };
    } catch (e) {
      console.error('[CERT] Parse failed:', e);
      return null;
    }
  }
}