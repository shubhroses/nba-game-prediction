/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ODDS_API_KEY: string;
  // Add other env variables as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
} 