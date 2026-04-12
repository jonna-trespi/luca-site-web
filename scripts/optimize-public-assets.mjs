#!/usr/bin/env node
/**
 * Optimiza public/: JPG/JPEG/PNG → WebP, GIF → WebP animado, MP4 reencode H.264.
 * Actualiza rutas en src/ (URLs completas y nombres de archivo).
 *
 * Uso: node scripts/optimize-public-assets.mjs
 */
import sharp from 'sharp';
import ffmpegPath from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import {
  readdir,
  readFile,
  writeFile,
  unlink,
  rename,
  stat,
} from 'node:fs/promises';
import { existsSync, statSync, unlinkSync, renameSync } from 'node:fs';
import { join, extname, relative, basename } from 'node:path';

const ROOT = process.cwd();
const PUBLIC = join(ROOT, 'public');
const SRC = join(ROOT, 'src');

/** @type {{ from: string; to: string }[]} */
const urlReplacements = [];

/** @type {Map<string, number>} */
let basenameCounts = new Map();

function toPublicUrl(absPath) {
  return '/' + relative(PUBLIC, absPath).split('\\').join('/');
}

function countBasenames(files) {
  const m = new Map();
  for (const f of files) {
    const b = basename(f);
    m.set(b, (m.get(b) || 0) + 1);
  }
  return m;
}

function pushReplacement(oldAbs, newAbs) {
  urlReplacements.push({ from: toPublicUrl(oldAbs), to: toPublicUrl(newAbs) });
  const bf = basename(oldAbs);
  const bt = basename(newAbs);
  if (bf !== bt && (basenameCounts.get(bf) || 0) === 1) {
    urlReplacements.push({ from: bf, to: bt });
  }
}

async function walkFiles(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      out.push(...(await walkFiles(p)));
    } else {
      out.push(p);
    }
  }
  return out;
}

async function walkSrcFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkSrcFiles(p)));
    } else if (/\.(astro|ts|tsx|js|mjs|css|json|md|mdx)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

async function convertRasterToWebp(oldAbs) {
  const ext = extname(oldAbs).toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(ext)) return;

  const newAbs = oldAbs.replace(/\.(jpg|jpeg|png)$/i, '.webp');
  const tmp = newAbs + '.tmp.webp';

  const input = sharp(oldAbs, { failOn: 'none', limitInputPixels: false });
  const meta = await input.metadata();

  if (ext === '.png') {
    const hasAlpha = meta.hasAlpha === true;
    await input
      .webp({
        effort: 6,
        smartSubsample: true,
        ...(hasAlpha
          ? { alphaQuality: 100, quality: 96, nearLossless: true }
          : { quality: 94, nearLossless: true }),
      })
      .toFile(tmp);
  } else {
    await input.webp({ effort: 6, quality: 92, smartSubsample: true }).toFile(tmp);
  }

  const before = (await stat(oldAbs)).size;
  const after = (await stat(tmp)).size;
  await unlink(oldAbs);
  await rename(tmp, newAbs);

  pushReplacement(oldAbs, newAbs);
  console.log(
    `IMG  ${(before / 1024).toFixed(1)}KB → ${(after / 1024).toFixed(1)}KB  ${toPublicUrl(newAbs)}`,
  );
}

async function convertGifToWebp(oldAbs) {
  if (extname(oldAbs).toLowerCase() !== '.gif') return;

  const newAbs = oldAbs.replace(/\.gif$/i, '.webp');
  const tmp = newAbs + '.tmp.webp';

  try {
    await sharp(oldAbs, {
      animated: true,
      pages: -1,
      limitInputPixels: false,
      failOn: 'none',
    })
      .webp({ effort: 6, quality: 86, smartSubsample: true })
      .toFile(tmp);
  } catch (e) {
    console.warn(`GIF skip: ${toPublicUrl(oldAbs)} — ${e.message}`);
    try {
      await unlink(tmp);
    } catch {}
    return;
  }

  const before = (await stat(oldAbs)).size;
  const after = (await stat(tmp)).size;
  // WebP animado a veces pesa más que GIF pequeño: conservar GIF si no mejora
  if (after >= before * 0.98) {
    await unlink(tmp);
    console.log(`GIF  (sin cambio, WebP ≥ GIF)  ${toPublicUrl(oldAbs)}`);
    return;
  }

  await unlink(oldAbs);
  await rename(tmp, newAbs);

  pushReplacement(oldAbs, newAbs);
  console.log(
    `GIF  ${(before / 1024).toFixed(1)}KB → ${(after / 1024).toFixed(1)}KB  ${toPublicUrl(newAbs)}`,
  );
}

function optimizeMp4(absPath) {
  if (!ffmpegPath) {
    console.warn('ffmpeg-static no disponible; se omiten MP4.');
    return;
  }
  if (extname(absPath).toLowerCase() !== '.mp4') return;

  const tmp = absPath + '.opt.mp4';

  const run = (args) => {
    execFileSync(ffmpegPath, args, { stdio: 'pipe' });
  };

  const withAudio = () =>
    run([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      absPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-crf',
      '20',
      '-preset',
      'slow',
      '-movflags',
      '+faststart',
      '-c:a',
      'copy',
      tmp,
    ]);

  const videoOnly = () =>
    run([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      absPath,
      '-map',
      '0:v:0',
      '-c:v',
      'libx264',
      '-crf',
      '20',
      '-preset',
      'slow',
      '-movflags',
      '+faststart',
      '-an',
      tmp,
    ]);

  try {
    try {
      withAudio();
    } catch {
      if (existsSync(tmp)) unlinkSync(tmp);
      videoOnly();
    }
  } catch (e) {
    console.warn(`MP4 skip: ${toPublicUrl(absPath)} — ${String(e.message || e)}`);
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {}
    return;
  }

  const before = statSync(absPath).size;
  const after = statSync(tmp).size;
  if (after < before * 0.995 || after <= before - 20 * 1024) {
    unlinkSync(absPath);
    renameSync(tmp, absPath);
    console.log(
      `MP4  ${(before / 1024).toFixed(1)}KB → ${(after / 1024).toFixed(1)}KB  ${toPublicUrl(absPath)}`,
    );
  } else {
    try {
      unlinkSync(tmp);
    } catch {}
    console.log(`MP4  (sin cambio de tamaño)  ${toPublicUrl(absPath)}`);
  }
}

function dedupeReplacements(list) {
  const seen = new Set();
  const out = [];
  for (const r of list) {
    const k = `${r.from}>>>${r.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out.sort((a, b) => b.from.length - a.from.length);
}

async function applyUrlReplacements(list) {
  const reps = dedupeReplacements(list);
  const files = await walkSrcFiles(SRC);
  let n = 0;
  for (const file of files) {
    let text = await readFile(file, 'utf8');
    const orig = text;
    for (const { from, to } of reps) {
      if (text.includes(from)) text = text.split(from).join(to);
    }
    if (text !== orig) {
      await writeFile(file, text, 'utf8');
      n++;
    }
  }
  console.log(`\nReferencias actualizadas en ${n} archivos bajo src/`);
}

async function main() {
  console.log('Optimizando public/ …\n');
  const files = await walkFiles(PUBLIC);

  const rasters = files.filter((f) => /\.(jpg|jpeg|png)$/i.test(f));
  const gifs = files.filter((f) => /\.gif$/i.test(f));
  const mp4s = files.filter((f) => /\.mp4$/i.test(f));

  basenameCounts = countBasenames([...rasters, ...gifs]);

  for (const f of rasters) {
    await convertRasterToWebp(f);
  }
  for (const f of gifs) {
    await convertGifToWebp(f);
  }
  if (ffmpegPath) {
    for (const f of mp4s) {
      optimizeMp4(f);
    }
  } else {
    console.warn('ffmpeg-static: ruta nula, se omiten MP4.');
  }

  const reps = dedupeReplacements(urlReplacements);
  await writeFile(
    join(ROOT, 'scripts', 'optimize-public-assets.manifest.json'),
    JSON.stringify({ replaced: reps }, null, 2),
    'utf8',
  );

  await applyUrlReplacements(reps);
  console.log('\nManifiesto: scripts/optimize-public-assets.manifest.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
