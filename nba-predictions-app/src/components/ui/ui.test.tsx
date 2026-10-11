/**
 * The small components that every view is built from, drawn to markup the
 * way a server would. These tests hold what a view relies on without seeing
 * it: that an option does what its name says, and that two classes of one
 * kind never end up on one element, where the order of the stylesheet would
 * settle which of them counts.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CheckIcon,
  ChevronIcon,
  Chip,
  DayPager,
  DayRail,
  Disclosure,
  MoveIcon,
  ScrollBox,
  SectionTitle,
  SourceName,
  StarIcon,
  StarMark,
  TeamBadge,
  TeamLogo,
  TextLink,
  VerdictMark,
  ViewHeader,
} from './index';

/** The classes of the first element of a piece of markup. */
function classesOf(markup: string): string[] {
  return (/class="([^"]*)"/.exec(markup)?.[1] ?? '').split(' ');
}

/** The classes that set a height or a width. */
function sizes(markup: string): string[] {
  return classesOf(markup).filter((name) => /^(?:h|w)-/.test(name));
}

describe('an icon', () => {
  it('has its usual size when no class asks for another', () => {
    expect(sizes(renderToStaticMarkup(<CheckIcon />))).toEqual(['h-5', 'w-5']);
    expect(sizes(renderToStaticMarkup(<ChevronIcon />))).toEqual(['h-4', 'w-4']);
    expect(sizes(renderToStaticMarkup(<MoveIcon up />))).toEqual(['h-2.5', 'w-2.5']);
    expect(sizes(renderToStaticMarkup(<StarIcon filled={false} />))).toEqual(['h-5', 'w-5']);
    expect(sizes(renderToStaticMarkup(<StarMark />))).toEqual(['h-4', 'w-4']);
  });

  it('has the size that its class asks for, and that size alone', () => {
    expect(sizes(renderToStaticMarkup(<CheckIcon className="h-4 w-4" />))).toEqual(['h-4', 'w-4']);
    expect(sizes(renderToStaticMarkup(<ChevronIcon className="h-5 w-5 text-muted" />))).toEqual(['h-5', 'w-5']);
    expect(sizes(renderToStaticMarkup(<StarMark className="h-3 w-3" />))).toEqual(['h-3', 'w-3']);
  });

  it('keeps its usual size next to a class that asks for something else', () => {
    expect(sizes(renderToStaticMarkup(<CheckIcon className="mt-0.5 text-win" />))).toEqual(['h-5', 'w-5']);
  });

  it('is passed over by a screen reader', () => {
    for (const icon of [<CheckIcon />, <ChevronIcon />, <MoveIcon up={false} />, <StarIcon filled />, <StarMark on="sunken" />]) {
      expect(renderToStaticMarkup(icon)).toContain('aria-hidden="true"');
    }
  });

  it('draws a followed team as a filled star and any other as an outline', () => {
    expect(renderToStaticMarkup(<StarIcon filled />)).toContain('fill="currentColor"');
    expect(renderToStaticMarkup(<StarIcon filled={false} />)).toContain('fill="none"');
  });
});

describe('SectionTitle', () => {
  it('leaves room under it, unless it stands in a bar or a row of its own', () => {
    expect(classesOf(renderToStaticMarkup(<SectionTitle>Day by day</SectionTitle>))).toContain('mb-3');
    expect(classesOf(renderToStaticMarkup(<SectionTitle flush>Day by day</SectionTitle>))).not.toContain('mb-3');
  });

  it('is an h3 under the h2 of its view, with its note and what stands at the far end of its line', () => {
    const markup = renderToStaticMarkup(
      <SectionTitle note="Picks won and lost on the games of each day." aside="All 3 days">
        Day by day
      </SectionTitle>,
    );

    expect(markup).toMatch(/<h3[^>]*>Day by day<\/h3><div[^>]*>All 3 days<\/div>/);
    expect(markup).toContain('Picks won and lost on the games of each day.</p>');
  });
});

describe('ViewHeader', () => {
  it('has the heading of the view, what it shows, and a smaller line for what is true of it right now', () => {
    const markup = renderToStaticMarkup(
      <ViewHeader title="Record" note="143 games since Tue, Oct 20.">
        How the picks have done.
      </ViewHeader>,
    );

    expect(markup).toMatch(/<h2[^>]*>Record<\/h2><p[^>]*>How the picks have done\.<\/p><p[^>]*>143 games since Tue, Oct 20\.<\/p>/);
    expect(renderToStaticMarkup(<ViewHeader title="Record">How the picks have done.</ViewHeader>).match(/<p/g)).toHaveLength(1);
  });
});

describe('ViewHeader for a view whose first screen on a phone belongs to what it shows', () => {
  const markup = renderToStaticMarkup(
    <ViewHeader title="Games" note="No pick has been graded yet." wideOnly>
      Ratings include every result on record.
    </ViewHeader>,
  );

  it('keeps the heading for a screen reader below 640px, and shows it from there on', () => {
    expect(markup).toMatch(/<h2 class="[^"]*\bsr-only sm:not-sr-only\b[^"]*">Games<\/h2>/);
  });

  it('leaves its sentences out below 640px, where the view writes them further down', () => {
    const sentences = [...markup.matchAll(/<p class="([^"]*)"/g)].map((match) => match[1].split(' '));

    expect(sentences).toHaveLength(2);
    for (const names of sentences) expect(names).toEqual(expect.arrayContaining(['hidden', 'sm:block']));
  });

  it('shows everything at every width when it is not asked to', () => {
    const usual = renderToStaticMarkup(<ViewHeader title="Record">How the picks have done.</ViewHeader>);

    expect(usual).not.toContain('sr-only');
    expect(usual).not.toContain('hidden');
  });
});

describe('SourceName', () => {
  it('names the source next to a dot in its color, on one line', () => {
    const markup = renderToStaticMarkup(<SourceName source="points_rest" />);

    expect(markup).toContain('bg-pr');
    expect(markup).toContain('Points &amp; Rest');
    expect(classesOf(markup)).toContain('whitespace-nowrap');
    expect(classesOf(markup)).toContain('font-medium');
  });

  it('is heavier as a title, with one weight and not two', () => {
    const names = classesOf(renderToStaticMarkup(<SourceName source="elo" strong />));

    expect(names.filter((name) => name.startsWith('font-'))).toEqual(['font-semibold']);
  });

  it('may run on to a second line where it is asked to, and breaks before the "&" then', () => {
    const markup = renderToStaticMarkup(<SourceName source="points_rest" wrap />);

    expect(classesOf(markup)).not.toContain('whitespace-nowrap');
    expect(markup).toContain('Points &amp; Rest');
  });
});

describe('VerdictMark', () => {
  it('says what became of a forecast in words next to its mark', () => {
    expect(renderToStaticMarkup(<VerdictMark verdict="favorite_won" />)).toMatch(/<span class="">Right<\/span>/);
    expect(renderToStaticMarkup(<VerdictMark verdict="not_graded" tooLate />)).toContain('Too late to count');
  });

  it('leaves the words to a screen reader when it is compact, and says them to whoever points at it', () => {
    const markup = renderToStaticMarkup(<VerdictMark verdict="upset" compact />);

    expect(markup).toContain('title="Wrong"');
    expect(markup).toContain('<span class="sr-only">Wrong</span>');
  });

  it('shows the words from a wide screen on when it is compact below that', () => {
    const markup = renderToStaticMarkup(<VerdictMark verdict="toss_up" compact="below-lg" />);

    expect(markup).toContain('<span class="sr-only lg:not-sr-only">No pick</span>');
    expect(markup).not.toContain('title=');
  });

  it('draws its mark at 16px, and not at the usual size of an icon as well', () => {
    const mark = /<svg[^>]*>/.exec(renderToStaticMarkup(<VerdictMark verdict="favorite_won" />))?.[0] ?? '';

    expect(sizes(mark)).toEqual(['h-4', 'w-4']);
  });
});

describe('TeamLogo and TeamBadge', () => {
  it('draw the logo on a disc that a screen reader passes over, because the name stands next to it', () => {
    const logo = renderToStaticMarkup(<TeamLogo team="DET" size="sm" />);

    expect(logo).toMatch(/^<span aria-hidden="true"/);
    expect(logo).toContain('alt=""');
    expect(logo).toContain('cdn.nba.com');
  });

  it('write the code or the full name next to the logo', () => {
    expect(renderToStaticMarkup(<TeamBadge team="DET" />)).toMatch(/>DET<\/span><\/span>$/);
    expect(renderToStaticMarkup(<TeamBadge team="DET" label="name" />)).toMatch(/>Detroit Pistons<\/span><\/span>$/);
  });

  it('draw initials for a team that has no logo', () => {
    const logo = renderToStaticMarkup(<TeamLogo team="SEA" />);

    expect(logo).not.toContain('<img');
    expect(logo).toContain('>SEA</span>');
  });
});

describe('TextLink', () => {
  it('is underlined, in the color of the text, and keeps the height of its line', () => {
    const names = classesOf(renderToStaticMarkup(<TextLink href="#/record">the record</TextLink>));

    expect(names).toEqual(expect.arrayContaining(['underline', 'text-ink']));
    expect(names).not.toContain('min-h-10');
  });

  it('is at least 40px high and wide when it stands by itself', () => {
    const markup = renderToStaticMarkup(
      <TextLink href="#/record" standalone>
        Data
      </TextLink>,
    );

    expect(markup).toMatch(/^<a href="#\/record"/);
    expect(classesOf(markup)).toEqual(expect.arrayContaining(['inline-flex', 'min-h-10', 'min-w-10']));
  });
});

describe('Disclosure', () => {
  const markup = renderToStaticMarkup(
    <Disclosure summary="How these numbers are made" className="border-t" summaryClassName="px-4">
      <p>Each percentage is a chance.</p>
    </Disclosure>,
  );

  it('is a details element, which opens without a script', () => {
    expect(markup).toMatch(/^<details class="group border-t"><summary /);
    expect(markup).toMatch(/<\/summary><p>Each percentage is a chance\.<\/p><\/details>$/);
  });

  it('has its words and an arrowhead on a line that is 40px high', () => {
    expect(markup).toMatch(/<span class="flex min-h-10 [^"]*"><span class="min-w-0">How these numbers are made<\/span><svg /);
    expect(markup).toContain('group-open:rotate-90');
  });
});

describe('DayRail and DayPager', () => {
  const days = [
    { key: '2026-11-08', label: 'Today', note: '7 games', href: '#/games/2026-11-08', selected: true },
    { key: '2026-11-09', label: 'Tomorrow', note: '0 games', href: '#/games/2026-11-09', selected: false, quiet: true },
  ];

  it('link every day and mark the one that is shown', () => {
    const markup = renderToStaticMarkup(<DayRail days={days} />);

    expect(markup).toMatch(/^<nav aria-label="Days"/);
    expect(markup).toContain('<a href="#/games/2026-11-08" aria-current="true"');
    expect(markup).toMatch(/<a href="#\/games\/2026-11-09" class="[^"]*text-muted[^"]*">/);
    expect(markup.match(/aria-current/g)).toHaveLength(1);
  });

  it('mark the day that is shown by more than its colors, which a theme of forced colors takes away', () => {
    const markup = renderToStaticMarkup(<DayRail days={days} />);
    const [shown, other] = [...markup.matchAll(/<a href="[^"]*"(?: aria-current="true")? class="([^"]*)"><span class="([^"]*)"/g)];

    expect(shown[1]).toContain('forced-colors:border-[3px]');
    expect(shown[2]).toContain('forced-colors:underline');
    expect(`${other[1]} ${other[2]}`).not.toContain('forced-colors:');
  });

  it('bring a day into the row inside the padding at its sides, where its focus ring has room', () => {
    expect(renderToStaticMarkup(<DayRail days={days} />)).toMatch(/<ul class="[^"]*\bscroll-px-gutter\b[^"]*\bpx-gutter\b/);
  });

  it('lead to the day before on the left and to the day after on the right, and say which is which', () => {
    const markup = renderToStaticMarkup(<DayPager before={days[0]} after={days[1]} />);

    expect(markup).toMatch(/^<nav aria-label="The day before and the day after"/);
    expect(markup.indexOf('The day before: ')).toBeLessThan(markup.indexOf('The day after: '));
    expect(markup.indexOf('#/games/2026-11-08')).toBeLessThan(markup.indexOf('#/games/2026-11-09'));
  });

  it('draw nothing where there is no day to lead to', () => {
    expect(renderToStaticMarkup(<DayPager before={null} after={null} />)).toBe('');
    expect(renderToStaticMarkup(<DayPager before={null} after={days[1]} />)).not.toContain('The day before: ');
  });
});

describe('ScrollBox', () => {
  it('is the frame of what is in it, and no stop for the Tab key until it is seen to scroll', () => {
    const markup = renderToStaticMarkup(
      <ScrollBox label="The record day by day">
        <table />
      </ScrollBox>,
    );

    expect(classesOf(markup)).toEqual(expect.arrayContaining(['relative', 'overflow-x-auto']));
    expect(markup).not.toContain('tabindex');
    expect(markup).not.toContain('role=');
  });
});

describe('Chip', () => {
  it('has one shape in every tone', () => {
    const shape = (markup: string) => classesOf(markup).filter((name) => /^(?:rounded|px|py|text-xs|font)/.test(name));

    expect(shape(renderToStaticMarkup(<Chip>Upset</Chip>))).toEqual(shape(renderToStaticMarkup(<Chip tone="warn">Different picks</Chip>)));
    expect(classesOf(renderToStaticMarkup(<Chip tone="warn">Different picks</Chip>))).toEqual(expect.arrayContaining(['bg-warn-soft', 'text-warn']));
    expect(classesOf(renderToStaticMarkup(<Chip tone="quiet">Toss-up</Chip>))).toContain('text-muted');
  });
});
