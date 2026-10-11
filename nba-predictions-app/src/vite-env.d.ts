/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Replaces the address of the published files. See src/data/published.ts. */
  readonly VITE_DATA_BASE_URL?: string;
  /** Fixes the page's clock at a UTC time, to preview sample data. See src/data/clock.ts. */
  readonly VITE_DATA_NOW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
