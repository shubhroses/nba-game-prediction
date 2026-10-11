/** Joins class names and leaves out what is not one, so that a class can depend on a condition. */
export function classes(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}
