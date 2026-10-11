import { describe, expect, it } from 'vitest';
// The stylesheet, read as text: the colors are defined there and nowhere else.
import stylesheet from '../index.css?raw';

type Colors = Record<string, [number, number, number]>;

const TOKEN = /--([a-z-]+): (\d+) (\d+) (\d+); \/\* (#[0-9a-f]{6}) \*\//g;

/** The colors that a part of the stylesheet defines, each as its three channels. */
function colorsIn(css: string): Colors {
  return Object.fromEntries([...css.matchAll(TOKEN)].map(([, name, r, g, b]) => [name, [Number(r), Number(g), Number(b)]]));
}

const [lightPart, darkPart] = stylesheet.split('@media (prefers-color-scheme: dark)');
const LIGHT = colorsIn(lightPart);
// A color that the dark block does not name keeps its value, as it does in a browser.
const DARK = { ...LIGHT, ...colorsIn(darkPart.split('.on-header')[0]) };
const ON_HEADER = colorsIn(darkPart.split('.on-header')[1]);

/** The relative luminance of a color, as WCAG 2 defines it. */
function luminance([r, g, b]: [number, number, number]): number {
  const [red, green, blue] = [r, g, b].map((channel) => {
    const share = channel / 255;
    return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** The contrast ratio of two colors, from 1 to 21. */
function contrast(one: [number, number, number], other: [number, number, number]): number {
  const [lighter, darker] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

// WCAG AA: 4.5 to 1 for text, and 3 to 1 for a shape that has to be told from what it lies on.
const TEXT = 4.5;
const SHAPE = 3;

const GROUNDS = ['page', 'surface', 'sunken'];
const WITH_A_SOFT_COLOR = ['pr', 'elo', 'books', 'win', 'loss', 'warn'];
const SOURCES = ['pr', 'elo', 'books'];

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('the colors of the %s theme', (_theme, colors) => {
  it('are all there', () => {
    const names = [...GROUNDS, 'line', 'ink', 'muted', 'faint', 'on-fill', 'header', 'header-ink', 'header-muted', 'accent', 'focus'];
    const soft = WITH_A_SOFT_COLOR.flatMap((name) => [name, `${name}-soft`]);

    expect(Object.keys(colors).sort()).toEqual([...names, ...soft].sort());
  });

  it.each(['ink', 'muted', 'faint', ...WITH_A_SOFT_COLOR])('can be read as text in %s on the page, a surface and the sunken color', (name) => {
    for (const ground of GROUNDS) {
      expect(contrast(colors[name], colors[ground]), `${name} on ${ground}`).toBeGreaterThanOrEqual(TEXT);
    }
  });

  it.each(WITH_A_SOFT_COLOR)('can be read on the soft color of %s: in its own color, in ink and in muted', (name) => {
    for (const text of [name, 'ink', 'muted']) {
      expect(contrast(colors[text], colors[`${name}-soft`]), `${text} on ${name}-soft`).toBeGreaterThanOrEqual(TEXT);
    }
  });

  it.each(WITH_A_SOFT_COLOR)('can be read in on-fill on a solid block of %s', (name) => {
    expect(contrast(colors['on-fill'], colors[name])).toBeGreaterThanOrEqual(TEXT);
  });

  it.each(SOURCES)('show a bar of %s on its track', (name) => {
    expect(contrast(colors[name], colors.sunken)).toBeGreaterThanOrEqual(SHAPE);
  });

  it('can be read on the header, which is the same navy in both themes', () => {
    expect(colors.header).toEqual(LIGHT.header);
    for (const text of ['header-ink', 'header-muted', 'accent']) {
      expect(contrast(colors[text], colors.header), `${text} on the header`).toBeGreaterThanOrEqual(TEXT);
    }
  });

  it('show the focus ring on every ground, and on the header in the color it has there', () => {
    for (const ground of GROUNDS) {
      expect(contrast(colors.focus, colors[ground]), `the ring on ${ground}`).toBeGreaterThanOrEqual(SHAPE);
    }
    expect(contrast(ON_HEADER.focus, colors.header)).toBeGreaterThanOrEqual(SHAPE);
  });
});

describe('the stylesheet', () => {
  it('writes next to each color the hex value that its three channels are', () => {
    const written = [...stylesheet.matchAll(TOKEN)];

    expect(written.length).toBeGreaterThan(40);
    for (const [, name, r, g, b, hex] of written) {
      const channels = [r, g, b].map((channel) => Number(channel).toString(16).padStart(2, '0')).join('');
      expect(`${name} #${channels}`).toBe(`${name} ${hex}`);
    }
  });

  it('gives every color of the light theme but those of the header a value for the dark theme', () => {
    const same = ['header', 'header-ink', 'header-muted', 'accent'];
    const dark = colorsIn(darkPart.split('.on-header')[0]);

    expect(Object.keys(dark).sort()).toEqual(
      Object.keys(LIGHT)
        .filter((name) => !same.includes(name))
        .sort(),
    );
  });
});
