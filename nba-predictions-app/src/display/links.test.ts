import { describe, expect, it } from 'vitest';
// The two documents that the page links to, read as text.
import readme from '../../../pipeline/model/README.md?raw';
import jobReadme from '../../../pipeline/README.md?raw';
// The document of the repository, which gives the credit that the page repeats.
import rootReadme from '../../../README.md?raw';
import { LINKS, REPOSITORY } from './links';

describe('the links out of the page', () => {
  it('lead to the repository, to its two documents and to its data branch', () => {
    expect(LINKS.repository).toBe(REPOSITORY);
    expect(LINKS.models).toBe(`${REPOSITORY}/blob/main/pipeline/model/README.md`);
    expect(LINKS.job).toBe(`${REPOSITORY}/blob/main/pipeline/README.md`);
    expect(jobReadme).toContain(`[\`data\` branch](${LINKS.data})`);
  });

  it('lead to the license that the document of the models names for the ratings of FiveThirtyEight', () => {
    expect(readme).toContain(`[Creative Commons Attribution 4.0 International License](${LINKS.license})`);
  });

  it('lead to the data of FiveThirtyEight that the repository credits, as its license asks where it can be done', () => {
    expect(rootReadme).toContain(`[NBA forecasts data](${LINKS.fiveThirtyEight})`);
    expect(rootReadme).toContain(`published under the [Creative Commons Attribution 4.0 International License](${LINKS.license})`);
  });
});
