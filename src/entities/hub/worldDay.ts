/** The day of the world's clock, as the hub counts it. A read of the clock, kept apart from the hub store. */
import { GameClock } from '../../logic/time/GameClock';

export const worldDay = () => GameClock.day();
