export type EntityCategory = 'player' | 'obstacle' | 'enemy' | 'collectible' | 'background' | 'rail';

// Globally unique type identifiers for entities
export type EntityTypeId =
  | 'player.gondola'
  | 'obstacle.spinner'
  | 'obstacle.bouncer'
  | 'obstacle.staticRock'
  | 'obstacle.pendulum'
  | 'obstacle.crusher'
  | 'obstacle.laser'
  | 'obstacle.swoop'
  | 'obstacle.orbiter'
  | 'obstacle.boulder'
  | 'obstacle.mine'
  | 'obstacle.stalactite'
  | 'rail.segment'
   | 'rail.startTile'
   | 'rail.endTile'
  | 'collectible.star'
  | 'background.mountain'
  | 'background.cloud';

export type EntityId = string;

export interface BaseEntity {
  id: EntityId;
  typeId: EntityTypeId;
}

