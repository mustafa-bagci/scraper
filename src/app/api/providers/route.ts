import { z } from 'zod';
import { apiError, apiSuccess, parseBody, withAuth } from '@/lib/api/handler';
import { prisma } from '@/lib/db/prisma';
import { AVAILABLE_PROVIDERS, getProviderStatuses } from '@/lib/providers/registry';
import { encryptSecret, secretHint } from '@/lib/security/crypto';

const schema = z.object({
  kind: z.enum(['business', 'email-finder', 'email-verification']),
  providerId: z.string().min(1).max(60),
  /** Omit to keep the stored key; empty string clears it. */
  apiKey: z.string().max(400).optional(),
});

export const GET = withAuth(async () =>
  apiSuccess({ available: AVAILABLE_PROVIDERS, statuses: await getProviderStatuses() }),
);

/**
 * Selects the active provider for a kind and stores its API key encrypted.
 * The key is never echoed back — only a masked hint.
 */
export const PATCH = withAuth(async (request) => {
  const body = await parseBody(request, schema);

  const descriptor = AVAILABLE_PROVIDERS.find((p) => p.kind === body.kind && p.id === body.providerId);
  if (!descriptor) return apiError('Unknown provider for this slot.', 400);

  const trimmedKey = body.apiKey?.trim();

  await prisma.$transaction(async (tx) => {
    await tx.providerConfig.updateMany({ where: { kind: body.kind }, data: { isActive: false } });

    const existing = await tx.providerConfig.findUnique({
      where: { kind_name: { kind: body.kind, name: body.providerId } },
    });

    const keyFields =
      trimmedKey === undefined
        ? {}
        : trimmedKey === ''
          ? { apiKeyCipher: null, apiKeyHint: null }
          : { apiKeyCipher: encryptSecret(trimmedKey), apiKeyHint: secretHint(trimmedKey) };

    if (existing) {
      await tx.providerConfig.update({
        where: { id: existing.id },
        data: { isActive: true, lastError: null, ...keyFields },
      });
    } else {
      await tx.providerConfig.create({
        data: { kind: body.kind, name: body.providerId, isActive: true, ...keyFields },
      });
    }
  });

  return apiSuccess({ statuses: await getProviderStatuses() });
});
