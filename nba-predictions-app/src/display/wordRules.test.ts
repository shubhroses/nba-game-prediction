import { describe, expect, it } from 'vitest';
import { unwantedWords } from './wordRules';

describe('unwantedWords', () => {
  it('finds nothing in the words that the page uses', () => {
    expect(unwantedWords('Points & Rest and Elo pick Cleveland, the sportsbooks pick Portland.')).toEqual([]);
    expect(unwantedWords('A pick is the side that a source puts at 52% or more.')).toEqual([]);
    expect(unwantedWords("A team's rating is how many points better than an average team it is.")).toEqual([]);
    expect(unwantedWords('The 95% interval includes zero, so the two cannot be told apart.')).toEqual([]);
  });

  it.each([
    ['A lock for tonight', ['lock']],
    ['The best bet of the day', ['best bet', 'bet']],
    ['Where the value is', ['value']],
    ['An edge over the line', ['edge']],
    ['What the sharps do', ['sharps']],
    ['A guaranteed winner', ['guaranteed']],
    ['Elo beats the sportsbooks', ['beats']],
    ['Its chances were better than the sportsbooks', ['better than the sportsbooks']],
    ['It picks more winners than the sportsbooks', ['more winners than the sportsbooks']],
    ['What the bookmakers say in Vegas', ['bookmakers', 'Vegas']],
    ['An AI built on machine learning and an algorithm', ['AI', 'machine learning', 'algorithm']],
    ['A win probability with a confidence interval', ['probability', 'confidence']],
    ['Not betting advice', ['betting']],
  ])('finds what "%s" should not say', (text, found) => {
    expect(unwantedWords(text)).toEqual(found);
  });

  it('does not take a part of a word for one of them', () => {
    expect(unwantedWords('The Trail Blazers were evaluated in a block of games against the Kings.')).toEqual([]);
    expect(unwantedWords('Said plainly.')).toEqual([]);
  });
});
