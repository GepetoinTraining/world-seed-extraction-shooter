/**
 * D119: what an answer to "what do you want to make" is read against (MakeAsk.judge), and what a sleep is told could be
 * raised: the registry's words as they stand now, and every station this hub's web or its people's chains hold.
 */

import type { IHubPort } from '../../entities/hub/hubView';
import { emptyTech, hubStations } from '../../entities/hub/hubTech';
import { IMakeGround } from '../../../shared/logic/systems/MakeAsk';
import { WebBank } from '../../../shared/logic/content/WebBank';

export const makeGround = (hp: IHubPort): IMakeGround => {
  const tags = WebBank.current().tags;
  return {
    kindOf: tag => tags.find(t => t.tag === tag && !t.retired)?.kind,
    stations: hubStations(hp.view().tech ?? emptyTech()).map(s => ({ key: s.id, name: s.name }))
  };
};
