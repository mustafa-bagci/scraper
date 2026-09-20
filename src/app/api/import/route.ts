import { z } from 'zod';
import { apiSuccess, parseBody, withAuth } from '@/lib/api/handler';
import { IMPORT_FIELDS, importCsv, parseCsvPreview } from '@/server/imports/service';

const mappingSchema = z.object(
  Object.fromEntries(IMPORT_FIELDS.map((field) => [field.key, z.string().min(1).optional()])) as Record<
    (typeof IMPORT_FIELDS)[number]['key'],
    z.ZodOptional<z.ZodString>
  >,
);

const schema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('preview'),
    content: z.string().min(1).max(8_000_000),
  }),
  z.object({
    mode: z.literal('commit'),
    content: z.string().min(1).max(8_000_000),
    fileName: z.string().min(1).max(200),
    mapping: mappingSchema,
  }),
]);

/** Two-phase CSV import: preview the mapping, then commit the rows. */
export const POST = withAuth(
  async (request, { user }) => {
    const body = await parseBody(request, schema);

    if (body.mode === 'preview') {
      return apiSuccess(parseCsvPreview(body.content));
    }

    const result = await importCsv(body.content, body.mapping, {
      fileName: body.fileName,
      userId: user.id,
    });

    return apiSuccess(result);
  },
  { rateLimit: { key: 'import', limit: 10, windowMs: 60_000 } },
);
