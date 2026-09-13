/**
 * Turns a board layout into a portable text code, and back.
 *
 * The point of this file is what it does *not* need: no server round trip, no
 * new Firestore collection, no security rule. A layout is proportional
 * geometry with nothing board-specific baked into it — no board ID, no
 * tenant, nothing sensitive — so copying one to another board (or pasting it
 * to a teammate running a different tenant entirely) is exactly as safe as
 * copying any other piece of text between two people, and the whole feature
 * is just serialising `BoardLayout` into a string someone can paste, and
 * parsing it back on the other end. `core/liveLayout.ts` is what talks to the
 * database; this file only ever talks to a clipboard.
 *
 * The encoding favours a short result over a general one: sections are a
 * fixed, known, ordered list (`SECTIONS`), so each is written as a plain
 * array of its seven fields in that fixed order rather than as a JSON object
 * keyed by section id — the id itself is implied by position, and never has
 * to appear in the string at all. `visible`/`showLabel` are written as 1/0
 * rather than `true`/`false` for the same reason: shorter, and just as
 * unambiguous once decoded back through `Boolean()`.
 */
import {
  clampBox,
  LAYOUT_VERSION,
  SECTIONS,
  type BoardLayout,
  type SectionBox,
  type SectionId,
} from './boardLayout.js';

/** One section's box, as the seven-element row the code actually stores. */
type EncodedRow = [number, number, number, number, number, 0 | 1, 0 | 1];

function toRow(box: SectionBox): EncodedRow {
  return [box.x, box.y, box.w, box.h, box.scale, box.visible ? 1 : 0, box.showLabel ? 1 : 0];
}

/** `+`/`/` need escaping in a URL and look like typos in a pasted code; `-`/`_` don't. */
function toBase64Url(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): string {
  const restored = input.replace(/-/g, '+').replace(/_/g, '/');
  const paddingNeeded = (4 - (restored.length % 4)) % 4;
  return atob(restored + '='.repeat(paddingNeeded));
}

/** Encodes a layout as a compact, copy-pasteable code. */
export function encodeLayoutCode(layout: BoardLayout): string {
  const rows = SECTIONS.map((section) => toRow(layout.sections[section.id]));
  return toBase64Url(JSON.stringify([layout.version, rows]));
}

/**
 * Decodes a code produced by `encodeLayoutCode`, or returns `null`.
 *
 * `null` covers everything that could be wrong with a hand-pasted string —
 * truncated, copied with a stray character, produced by some future version
 * of this encoding — and every one of them is the same situation for the
 * caller: there is nothing usable here, so say so rather than guess at a
 * partial layout. `clampBox` still runs on whatever numbers do decode, the
 * same defence `parseBoardLayout` applies to a value that came out of the
 * database rather than off a clipboard.
 */
export function decodeLayoutCode(code: string): BoardLayout | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(code.trim()));
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [version, rows] = parsed as [unknown, unknown];
  if (version !== LAYOUT_VERSION) return null;
  if (!Array.isArray(rows) || rows.length !== SECTIONS.length) return null;

  const sections = {} as Record<SectionId, SectionBox>;
  for (let i = 0; i < SECTIONS.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length !== 7 || row.some((value) => typeof value !== 'number')) {
      return null;
    }
    const [x, y, w, h, scale, visible, showLabel] = row as number[];
    sections[SECTIONS[i]!.id] = clampBox({
      x: x!,
      y: y!,
      w: w!,
      h: h!,
      scale: scale!,
      visible: Boolean(visible),
      showLabel: Boolean(showLabel),
    });
  }

  return { version: LAYOUT_VERSION, sections };
}
