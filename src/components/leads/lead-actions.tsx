'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LeadStatus } from '@prisma/client';
import { Check, Mail, MailCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api/client';
import { LEAD_STATUS_LABELS } from './display';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function LeadActions({
  leadId,
  status,
  hasWebsite,
  hasEmail,
}: {
  leadId: string;
  status: LeadStatus;
  hasWebsite: boolean;
  hasEmail: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'status' | 'email' | 'verify' | 'delete' | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const changeStatus = async (next: LeadStatus) => {
    setBusy('status');
    try {
      await apiFetch('/api/leads/bulk', { method: 'POST', body: { action: 'status', leadIds: [leadId], status: next } });
      toast.success(`Status set to ${LEAD_STATUS_LABELS[next]}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'The status could not be changed.');
    } finally {
      setBusy(null);
    }
  };

  const findEmail = async () => {
    setBusy('email');
    try {
      const { jobId } = await apiFetch<{ jobId: string }>('/api/email/find', {
        method: 'POST',
        body: { leadIds: [leadId], verify: true },
      });

      // Single-lead discovery finishes quickly; poll until the job settles.
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const job = await apiFetch<{ status: string; succeeded: number }>(`/api/jobs/${jobId}/advance`, {
          method: 'POST',
        });
        if (job.status === 'COMPLETED' || job.status === 'FAILED') {
          if (job.succeeded > 0) toast.success('Public email found');
          else toast.info('No public email found on this website');
          router.refresh();
          return;
        }
      }
      toast.info('Email discovery is still running. Refresh in a moment.');
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Email discovery failed.');
    } finally {
      setBusy(null);
    }
  };

  const verifyEmail = async () => {
    setBusy('verify');
    try {
      const result = await apiFetch<{ detail: string; verified: boolean }>('/api/email/verify', {
        method: 'POST',
        body: { leadId },
      });
      toast[result.verified ? 'success' : 'info'](result.detail);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Verification failed.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    try {
      await apiFetch(`/api/leads/${leadId}`, { method: 'DELETE' });
      toast.success('Lead permanently deleted');
      router.push('/leads');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'The lead could not be deleted.');
      setBusy(null);
    }
  };

  return (
    <>
      <Select value={status} onValueChange={(value) => changeStatus(value as LeadStatus)} disabled={busy === 'status'}>
        <SelectTrigger className="h-8 w-[168px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.values(LeadStatus).map((value) => (
            <SelectItem key={value} value={value}>
              {LEAD_STATUS_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasWebsite ? (
        <Button size="sm" variant="outline" onClick={findEmail} loading={busy === 'email'}>
          <Mail />
          {hasEmail ? 'Re-check email' : 'Find email'}
        </Button>
      ) : null}

      {hasEmail ? (
        <Button size="sm" variant="outline" onClick={verifyEmail} loading={busy === 'verify'}>
          <MailCheck />
          Verify
        </Button>
      ) : null}

      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteOpen(true)}>
        <Trash2 />
        Delete
      </Button>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              The business, its stored reviews, discovered emails, notes and activity history are erased. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>
              <Check />
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
