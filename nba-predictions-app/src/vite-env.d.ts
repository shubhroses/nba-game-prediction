/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Replaces the address of the published files. See src/data/fetchBoard.ts. */
  readonly VITE_DATA_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
