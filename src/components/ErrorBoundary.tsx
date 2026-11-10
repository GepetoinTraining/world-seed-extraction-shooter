/**
 * A SCREEN THAT BREAKS SAYS SO (T2). An error while drawing used to blank the whole game to
 * black, with nothing said and a reload as the only way back, and in the field a reload ends
 * the run and loses the pack.
 *
 * It stands in two places. Inside the app, around its screens: what a character holds lives in
 * the stores and where they are lives in the app above, so drawing again brings back the same
 * screen and a run goes on. And once around the whole app, as the last thing that can catch:
 * from there drawing again starts at the character list, which ends a run as a reload does, so
 * its words promise nothing more than that.
 */

import React from 'react';
import { Button, Panel } from './ui/kit';

interface IBroken { error: Error | null }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode; whole?: boolean }, IBroken> {
  state: IBroken = { error: null };

  static getDerivedStateFromError(error: unknown): IBroken {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('[SCREEN] Stopped while drawing:', error, info.componentStack);
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { whole } = this.props;
    return (
      <div className="ws-ui" role="alert" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ws-void-1)', padding: 16 }}>
        <Panel title={whole ? 'THE GAME STOPPED' : 'THIS SCREEN STOPPED'} tone="loss" style={{ width: 520, maxWidth: '100%' }}>
          <div className="ws-small">
            {whole
              ? 'Something went wrong while drawing it. What your character has banked is untouched.'
              : 'Something went wrong while drawing it. What your character holds is not on the screen, and is untouched.'}
          </div>
          <div className="ws-dim ws-small" style={{ margin: '8px 0', wordBreak: 'break-word', borderLeft: '2px solid var(--ws-text-dim)', paddingLeft: 8 }}>{error.message || 'No reason was given.'}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button tone="signal" primary autoFocus onClick={() => this.setState({ error: null })}>TRY AGAIN</Button>
            <Button tone="quiet" onClick={() => window.location.reload()}>RELOAD</Button>
          </div>
          <div className="ws-dim ws-small" style={{ marginTop: 8 }}>
            {whole
              ? 'Trying again starts from the character list, as a reload does. Either way a run in the field ends, and what was carried is lost with it.'
              : 'Try again first: it draws the same screen and keeps where you are. A reload ends a run in the field, and what was carried is lost with it.'}
          </div>
        </Panel>
      </div>
    );
  }
}
