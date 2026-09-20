import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ImportWizard } from '@/components/leads/import-wizard';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Import CSV' };

export default function ImportPage() {
  return (
    <>
      <PageHeader
        title="Import leads from CSV"
        description="Bring an existing prospect list into the workspace with duplicate detection."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/leads">
              <ArrowLeft />
              Back to leads
            </Link>
          </Button>
        }
      />
      <div className="px-4 py-5 sm:px-6">
        <ImportWizard />
      </div>
    </>
  );
}
