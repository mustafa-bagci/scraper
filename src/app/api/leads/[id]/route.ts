import { z } from 'zod';
import { apiError, apiSuccess, handleUnexpected, parseBody } from '@/lib/api/handler';
import { getCurrentUser } from '@/lib/auth/session';
import { deleteLeads, getLeadDetail, updateLeadFields } from '@/server/leads/service';

const patchSchema = z.object({
  businessName: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(60).nullable().optional(),
  website: z.string().trim().max(400).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError('Authentication required.', 401);

    const { id } = await params;
    const lead = await getLeadDetail(id);
    if (!lead) return apiError('Lead not found.', 404);

    return apiSuccess(lead);
  } catch (error) {
    return handleUnexpected(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError('Authentication required.', 401);

    const { id } = await params;
    const body = await parseBody(request, patchSchema);
    const lead = await updateLeadFields(id, body, user.id);

    return apiSuccess(lead);
  } catch (error) {
    return handleUnexpected(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError('Authentication required.', 401);

    const { id } = await params;
    const deleted = await deleteLeads([id]);
    if (deleted === 0) return apiError('Lead not found.', 404);

    return apiSuccess({ deleted });
  } catch (error) {
    return handleUnexpected(error);
  }
}
