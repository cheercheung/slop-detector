declare const __GPTZERO_PROXY_URL__: string;
export const GPTZERO_PROXY_URL =
  typeof __GPTZERO_PROXY_URL__ === 'string' ? __GPTZERO_PROXY_URL__ : '';
export const GPTZERO_PROXY_ORIGIN = GPTZERO_PROXY_URL
  ? `${new URL(GPTZERO_PROXY_URL).origin}/*`
  : '';
export const GPTZERO_API_ORIGIN = 'https://api.gptzero.me/*';
