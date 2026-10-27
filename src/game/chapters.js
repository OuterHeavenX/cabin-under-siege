// Chapter registry: which maps, home and named roles each playable chapter uses.
// Systems read roles (neighbor, shopkeeper, job contact) from here instead of
// hard-coding characters, so new chapters can be added as data.
import { G } from './state.js';

export const CHAPTERS = {
  1: {
    id: 1, name: 'The Cabin', place: 'Pine Hollow', homeMap: 'cabin', workMap: 'town', maps: ['cabin', 'town'],
    neighbor: 'ruth', shopkeeper: 'dee', jobContact: 'gus', jobPlace: 'Okafor Lumber', storeName: 'Marsh General',
    hardwareName: 'Okafor Lumber', firstStep: 'arrive',
  },
  2: {
    id: 2, name: 'Larch Street', place: 'Millbrook', homeMap: 'millbrook', workMap: 'millbrook', maps: ['millbrook'],
    neighbor: 'marcus', shopkeeper: 'rosa', jobContact: 'pete', jobPlace: 'Kowalski Moving', storeName: 'Delgado Hardware',
    hardwareName: 'Delgado Hardware', firstStep: 'ch2_arrive',
  },
  3: {
    id: 3, name: 'The Wisconsin Farm', place: 'Kettle Crossing', homeMap: 'farm', workMap: 'farm', maps: ['farm'],
    neighbor: 'ingrid', shopkeeper: 'bo', jobContact: 'tess', jobPlace: 'the Grain Co-op', storeName: 'Lindqvist Feed & Supply',
    hardwareName: 'Lindqvist Feed & Supply', firstStep: 'ch3_arrive',
  },
};

export const LAST_CHAPTER = 3;

export const chapter = () => CHAPTERS[(G.s && G.s.chapter) || 1] || CHAPTERS[1];
export const homeMapId = () => chapter().homeMap;
export const workMapId = () => chapter().workMap;
export const homeMap = () => G.maps[homeMapId()];
export const workMap = () => G.maps[workMapId()];
export const atHome = () => G.map && G.map.id === homeMapId();

/** Interior target cell of the home building (attackers search there). */
export function homeInterior(mapId) {
  if (mapId !== homeMapId()) return null;
  const m = G.maps[mapId];
  return m && m.homeInfo ? m.homeInfo.interior : null;
}
