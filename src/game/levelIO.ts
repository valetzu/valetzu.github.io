import { EditorLevel, generateLevelId, loadCustomLevels } from './editorTypes';

export interface LevelExportEnvelope {
  format: 'sky-lift-dash-level';
  formatVersion: number;
  exportedAt: number;
  level: EditorLevel;
}

const CURRENT_FORMAT_VERSION = 3;

/** Wrap an EditorLevel in a versioned envelope and return JSON string. */
export function exportLevel(level: EditorLevel): string {
  const envelope: LevelExportEnvelope = {
    format: 'sky-lift-dash-level',
    formatVersion: CURRENT_FORMAT_VERSION,
    exportedAt: Date.now(),
    level,
  };
  return JSON.stringify(envelope, null, 2);
}

/** Parse and validate an exported level file. Returns the EditorLevel or an error string. */
export function importLevel(raw: string): EditorLevel | { error: string } {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'Invalid JSON file.' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { error: 'File does not contain a valid level.' };
  }

  // Support both envelope format and raw EditorLevel (for pasting localStorage data)
  let level: any;
  if (parsed.format === 'sky-lift-dash-level') {
    if (typeof parsed.formatVersion !== 'number' || parsed.formatVersion > CURRENT_FORMAT_VERSION) {
      return { error: `Unsupported format version: ${parsed.formatVersion}. Max supported: ${CURRENT_FORMAT_VERSION}.` };
    }
    level = parsed.level;
  } else if ((parsed.tiles || parsed.segments) && parsed.name) {
    // Raw EditorLevel without envelope (V2 has tiles, V3 has segments)
    level = parsed;
  } else {
    return { error: 'File is not a recognized level format. Expected "sky-lift-dash-level" format.' };
  }

  if (!level || typeof level !== 'object') {
    return { error: 'Level data is missing or invalid.' };
  }
  if (!level.tiles && !level.segments) {
    return { error: 'Level has no rail data (tiles or segments).' };
  }
  if (!level.name || typeof level.name !== 'string' || !level.name.trim()) {
    return { error: 'Level has no name.' };
  }

  // Generate a fresh id to avoid collisions with existing levels
  const imported: EditorLevel = {
    ...level,
    id: generateLevelId(),
    // Clear music file — it references a local path that won't exist on another machine
    musicFile: undefined,
  };

  // Deduplicate name if it already exists
  const existing = loadCustomLevels();
  if (existing.some(l => l.name === imported.name)) {
    imported.name = `${imported.name} (imported)`;
  }

  return imported;
}

/** Trigger a file download in the browser. */
export function downloadLevelFile(level: EditorLevel): void {
  const json = exportLevel(level);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${level.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.gondola.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
