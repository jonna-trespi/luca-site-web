#!/usr/bin/env node
/**
 * Lista o elimina archivos en public/ que no aparecen referenciados en el código
 * ni en la salida de build (dist/).
 *
 * Resuelve patrones ${baseImg}/archivo.webp cuando existe const baseImg = '/...'.
 *
 * Uso:
 *   node scripts/prune-unused-public.mjs          # solo lista (dry-run)
 *   node scripts/prune-unused-public.mjs --delete # borra archivos no usados
 *
 * Recomendación: ejecutar `npm run build` antes para tener dist/ actualizado.
 */
import { readFileSync, readdirSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const PUBLIC = join(ROOT, 'public');
const DIST = join(ROOT, 'dist');
const SRC = join(ROOT, 'src');

const DO_DELETE = process.argv.includes('--delete');

/** Normaliza rutas/URLs para comparar (macOS puede guardar ñ como NFD en el disco). */
function nfc(s) {
  return s.normalize('NFC');
}

/** @param {string} dir */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.name === '.DS_Store') continue;
    if (name.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** @param {string} dir @param {string[]} exts */
function collectText(dir, exts) {
  return walk(dir).filter((f) => exts.some((e) => f.endsWith(e)));
}

/**
 * Sustituye ${nombreVar}/ruta por la URL absoluta cuando nombreVar es un string literal conocido.
 * @param {string} content
 */
function expandKnownBases(content) {
  let out = content;
  const baseDecl =
    /(?:^|\n)\s*const\s+(\w+)\s*=\s*['"](\/(?:images|gif|videos|logos|icons)\/[^'"]*)['"]\s*;?/gm;
  /** @type {Map<string, string>} */
  const bases = new Map();
  let m;
  while ((m = baseDecl.exec(content))) {
    bases.set(m[1], m[2]);
  }
  for (const [varName, basePath] of bases) {
    const r = new RegExp(`\\$\\{${varName}\\}/([^\\}` + '`' + `"'\\$]+)`, 'g');
    out = out.replace(r, (_, sub) => nfc(basePath + sub));
  }
  return out;
}

/**
 * @param {string} text
 * @returns {Set<string>}
 */
function harvestUrls(text) {
  const set = new Set();
  const re = /\/(images|gif|videos|logos|icons)\/[a-zA-Z0-9_./\- %áéíóúñÁÉÍÓÚÑüÜ]+?\.(?:webp|gif|mp4|svg|png|jpe?g)/gi;
  let m;
  while ((m = re.exec(text))) {
    let u = nfc(m[0].replace(/[,);:\]}>'"]+$/g, ''));
    set.add(u);
    try {
      set.add(nfc(decodeURI(u)));
    } catch {
      /* ignore */
    }
  }
  return set;
}

function buildCorpus() {
  /** @type {string[]} */
  const chunks = [];
  if (existsSync(join(ROOT, 'astro.config.mjs'))) {
    chunks.push(readFileSync(join(ROOT, 'astro.config.mjs'), 'utf8'));
  }
  for (const f of collectText(SRC, [
    '.astro',
    '.ts',
    '.tsx',
    '.js',
    '.mjs',
    '.css',
    '.json',
    '.md',
    '.mdx',
  ])) {
    const raw = readFileSync(f, 'utf8');
    chunks.push(raw);
    chunks.push(expandKnownBases(raw));
  }
  if (existsSync(DIST)) {
    for (const f of collectText(DIST, ['.html', '.css', '.js', '.mjs'])) {
      chunks.push(readFileSync(f, 'utf8'));
    }
  }
  return chunks.join('\n');
}

function posixRel(abs) {
  return relative(PUBLIC, abs).split('\\').join('/');
}

function isReferenced(relPosix, corpusSet, corpusText) {
  const withSlash = nfc('/' + relPosix);
  if (corpusSet.has(withSlash)) return true;
  try {
    if (corpusSet.has(nfc(decodeURI(withSlash)))) return true;
  } catch {
    /* ignore */
  }
  const enc = encodeURI(withSlash);
  if (corpusText.includes(enc)) return true;
  if (corpusText.includes(withSlash)) return true;
  if (corpusText.includes(nfc(relPosix))) return true;

  const fileName = nfc(relPosix.split('/').pop() || '');
  if (fileName.length >= 32 && corpusText.includes(fileName)) return true;

  return false;
}

function main() {
  const corpusText = buildCorpus();
  const corpusSet = harvestUrls(corpusText);
  corpusSet.add(nfc('/favicon.svg'));

  const publicFiles = walk(PUBLIC);
  /** @type {string[]} */
  const unused = [];

  for (const abs of publicFiles) {
    const rel = posixRel(abs);
    if (!isReferenced(rel, corpusSet, corpusText)) {
      unused.push(abs);
    }
  }

  console.log(`Archivos en public/: ${publicFiles.length}`);
  console.log(`No referenciados: ${unused.length}\n`);

  for (const p of unused.sort()) {
    console.log('  ', '/' + posixRel(p));
  }

  if (DO_DELETE && unused.length) {
    let bytes = 0;
    for (const p of unused) {
      bytes += statSync(p).size;
      unlinkSync(p);
    }
    console.log(`\nEliminados ${unused.length} archivos (~${(bytes / 1024).toFixed(1)} KB).`);
  } else if (!DO_DELETE && unused.length) {
    console.log('\nDry-run. Para borrar: node scripts/prune-unused-public.mjs --delete');
  }
}

main();
