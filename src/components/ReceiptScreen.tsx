/**
 * THE RECEIPT (Wave 9.6). The signature moment of the game is not a kill: it is
 * the instant the haul is sealed into the ledger — and its mirror, the record
 * that reads DIED. Both hold the screen until they are looked at.
 */

import React from 'react';
import { Busy, Button, ItemSprite, Panel, SealView } from './ui/kit';
import { useReceipt } from './ui/stores';

const fmtMs = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}m ${(s % 60).toString().padStart(2, '0')}s`;
};

export const ReceiptScreen: React.FC = () => {
  const { receipt, clear } = useReceipt();
  if (!receipt) return null;

  const died = receipt.outcome === 'DIED';
  const tone = died ? 'loss' : 'proof';

  return (
    <div
      className="ws-ui ws-overlay"
      role="dialog"
      aria-label={died ? 'Death receipt' : 'Extraction receipt'}
      style={{ background: 'rgba(3,3,3,0.92)' }}
    >
      <Panel tone={tone} style={{ width: 460, maxHeight: '88vh', overflow: 'auto' }}>
        <div style={{ textAlign: 'center', padding: '6px 0 10px' }}>
          <div className={died ? 'ws-loss' : 'ws-proof'} style={{ fontSize: 'var(--ws-font-display)', letterSpacing: '0.3em', fontWeight: 700 }}>
            {died ? 'DIED' : 'SEALED'}
          </div>
          <div className="ws-dim ws-small" style={{ letterSpacing: '0.12em', marginTop: 2 }}>
            {receipt.cause === 'GATE' ? 'THE GATE CLOSED WITH YOU INSIDE — THE WORLD KEEPS WHAT FELL' : died ? 'SESSION RECEIPT — THE WORLD KEEPS WHAT FELL' : 'SESSION RECEIPT — BANKED AND SIGNED'}
          </div>
        </div>

        <div className="ws-list ws-small">
          <div className="ws-row"><span className="ws-dim">WORLD</span><span>{receipt.worldName}</span></div>
          <div className="ws-row"><span className="ws-dim">DURATION</span><span>{receipt.sealing ? '…' : fmtMs(receipt.durationMs)}</span></div>
          <div className="ws-row"><span className="ws-dim">ACTIONS ON RECORD</span><span>{receipt.sealing ? '…' : receipt.actionCount}</span></div>
          <div className="ws-row">
            <span className="ws-dim">{died ? 'LOST TO THE WORLD' : 'HAUL VALUE'}</span>
            <span className={died ? 'ws-loss' : 'ws-proof'}>{receipt.haulValue.toLocaleString()} G</span>
          </div>
          {!died && (
            <div className="ws-row">
              <span className="ws-dim">HUB LEVY{receipt.levy?.attempted ? (receipt.levy.dodged ? ' · DODGED' : ' · CAUGHT: PAID IN FULL') : ''}</span>
              <span>{receipt.tax.toLocaleString()} G</span>
            </div>
          )}
        </div>

        {receipt.haul.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '10px 0', alignItems: 'flex-end' }}>
            {receipt.haul.slice(0, 24).map(item => (
              <ItemSprite key={item.id} item={died ? item : { ...item, isIdentified: true }} cellPx={22} title={died && item.isIdentified === false ? 'Unidentified Signal' : item.name} />
            ))}
            {receipt.haul.length > 24 && <span className="ws-dim ws-small">+{receipt.haul.length - 24} more</span>}
          </div>
        )}
        {receipt.haul.length === 0 && (
          <div className="ws-dim ws-small" style={{ margin: '10px 0' }}>
            {died ? 'Nothing was carried. Nothing was lost.' : 'Came home empty-handed. The record is kept anyway.'}
          </div>
        )}

        {/* D30: the sealed session is the rest, and what settled there is on the record */}
        {(receipt.settled?.length ?? 0) > 0 && (
          <div style={{ borderTop: '1px solid var(--ws-void-3)', paddingTop: 8, marginBottom: 10 }}>
            <div className="ws-proof ws-small" style={{ letterSpacing: '0.12em', marginBottom: 4 }}>IT SETTLED</div>
            {receipt.settled!.map(name => (
              <div key={name} className="ws-row ws-small"><span>{name}</span><span className="ws-dim">the hands know it now</span></div>
            ))}
          </div>
        )}

        {/* Wave 10C (D21): the death kept exactly what the magic named */}
        {died && (receipt.kept?.length ?? 0) > 0 && (
          <div style={{ borderTop: '1px solid var(--ws-void-3)', paddingTop: 8, marginBottom: 10 }}>
            <div className="ws-proof ws-small" style={{ letterSpacing: '0.12em', marginBottom: 4 }}>KEPT BY MAGIC</div>
            {receipt.kept!.map(({ item, by }) => (
              <div key={item.id} className="ws-row ws-small">
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <ItemSprite item={item} cellPx={18} title={item.name} />
                  <span>{item.name}</span>
                </span>
                <span className="ws-proof">held by {by}</span>
              </div>
            ))}
            <div className="ws-dim ws-small" style={{ marginTop: 2 }}>The death took everything else. The magic named these, and the bank honors it.</div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderTop: '1px solid var(--ws-void-3)', paddingTop: 10 }}>
          {receipt.signature
            ? <SealView hash={receipt.signature} scale={3} />
            : null}
          <div className="ws-small" style={{ flex: 1 }}>
            {receipt.sealing
              ? <Busy label="SEALING" tone={tone} />
              : <div className="ws-dim">{receipt.signature ? 'Signed by your certificate. The bank honors it.' : 'No signature came back. The bank keeps what it was given.'}</div>}
            {receipt.signature && <div className="ws-ghost" style={{ wordBreak: 'break-all', color: 'var(--ws-text-ghost)' }}>{receipt.signature.slice(0, 48)}…</div>}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <Button tone={tone} primary onClick={clear} autoFocus>
            {died ? 'ACKNOWLEDGE THE LOSS' : 'CLOSE THE VAULT'}
          </Button>
        </div>
      </Panel>
    </div>
  );
};
