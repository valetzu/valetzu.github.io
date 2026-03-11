export type EntityCategory = 'player' | 'obstacle' | 'enemy' | 'background' | 'rail';

// Globally unique type identifiers for entities
export type EntityTypeId =
  | 'player.gondola'
  | 'obstacle.spinner'
  | 'obstacle.bouncer'
  | 'obstacle.staticRock'
  | 'rail.segment'
  | 'background.mountain'
  | 'background.cloud';

export type EntityId = string;

export interface BaseEntity {
  id: EntityId;
  typeId: EntityTypeId;
}

