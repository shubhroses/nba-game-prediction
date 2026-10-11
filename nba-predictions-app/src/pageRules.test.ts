import { describe, expect, it } from 'vitest';
import page from '../index.html?raw';
import tailwind from '../tailwind.config.js?raw';

/**
 * The files that only tests import: the two that hand them what is kept outside src, which are the examples of
 * the documentation and the sample data, the small records that the tests of the record view are built from,
 * and the list of words that the page does without.
 */
const FOR_TESTS = ['pipelineExamples', 'sampleData', 'recordExamples', 'wordRules'];

/**
 * Every source file of the page, as text. The tests are left out, and the
 * files that only they import: they may quote what the page must not contain.
 */
const SOURCES = Object.entries(
  import.meta.glob<string>('./**/*.{ts,tsx,css}', { query: '?raw', import: 'default', eager: true }),
).filter(([path]) => !path.includes('.test.') && !FOR_TESTS.some((name) => path.endsWith(`/${name}.ts`)));

/** The files in which the pattern is found, each with what was found there. */
function found(pattern: RegExp): string[] {
  return SOURCES.flatMap(([path, text]) => [...text.matchAll(pattern)].map((match) => `${path}: ${match[0]}`));
}

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black';
const COLORED = 'bg|text|border|ring|ring-offset|outline|divide|decoration|fill|stroke|from|via|to|shadow|accent|caret|placeholder';

describe('the source of the page', () => {
  it('is read by these tests', () => {
    const paths = SOURCES.map(([path]) => path);

    expect(paths).toContain('./App.tsx');
    expect(paths).toContain('./index.css');
    expect(paths).toContain('./components/ui/LeanBar.tsx');
    expect(paths.some((path) => path.includes('.test.'))).toBe(false);
  });

  it('imports none of the files that are for tests only, which would be built into the page', () => {
    expect(found(new RegExp(`from '[^']*/(?:${FOR_TESTS.join('|')})'`, 'g'))).toEqual([]);
  });

  it('takes its colors from the tokens, so that every one of them has a value in both themes', () => {
    // tailwind.config.js has taken the palette of Tailwind out, so a class such as bg-gray-100 would do nothing.
    expect(found(new RegExp(`\\b(?:${COLORED})-(?:${PALETTE})(?:-\\d{2,3})?\\b(?![-\\w])`, 'g'))).toEqual([]);
    // A color written out in a class, as in bg-[#fff], has one value for both themes.
    expect(found(/\[(?:color:)?#[0-9a-fA-F]{3,8}\]/g)).toEqual([]);
  });

  it('writes no dark: variant, because the tokens follow the theme by themselves', () => {
    expect(found(/\bdark:[\w[-]/g)).toEqual([]);
  });

  it('puts no markup on the page as text, which the Content-Security-Policy is there to stop', () => {
    expect(found(/dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write/g)).toEqual([]);
  });

  it('reads the clock in two places only, so that a build with VITE_DATA_NOW shows one moment everywhere', () => {
    // A view is handed the time as `now`. One that asked the clock itself would show today's date over sample data.
    const readers = found(/\bDate\.now\(\)|\bnew Date\(\s*\)/g).map((entry) => entry.replace(/: .*$/, ''));

    expect([...new Set(readers)].sort()).toEqual(['./hooks/useBoard.ts', './hooks/useNow.ts']);
  });

  it('keeps whatever takes the focus in the content clear of the tabs, and gives the page no padding for scrolling', () => {
    const stylesheet = SOURCES.find(([path]) => path === './index.css')?.[1] ?? '';

    expect(stylesheet).toMatch(
      /main :where\(a, button, summary, select, input, textarea, \[tabindex\]\) \{\s*scroll-margin-top: theme\('spacing\.below-tabs'\);/,
    );
    // A padding of the page would count for the tabs as well, which stay at the top: the page would move by a
    // good part of a screen whenever the focus went from one tab to the next.
    expect(stylesheet).not.toMatch(/scroll-padding/);
    expect(found(/\bscroll-p[tby]?-/g)).toEqual([]);
  });

  it('styles a control under the pointer only where a pointer can rest over one', () => {
    // On a touch screen the style would stay on a control after a tap.
    expect(tailwind).toMatch(/future: \{\s*hoverOnlyWhenSupported: true,\s*\}/);
  });

  it('calls none of three functions that browsers of before March 2022 do not have', () => {
    // The build lowers the syntax for those browsers and not these calls. One of them inside a shape check left
    // four of the five views without their file.
    expect(found(/\bObject\.hasOwn\(|\.at\(-?\d+\)|\.findLast(?:Index)?\(/g)).toEqual([]);
  });

  it('does not name the host of the odds provider or carry a key, which the build is searched for', () => {
    // The two texts are put together here, so that this file does not hold them either.
    const host = ['the', 'odds', 'api'].join('-');
    const key = ['api', 'Key='].join('');

    expect(found(new RegExp(`${host}|${key}`, 'gi'))).toEqual([]);
  });
});

describe('index.html', () => {
  it('has no inline style and no inline script, which the Content-Security-Policy would refuse', () => {
    expect(page).not.toMatch(/<style[\s>]/i);
    expect(page).not.toMatch(/\sstyle\s*=/i);
    expect(page).not.toMatch(/\son[a-z]+\s*=/i);
    expect([...page.matchAll(/<script\b[^>]*>/gi)].map(([tag]) => tag)).toEqual(['<script type="module" src="/src/main.tsx">']);
  });

  it('loads nothing from another host', () => {
    expect(page).not.toMatch(/(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i);
  });
});
