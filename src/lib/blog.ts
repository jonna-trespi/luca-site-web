import { parse } from 'csv-parse/sync';
import sanitizeHtml from 'sanitize-html';
import rawCsv from '../data/blog-posts.csv?raw';

const ROW_KEYS = {
  name: 'Name',
  slug: 'Slug',
  createdOn: 'Created On',
  updatedOn: 'Updated On',
  publishedOn: 'Published On',
  postBody: 'Post Body',
  postSummary: 'Post Summary',
  mainImage: 'Main Image',
  thumbnail: 'Thumbnail image',
  identification: 'Identification',
  publishedDate: 'Published date',
  url: 'Url',
  category: 'Category',
  mainImageAlt: 'Main image alt text',
  authorEmail: 'Author email',
  authorFirstName: 'Author first name',
  authorLastName: 'Author last name',
  authorPhotoUrl: 'Author photo url',
} as const;

function cell(row: Record<string, string>, key: keyof typeof ROW_KEYS): string {
  return (row[ROW_KEYS[key]] ?? '').trim();
}

function parsePublishedAt(row: Record<string, string>): Date | null {
  const raw = cell(row, 'publishedDate') || cell(row, 'publishedOn');
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
  ],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ['href', 'name', 'target', 'rel', 'id', 'class'],
    img: ['src', 'alt', 'width', 'height', 'class', 'id', 'loading', 'decoding'],
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
  publishedAt: Date | null;
  dateLabel: string;
}

function rowToPost(row: Record<string, string>): BlogPost | null {
  const slug = cell(row, 'slug');
  const name = cell(row, 'name');
  if (!slug || !name) return null;

  const publishedAt = parsePublishedAt(row);
  const publishedDateRaw = cell(row, 'publishedDate') || cell(row, 'publishedOn');

  return {
    slug,
    name,
    createdOn: cell(row, 'createdOn'),
    updatedOn: cell(row, 'updatedOn'),
    publishedOn: cell(row, 'publishedOn'),
    bodyHtml: sanitizeBody(cell(row, 'postBody')),
    summary: cell(row, 'postSummary'),
    mainImage: cell(row, 'mainImage'),
    thumbnail: cell(row, 'thumbnail'),
    identification: cell(row, 'identification'),
    publishedDateRaw,
    url: cell(row, 'url'),
    category: cell(row, 'category'),
    mainImageAlt: cell(row, 'mainImageAlt'),
    authorEmail: cell(row, 'authorEmail'),
    authorFirstName: cell(row, 'authorFirstName'),
    authorLastName: cell(row, 'authorLastName'),
    authorPhotoUrl: cell(row, 'authorPhotoUrl'),
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
  }) as Record<string, string>[];

  const posts: BlogPost[] = [];
  for (const row of records) {
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
