/**
 * SIGNING: a loaded pack or web is banked signed into the CONTENT namespace. It needs this
 * machine's identity and its store, so it lives on the game's side; the banks it reads stay pure.
 */
import { ISignedContentPack, ISignedWebPack } from '../../../types';
import { AffixBank } from './AffixBank';
import { WebBank } from './WebBank';

export async function bankAndSignAffixes(signerUid: string): Promise<ISignedContentPack | null> {
  try {
    const pack = AffixBank.current();
    const { CertificateSystem } = await import('../../entities/identity/certificateSystem');
    const signed = await CertificateSystem.signPayload(signerUid, pack as any);
    if (!signed) return null;
    const doc: ISignedContentPack = { pack, signerUid, signature: signed.signature };
    const { VectorStore } = await import('../../entities/data/VectorStore');
    await VectorStore.saveContent(`content_pack_v${pack.version}`, 'content_pack', doc);
    return doc;
  } catch (e) {
    console.warn('[BANK] Content pack could not be signed:', e);
    return null;
  }
}

export async function bankAndSignWeb(signerUid: string): Promise<ISignedWebPack | null> {
  try {
    const pack = WebBank.current();
    const { CertificateSystem } = await import('../../entities/identity/certificateSystem');
    const signed = await CertificateSystem.signPayload(signerUid, pack as any);
    if (!signed) return null;
    const doc: ISignedWebPack = { pack, signerUid, signature: signed.signature };
    const { VectorStore } = await import('../../entities/data/VectorStore');
    await VectorStore.saveContent(`content_web_pack_v${pack.version}`, 'web_pack', doc);
    return doc;
  } catch (e) {
    console.warn('[BANK] Web pack could not be signed:', e);
    return null;
  }
}
