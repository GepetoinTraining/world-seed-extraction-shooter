/**
 * Q39: the city folds its days at midnight while the person stays in it. Days and weeks used to
 * fold only when the city was opened, so someone who stayed across a midnight saw nothing turn.
 * The watch is a light one: a look at the day every few seconds, and the fold when it moves.
 */

import { useEffect } from 'react';
import { useHubStore, worldDay } from '../../entities/hub/store';

const LOOK_MS = 15_000;

export const useCityDay = (inCity: boolean) => {
  useEffect(() => {
    if (!inCity) return;
    let day = worldDay();
    const timer = setInterval(() => {
      const now = worldDay();
      if (now === day) return;
      day = now;
      void useHubStore.getState().turnTheDay();
    }, LOOK_MS);
    return () => clearInterval(timer);
  }, [inCity]);
};
