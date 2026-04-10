/// <reference path="../.astro/types.d.ts" />

declare module '*.csv?raw' {
  const content: string;
  export default content;
}
