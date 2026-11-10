/**
 * What the page remembers between visits, as one JSON object in localStorage.
 * Every field is checked on the way in: anything unknown or broken becomes
 * its default, so an old or hand-edited value never stops the page.
 */
import { STYLES, type Style } from './music';
import { PATTERNS } from './scene';

export type Pace = 'section' | 'phrase' | 'song';

export interface Settings {
  /** 0..1 */
  volume: number;
  muted: boolean;
  /** Only this style of music; null for any. */
  style: Style | null;
  /** Only this pattern; null for any. */
  pattern: number | null;
  /** How often the picture changes: each section, each four bars, or once per song. */
  pace: Pace;
  /** Calmer motion: no flashes, slower movement. Starts from prefers-reduced-motion. */
  calm: boolean;
  showInfo: boolean;
}

export const PACES: readonly Pace[] = ['section', 'phrase', 'song'];

export function defaultSettings(reducedMotion = false): Settings {
  return { volume: 0.7, muted: false, style: null, pattern: null, pace: 'section', calm: reducedMotion, showInfo: false };
}

export function readSettings(raw: string | null, reducedMotion = false): Settings {
  const settings = defaultSettings(reducedMotion);
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    return settings;
  }
  if (!data || typeof data !== 'object') return settings;
  const d = data as Record<string, unknown>;
  if (typeof d.volume === 'number' && Number.isFinite(d.volume)) settings.volume = Math.max(0, Math.min(1, d.volume));
  if (typeof d.muted === 'boolean') settings.muted = d.muted;
  if (typeof d.style === 'string' && (STYLES as readonly string[]).includes(d.style)) settings.style = d.style as Style;
  if (typeof d.pattern === 'number' && Number.isInteger(d.pattern) && d.pattern >= 0 && d.pattern < PATTERNS.length) settings.pattern = d.pattern;
  if (typeof d.pace === 'string' && (PACES as readonly string[]).includes(d.pace)) settings.pace = d.pace as Pace;
  if (typeof d.calm === 'boolean') settings.calm = d.calm;
  if (typeof d.showInfo === 'boolean') settings.showInfo = d.showInfo;
  return settings;
}
