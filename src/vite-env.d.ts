/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the AWS backend (API Gateway), e.g. https://abc.execute-api.us-east-1.amazonaws.com */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
