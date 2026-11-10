/**
 * SOUND, AS FAR AS IT GOES TODAY (Pedro, 2026-11-10: "we'll have sound, believe me ... so we need the
 * volume"). The game has no sound of its own yet. What is here is the one place a sound will ask how
 * loud it may be, and two plain notes to hear the setting by.
 */
import { gainOf } from './Settings';
import { useSettings } from './store';

type AudioContextLike = typeof AudioContext;

let context: AudioContext | null = null;

export const Sound = {
  /** What every sound is multiplied by, read at the moment it plays. */
  gain: (): number => gainOf(useSettings.getState().settings),

  /** Two short notes at the volume as it stands. False where this browser cannot play one. */
  async testTone(): Promise<boolean> {
    const Make: AudioContextLike | undefined = typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextLike }).webkitAudioContext);
    if (!Make) return false;
    try {
      context = context ?? new Make();
      // A browser holds sound back until the person has acted on the page, and may never answer: it is asked, not waited on
      if (context.state === 'suspended') await Promise.race([context.resume(), new Promise(r => setTimeout(r, 300))]);
      if (context.state !== 'running') return false;
      const gain = Sound.gain();
      const now = context.currentTime;
      [[440, 0], [660, 0.16]].forEach(([hertz, at]) => {
        const note = context!.createOscillator();
        const level = context!.createGain();
        note.type = 'triangle';
        note.frequency.value = hertz;
        // A quarter of full scale at the top of the slider: a test, not a shout
        level.gain.setValueAtTime(0, now + at);
        level.gain.linearRampToValueAtTime(0.25 * gain, now + at + 0.02);
        level.gain.linearRampToValueAtTime(0, now + at + 0.14);
        note.connect(level).connect(context!.destination);
        note.start(now + at);
        note.stop(now + at + 0.15);
      });
      return true;
    } catch {
      return false;
    }
  }
};
