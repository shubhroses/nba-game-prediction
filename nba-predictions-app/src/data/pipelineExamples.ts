/**
 * The examples of pipeline/README.md, read from the document itself. It is
 * the other end of the contract that the shape checks hold the files to, so
 * the tests take its examples as they are written there and follow them
 * when they change. Only tests import this file.
 */
import readme from '../../../pipeline/README.md?raw';

const FENCE = /^```(\w*)\n([\s\S]*?)\n```$/gm;

/**
 * The examples under the heading of one file, in the order they are in. A
 * block of JSON is one example. A block without a language holds lines of a
 * file that grows by the line, and is given as the list of its lines.
 *
 * `file` is the path after the prefix, as the heading writes it:
 * `slate.json`, `results/YYYY-MM.ndjson`.
 */
export function examplesOf(file: string): unknown[] {
  const heading = `### \`{prefix}/${file}\`\n`;
  const start = readme.indexOf(heading);
  if (start < 0) throw new Error(`pipeline/README.md has no section for ${file}`);

  const rest = readme.slice(start + heading.length);
  const end = rest.search(/^#{2,3} /m);
  const section = end < 0 ? rest : rest.slice(0, end);
  return [...section.matchAll(FENCE)].map(([, language, body]) =>
    language === 'json' ? JSON.parse(body) : body.split('\n').map((line) => JSON.parse(line)),
  );
}

export type Json = Record<string, unknown>;

/** A copy of an example that a test may change. */
export function copyOf(example: unknown): Json {
  return structuredClone(example) as Json;
}
