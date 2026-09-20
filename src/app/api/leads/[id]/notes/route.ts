import { z } from 'zod';
import { apiError, apiSuccess, handleUnexpected, parseBody } from '@/lib/api/handler';
import { getCurrentUser } from '@/lib/auth/session';
import { addNote, deleteNote } from '@/server/leads/service';

const noteSchema = z.object({ body: z.string().trim().min(1).max(5000) });
const deleteSchema = z.object({ noteId: z.string().cuid() });

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError('Authentication required.', 401);

    const { id } = await params;
    const { body } = await parseBody(request, noteSchema);
    const note = await addNote(id, body, user.id);

    return apiSuccess(note);
  } catch (error) {
    return handleUnexpected(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError('Authentication required.', 401);

    await params;
    const { noteId } = await parseBody(request, deleteSchema);
    await deleteNote(noteId);

    return apiSuccess({ deleted: 1 });
  } catch (error) {
    return handleUnexpected(error);
  }
}
