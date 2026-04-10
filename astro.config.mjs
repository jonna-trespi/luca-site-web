import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  // URL canónica del sitio en producción (Open Graph, canonical). Ajusta si el dominio definitivo es otro.
  site: 'https://www.lucaedu.com',
});
