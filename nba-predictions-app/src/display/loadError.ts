import type { LoadError } from '../data/published';

/**
 * One sentence that says why a published file is not on the page. `what`
 * names the file as a visitor would, with its article and a capital: "The
 * record", "The games".
 */
export function explainLoadError(what: string, error: LoadError): string {
  switch (error.kind) {
    case 'network':
      return `${what} could not be loaded: the server that holds the files could not be reached.`;
    case 'http':
      return `${what} could not be loaded: the server that holds the files answered with HTTP ${error.status}.`;
    case 'shape':
      return `${what} arrived in a form this page cannot read.`;
  }
}
