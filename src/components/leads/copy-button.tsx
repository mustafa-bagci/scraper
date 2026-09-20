'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label.replace('Copy', 'Copied')}`.trim());
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Clipboard access was denied by the browser.');
    }
  };

  return (
    <Button variant="ghost" size="icon-sm" onClick={copy} aria-label={label}>
      {copied ? <Check className="text-success" /> : <Copy />}
    </Button>
  );
}
