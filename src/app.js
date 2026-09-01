import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stmts, toProduct, ftsQuery } from './db.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const productSummarySchema = {
  type: 'object',
  properties: {
    barcode: { type: 'string' },
    name: { type: ['string', 'null'] },
    brand: { type: ['string', 'null'] },
    brands: { type: 'array', items: { type: 'string' } },
    quantity: { type: ['string', 'null'] },
    categories: { type: 'array', items: { type: 'string' } },
    image_url: { type: ['string', 'null'] },
    image_small_url: { type: ['string', 'null'] },
    nutriscore: { type: ['string', 'null'] },
    nova_group: { type: ['integer', 'null'] },
    source: { type: 'string' },
    updated_at: { type: 'integer' },
  },
};

const productFullSchema = {
  type: 'object',
  properties: {
    ...productSummarySchema.properties,
    categories_tags: { type: 'array', items: { type: 'string' } },
    nutriments: { type: ['object', 'null'], additionalProperties: { type: 'number' } },
    ingredients_tags: { type: 'array', items: { type: 'string' } },
    countries_tags: { type: 'array', items: { type: 'string' } },
    lang: { type: ['string', 'null'] },
    completeness: { type: ['number', 'null'] },
    scans: { type: 'integer' },
    source_updated_at: { type: ['integer', 'null'] },
  },
};

const paginationProps = {
  page: { type: 'integer', minimum: 1, default: 1 },
  per_page: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
};

const listResponse = (itemSchema) => ({
  type: 'object',
  properties: {
    total: { type: 'integer' },
    page: { type: 'integer' },
    per_page: { type: 'integer' },
    total_pages: { type: 'integer' },
    items: { type: 'array', items: itemSchema },
  },
});

const errorSchema = {
  type: 'object',
  properties: {
    statusCode: { type: 'integer' },
    error: { type: 'string' },
    message: { type: 'string' },
  },
};

function paginate(query) {
  const page = query.page ?? 1;
  const perPage = query.per_page ?? 20;
  return { page, perPage, limit: perPage, offset: (page - 1) * perPage };
}

function listPayload({ total, page, perPage, items }) {
  return {
    total,
    page,
    per_page: perPage,
    total_pages: Math.max(1, Math.ceil(total / perPage)),
    items,
  };
}

export async function buildApp(opts = {}) {
  const app = Fastify({
    logger: opts.logger ?? true,
    trustProxy: process.env.TRUST_PROXY === '1',
    // Public read-only API: keep request bodies effectively disabled.
    bodyLimit: 1024,
  });

  // Plugins must finish loading before routes are declared, otherwise their
  // hooks (notably rate limiting) do not apply to the routes.
  await app.register(helmet, { global: true });
  await app.register(cors, { origin: '*', methods: ['GET', 'HEAD', 'OPTIONS'] });
  await app.register(compress, { encodings: ['gzip', 'deflate'] });
  await app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX ?? 120),
    timeWindow: '1 minute',
    allowList: [],
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Produk API — Indonesian Retail Products',
        description:
          'Open public API for Indonesian retail products. ' +
          'Product data © Open Food Facts contributors, licensed under the ' +
          'Open Database License (ODbL). https://openfoodfacts.org',
        version: '1.0.0',
        license: { name: 'ODbL (data) / MIT (code)', url: 'https://opendatacommons.org/licenses/odbl/1-0/' },
      },
      tags: [
        { name: 'products', description: 'Browse and look up products' },
        { name: 'search', description: 'Full-text search' },
        { name: 'taxonomy', description: 'Brands and categories' },
        { name: 'meta', description: 'API metadata' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  await app.register(fastifyStatic, {
    root: resolve(ROOT, 'pos'),
    prefix: '/pos/',
  });

  // Cache headers: everything is public, read-only data refreshed daily.
  app.addHook('onSend', async (req, reply) => {
    if (req.method === 'GET' && reply.statusCode === 200 && !reply.getHeader('cache-control')) {
      reply.header('cache-control', 'public, max-age=300, stale-while-revalidate=3600');
    }
  });

  app.get('/', { schema: { hide: true } }, async (req, reply) => reply.redirect('/docs'));

  app.get('/healthz', {
    schema: {
      tags: ['meta'],
      response: { 200: { type: 'object', properties: { status: { type: 'string' } } } },
    },
    config: { rateLimit: false },
  }, async () => ({ status: 'ok' }));

  app.get('/v1/stats', {
    schema: {
      tags: ['meta'],
      summary: 'Dataset statistics',
      response: {
        200: {
          type: 'object',
          properties: {
            products: { type: 'integer' },
            brands: { type: 'integer' },
            last_updated: { type: ['integer', 'null'] },
            source: { type: 'string' },
            license: { type: 'string' },
          },
        },
      },
    },
  }, async () => ({
    ...stmts.stats.get(),
    source: 'Open Food Facts (https://openfoodfacts.org)',
    license: 'ODbL — https://opendatacommons.org/licenses/odbl/1-0/',
  }));

  app.get('/v1/export', {
    schema: {
      tags: ['products'],
      summary: 'Compact bulk export of the full catalog (for offline clients)',
      response: {
        200: {
          type: 'object',
          properties: {
            count: { type: 'integer' },
            exported_at: { type: 'integer' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  barcode: { type: 'string' },
                  name: { type: ['string', 'null'] },
                  brand: { type: ['string', 'null'] },
                  quantity: { type: ['string', 'null'] },
                  image_small_url: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    reply.header('cache-control', 'public, max-age=3600');
    const items = stmts.export.all();
    return { count: items.length, exported_at: Math.floor(Date.now() / 1000), items };
  });

  app.get('/v1/products', {
    schema: {
      tags: ['products'],
      summary: 'List products, most-scanned first',
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...paginationProps,
          brand: { type: 'string', maxLength: 100 },
          category: { type: 'string', maxLength: 100 },
        },
      },
      response: { 200: listResponse(productSummarySchema) },
    },
  }, async (req) => {
    const { page, perPage, limit, offset } = paginate(req.query);
    const filters = { brand: req.query.brand ?? null, category: req.query.category ?? null };
    const total = stmts.listCount.get(filters).n;
    const items = stmts.list.all({ ...filters, limit, offset }).map((r) => toProduct(r));
    return listPayload({ total, page, perPage, items });
  });

  app.get('/v1/products/:barcode', {
    schema: {
      tags: ['products'],
      summary: 'Look up a product by barcode (EAN/UPC)',
      params: {
        type: 'object',
        properties: { barcode: { type: 'string', pattern: '^\\d{4,14}$' } },
        required: ['barcode'],
      },
      response: { 200: productFullSchema, 404: errorSchema },
    },
  }, async (req, reply) => {
    const row = stmts.byBarcode.get(req.params.barcode);
    if (!row) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `No product with barcode ${req.params.barcode}`,
      });
    }
    return toProduct(row, { full: true });
  });

  app.get('/v1/search', {
    schema: {
      tags: ['search'],
      summary: 'Full-text search across product names, brands and categories',
      querystring: {
        type: 'object',
        additionalProperties: false,
        required: ['q'],
        properties: {
          q: { type: 'string', minLength: 1, maxLength: 100 },
          ...paginationProps,
        },
      },
      response: { 200: listResponse(productSummarySchema), 400: errorSchema },
    },
  }, async (req, reply) => {
    const match = ftsQuery(req.query.q);
    if (!match) {
      return reply.code(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Query must contain at least one searchable term',
      });
    }
    const { page, perPage, limit, offset } = paginate(req.query);
    const total = stmts.searchCount.get({ match }).n;
    const items = stmts.search.all({ match, limit, offset }).map((r) => toProduct(r));
    return listPayload({ total, page, perPage, items });
  });

  const taxonomyItem = {
    type: 'object',
    properties: { name: { type: 'string' }, product_count: { type: 'integer' } },
  };

  app.get('/v1/brands', {
    schema: {
      tags: ['taxonomy'],
      summary: 'List brands with product counts',
      querystring: { type: 'object', additionalProperties: false, properties: paginationProps },
      response: { 200: listResponse(taxonomyItem) },
    },
  }, async (req) => {
    const { page, perPage, limit, offset } = paginate(req.query);
    const total = stmts.brandsCount.get().n;
    const items = stmts.brands.all({ limit, offset });
    return listPayload({ total, page, perPage, items });
  });

  app.get('/v1/categories', {
    schema: {
      tags: ['taxonomy'],
      summary: 'List categories with product counts',
      querystring: { type: 'object', additionalProperties: false, properties: paginationProps },
      response: { 200: listResponse(taxonomyItem) },
    },
  }, async (req) => {
    const { page, perPage, limit, offset } = paginate(req.query);
    const total = stmts.categoriesCount.get().n;
    const items = stmts.categories.all({ limit, offset });
    return listPayload({ total, page, perPage, items });
  });

  return app;
}
