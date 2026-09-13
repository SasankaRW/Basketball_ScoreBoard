/**
 * The layout-sharing code: a board's layout, serialised into something a
 * person can paste into another board's editor (or into a chat message to a
 * teammate) with no server involved at all. `decodeLayoutCode` is the
 * untrusted boundary — every one of these inputs is exactly what a real
 * pasted string can be: truncated, hand-edited, or produced by a version of
 * this encoding that no longer exists — and the contract for all of them is
 * the same: `null`, never a partial or guessed-at layout.
 */
import { describe, expect, it } from 'vitest';
import { defaultLayout, withSection, type SectionId } from '../../src/core/boardLayout.js';
import { decodeLayoutCode, encodeLayoutCode } from '../../src/core/layoutCode.js';

describe('encodeLayoutCode / decodeLayoutCode', () => {
  it('round-trips the default layout exactly', () => {
    const layout = defaultLayout();
    expect(decodeLayoutCode(encodeLayoutCode(layout))).toEqual(layout);
  });

  it('round-trips a layout with every kind of edit applied', () => {
    let layout = defaultLayout();
    layout = withSection(layout, 'home-score', { x: 12.5, y: 30, w: 22, h: 28, scale: 1.4 });
    layout = withSection(layout, 'logo', { visible: false });
    layout = withSection(layout, 'game-clock', { showLabel: false });

    expect(decodeLayoutCode(encodeLayoutCode(layout))).toEqual(layout);
  });

  it('produces a URL-safe string with no padding characters', () => {
    const code = encodeLayoutCode(defaultLayout());
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces a code short enough to comfortably paste', () => {
    // Not a hard contract, just a sanity bound: this is meant to be pasted
    // into a text field, not saved to a file.
    expect(encodeLayoutCode(defaultLayout()).length).toBeLessThan(600);
  });

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['plain garbage', 'not-a-real-code'],
    ['valid base64url of unrelated JSON', btoa(JSON.stringify({ hello: 'world' }))],
    ['truncated code', encodeLayoutCode(defaultLayout()).slice(0, 20)],
    ['code with a stray character appended', encodeLayoutCode(defaultLayout()) + '!'],
  ])('rejects %s as null rather than a guess', (_name, input) => {
    expect(decodeLayoutCode(input)).toBeNull();
  });

  it('rejects a code from a version this build does not understand', () => {
    const wrongVersion = btoa(JSON.stringify([999, []]))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeLayoutCode(wrongVersion)).toBeNull();
  });

  it('rejects a code with the wrong number of sections', () => {
    const tooFew = btoa(JSON.stringify([1, [[0, 0, 10, 10, 1, 1, 1]]]))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeLayoutCode(tooFew)).toBeNull();
  });

  it('rejects a row with a non-numeric field', () => {
    const layout = defaultLayout();
    const rows = Object.keys(layout.sections).map(() => [0, 0, 10, 10, 1, 1, 1]);
    rows[0]![0] = 'nope' as unknown as number;
    const bad = btoa(JSON.stringify([1, rows]))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeLayoutCode(bad)).toBeNull();
  });

  it('clamps a decoded box the same way a stored one is clamped', () => {
    const rows = Array.from({ length: 13 }, () => [-9999, 0, 10, 10, 1, 1, 1]);
    const code = btoa(JSON.stringify([1, rows]))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const decoded = decodeLayoutCode(code);
    expect(decoded).not.toBeNull();
    const firstId = Object.keys(decoded!.sections)[0] as SectionId;
    expect(decoded!.sections[firstId].x).toBeGreaterThanOrEqual(-100);
  });
});
