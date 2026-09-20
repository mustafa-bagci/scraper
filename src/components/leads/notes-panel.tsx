'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquarePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/utils';

export type NoteItem = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
};

export function NotesPanel({ leadId, notes }: { leadId: string; notes: NoteItem[] }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`/api/leads/${leadId}/notes`, { method: 'POST', body: { body: body.trim() } });
      setBody('');
      toast.success('Note added');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'The note could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (noteId: string) => {
    try {
      await apiFetch(`/api/leads/${leadId}/notes`, { method: 'DELETE', body: { noteId } });
      toast.success('Note deleted');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'The note could not be deleted.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="What did you learn about this prospect?"
          rows={3}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={add} loading={saving} disabled={!body.trim()}>
            <MessageSquarePlus />
            Add note
          </Button>
        </div>
      </div>

      {notes.length === 0 ? (
        <EmptyState icon={MessageSquarePlus} title="No notes yet" description="Capture context before you reach out." />
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="rounded-lg border border-border bg-secondary/40 px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(note.id)}
                  aria-label="Delete note"
                >
                  <Trash2 />
                </Button>
              </div>
              <p className="mt-1.5 text-2xs text-muted-foreground">
                {note.authorName ?? 'Unknown'} · {formatDateTime(note.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
