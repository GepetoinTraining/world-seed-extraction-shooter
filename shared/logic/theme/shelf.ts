/**
 * What a hub's shelves may stock, by what a thing IS: filled by each installed
 * theme, read by the daily stock. The city names nothing of its own (D55).
 */
/** D49: has this hub unlocked magic? Kept here so the shelf can ask without reaching for the hub. */
export const SHELF_STATE = { magicUnlocked: false };

export const SHELF: { tools: string[]; carrier: string[]; wardrobe: string[]; consumables: string[]; materials: string[] } = {
  tools: [],
  carrier: [],
  wardrobe: [],
  consumables: [],
  materials: []
};
