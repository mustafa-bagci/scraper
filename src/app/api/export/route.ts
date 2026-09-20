import { ExportFormat } from '@prisma/client';
import { z } from 'zod';
import { parseBody, parseQuery, withAuth } from '@/lib/api/handler';
import { prisma } from '@/lib/db/prisma';
import { leadFiltersSchema } from '@/types/filters';
import { filtersFromSearchParams } from '@/lib/filters/url';
import { buildExport } from '@/server/exports/service';

const schema = z.object({
  format: z.enum(['CSV', 'XLSX', 'JSON']),
  scope: z.enum(['selected', 'filtered', 'all']),
  leadIds: z.array(z.string().cuid()).max(20000).optional(),
  filters: leadFiltersSchema.optional(),
});

/** Streams a CSV / XLSX / JSON export and records it in the export history. */
export const POST = withAuth(
  async (request, { user }) => {
    const body = await parseBody(request, schema);

    const payload = await buildExport({
      format: body.format,
      scope: body.scope,
      leadIds: body.leadIds,
      filters: body.filters,
    });

    await prisma.exportRecord.create({
      data: {
        userId: user.id,
        format: ExportFormat[body.format],
        scope: body.scope,
        rowCount: payload.rowCount,
        fileName: payload.fileName,
        filters: (body.filters ?? {}) as object,
      },
    });

    const buffer = typeof payload.body === 'string' ? Buffer.from(payload.body, 'utf8') : payload.body;

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'content-type': payload.contentType,
        'content-disposition': `attachment; filename="${payload.fileName}"`,
        'x-row-count': String(payload.rowCount),
        'cache-control': 'no-store',
      },
    });
  },
  { rateLimit: { key: 'export', limit: 30, windowMs: 60_000 } },
);

const getSchema = z.object({
  format: z.enum(['CSV', 'XLSX', 'JSON']).default('CSV'),
  scope: z.enum(['filtered', 'all']).default('all'),
});

/**
 * Convenience export for scripted use: filters are read from the query string
 * (the same vocabulary the lead list uses). Selecting specific ids requires the
 * POST form.
 */
export const GET = withAuth(
  async (request, { user }) => {
    const { format, scope } = parseQuery(request, getSchema);
    const url = new URL(request.url);
    const filters = leadFiltersSchema.parse(filtersFromSearchParams(Object.fromEntries(url.searchParams)));

    const payload = await buildExport({ format, scope, filters });

    await prisma.exportRecord.create({
      data: {
        userId: user.id,
        format: ExportFormat[format],
        scope,
        rowCount: payload.rowCount,
        fileName: payload.fileName,
        filters: filters as object,
      },
    });

    const buffer = typeof payload.body === 'string' ? Buffer.from(payload.body, 'utf8') : payload.body;

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'content-type': payload.contentType,
        'content-disposition': `attachment; filename="${payload.fileName}"`,
        'x-row-count': String(payload.rowCount),
        'cache-control': 'no-store',
      },
    });
  },
  { rateLimit: { key: 'export:get', limit: 30, windowMs: 60_000 } },
);
