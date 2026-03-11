export type EntityCategory = 'player' | 'obstacle' | 'enemy' | 'background' | 'rail';

// Globally unique type identifiers for entities
export type EntityTypeId =
  | 'player.gondola'
  | 'obstacle.spinner'
  | 'obstacle.bouncer'
  | 'obstacle.staticRock'
  | 'rail.segment'
   | 'rail.startTile'
   | 'rail.endTile'
  | 'background.mountain'
  | 'background.cloud';

export type EntityId = string;

export interface BaseEntity {
  id: EntityId;
  typeId: EntityTypeId;
}

