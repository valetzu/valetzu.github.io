import config from './sprites.json';
import type { EntityTypeId } from './entityTypes';

type SpriteConfig = typeof config;

class SpriteManager {
  private images = new Map<string, HTMLImageElement>();
  private configByType = new Map<EntityTypeId, SpriteConfig['types'][number]>();
  private placeholder: HTMLCanvasElement;

  constructor(private cfg: SpriteConfig) {
    for (const entry of cfg.types) {
      this.configByType.set(entry.id as EntityTypeId, entry);
    }
    this.placeholder = this.createPlaceholder();
  }

  private createPlaceholder(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#555';
    ctx.fillRect(0, 0, 32, 32);
    ctx.strokeStyle = '#FF00FF';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(32, 32);
    ctx.moveTo(32, 0);
    ctx.lineTo(0, 32);
    ctx.stroke();
    return c;
  }

  private loadImage(path: string): HTMLImageElement {
    if (this.images.has(path)) return this.images.get(path)!;
    const img = new Image();
    img.src = path;
    this.images.set(path, img);
    return img;
  }

  private getEntry(typeId: EntityTypeId) {
    return this.configByType.get(typeId) ?? null;
  }

  /**
   * Draw sprite for a given entity type if:
   * - There is a config entry for it
   * - The entry is enabled
   * If the image is not yet loaded or fails, a placeholder is drawn.
   * Returns true if something was drawn, false if caller should fall back.
   */
  drawSpriteOrFallback(
    ctx: CanvasRenderingContext2D,
    typeId: EntityTypeId,
    x: number,
    y: number,
    opts?: { width?: number; height?: number; rotation?: number; hitboxRadius?: number }
  ): boolean {
    const entry = this.getEntry(typeId);
    if (!entry || (entry as any).enabled === false) {
      return false;
    }

    const fullPath = `${this.cfg.basePath}/${entry.sprite}`;
    const img = this.loadImage(fullPath);

    const usePlaceholder = !img.complete || img.naturalWidth === 0 || img.naturalHeight === 0;
    const source = usePlaceholder ? this.placeholder : img;

    // If a hitbox radius is provided, size the sprite to match it (with optional scale).
    let w: number;
    let h: number;
    if (opts?.hitboxRadius != null) {
      const logicalSize = opts.hitboxRadius * 2;
      const scale = (entry as any).hitboxScale ?? 1;
      const targetSize = logicalSize * scale;
      w = opts.width ?? targetSize;
      h = opts.height ?? targetSize;
    } else {
      w = opts?.width ?? source.width;
      h = opts?.height ?? source.height;
    }
    const anchorX = entry.anchor?.x ?? 0.5;
    const anchorY = entry.anchor?.y ?? 0.5;

    const drawX = x - w * anchorX;
    const drawY = y - h * anchorY;

    ctx.save();
    if (opts?.rotation) {
      ctx.translate(x, y);
      ctx.rotate(opts.rotation);
      ctx.translate(-x, -y);
    }
    ctx.drawImage(source, drawX, drawY, w, h);
    ctx.restore();

    return true;
  }
}

export const spriteManager = new SpriteManager(config);

