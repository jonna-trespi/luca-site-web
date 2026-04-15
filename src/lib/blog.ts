import { parse } from 'csv-parse/sync';
import sanitizeHtml from 'sanitize-html';
import rawCsv from '../data/Luca blog posts 1-50 - blog-posts.csv?raw';

/** Quita BOM y espacios en nombres de columna del CSV. */
function normalizeRow(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = k.replace(/^\ufeff/, '').trim();
    out[key] = typeof v === 'string' ? v : String(v ?? '');
  }
  return out;
}

/** Prueba varias cabeceras posibles (export viejos vs nuevos de WordPress/HubSpot). */
function pick(row: Record<string, string>, ...aliases: string[]): string {
  for (const key of aliases) {
    const v = row[key];
    if (v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function parsePublishedAtRaw(raw: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dateFormatter = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function formatDateLabel(d: Date | null): string {
  if (!d) return '';
  return dateFormatter.format(d);
}

const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'img',
    'figure',
    'figcaption',
    'span',
    'div',
    'mark',
    'center',
  ],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ['href', 'name', 'target', 'rel', 'id', 'class'],
    img: ['src', 'alt', 'width', 'height', 'class', 'id', 'loading', 'decoding'],
    mark: ['style', 'class'],
    '*': ['class', 'id'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
};

function sanitizeBody(html: string): string {
  if (!html) return '';
  return sanitizeHtml(html, sanitizeOptions);
}

export interface BlogPost {
  slug: string;
  name: string;
  createdOn: string;
  updatedOn: string;
  publishedOn: string;
  bodyHtml: string;
  summary: string;
  mainImage: string;
  thumbnail: string;
  identification: string;
  publishedDateRaw: string;
  url: string;
  category: string;
  mainImageAlt: string;
  authorEmail: string;
  authorFirstName: string;
  authorLastName: string;
  authorPhotoUrl: string;
  /** Nombre completo si el CSV trae una sola columna «Author». */
  authorName: string;
  publishedAt: Date | null;
  dateLabel: string;
}

function rowToPost(row: Record<string, string>): BlogPost | null {
  const slug = pick(row, 'Slug');
  const name = pick(row, 'Name');
  if (!slug || !name) return null;

  const postBody = pick(row, 'Post Body', 'Post body');
  const postSummary = pick(row, 'Post Summary', 'Post summary');
  const mainImage = pick(row, 'Main Image', 'Main image');
  const mainImageAlt = pick(row, 'Main image alt text', 'Main image alt');
  const thumbnail = pick(row, 'Thumbnail image', 'Thumbnail Image');
  const publishedDateRaw = pick(row, 'Published date', 'Published On', 'Published on');
  const publishedAt = parsePublishedAtRaw(publishedDateRaw);

  const authorFirst = pick(row, 'Author first name');
  const authorLast = pick(row, 'Author last name');
  const authorSingle = pick(row, 'Author');
  const authorName =
    authorSingle || [authorFirst, authorLast].filter(Boolean).join(' ').trim();

  return {
    slug,
    name,
    createdOn: pick(row, 'Created On'),
    updatedOn: pick(row, 'Updated On'),
    publishedOn: pick(row, 'Published On'),
    bodyHtml: sanitizeBody(postBody),
    summary: postSummary,
    mainImage,
    thumbnail,
    identification: pick(row, 'Identification'),
    publishedDateRaw,
    url: pick(row, 'Url'),
    category: pick(row, 'Category'),
    mainImageAlt,
    authorEmail: pick(row, 'Author email'),
    authorFirstName: authorFirst,
    authorLastName: authorLast,
    authorPhotoUrl: pick(row, 'Author photo url'),
    authorName,
    publishedAt,
    dateLabel: formatDateLabel(publishedAt),
  };
}

let cached: BlogPost[] | null = null;

function loadRawPosts(): BlogPost[] {
  const records = parse(rawCsv, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];

  const posts: BlogPost[] = [];
  for (const raw of records) {
    const row = normalizeRow(raw);
    const p = rowToPost(row);
    if (p) posts.push(p);
  }

  posts.sort((a, b) => {
    const ta = a.publishedAt?.getTime() ?? 0;
    const tb = b.publishedAt?.getTime() ?? 0;
    return tb - ta;
  });

  return posts;
}

export function getAllPosts(): BlogPost[] {
  if (!cached) cached = loadRawPosts();
  return cached;
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return getAllPosts().find((p) => p.slug === slug);
}

export function getCategoryList(): string[] {
  const set = new Set<string>();
  for (const p of getAllPosts()) {
    if (p.category) set.add(p.category);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'es'));
}

/** Solo misma categoría que el artículo actual (excluye el slug dado). */
export function getRelatedPosts(slug: string, category: string, limit = 3): BlogPost[] {
  if (!category) return [];
  return getAllPosts()
    .filter((p) => p.slug !== slug && p.category === category)
    .slice(0, limit);
}
