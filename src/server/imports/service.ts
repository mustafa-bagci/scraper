import 'server-only';
import { JobStatus, type Prisma } from '@prisma/client';
import Papa from 'papaparse';
import { prisma } from '@/lib/db/prisma';
import { extractDomain } from '@/lib/dedupe/service';
import { normalizeEmail } from '@/lib/email/extract';
import { getSettings } from '@/lib/settings/service';
import { upsertBusinessAsLead } from '@/server/leads/upsert';
import type { NormalizedBusiness } from '@/lib/providers/business/BusinessDataProvider';

/**
 * CSV import with column mapping and duplicate detection.
 *
 * Parsing and preview happen first so the operator confirms the mapping before
 * a single row is written.
 */

export const IMPORT_FIELDS = [
  { key: 'businessName', label: 'Business Name', required: true },
  { key: 'category', label: 'Category', required: false },
  { key: 'website', label: 'Website', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'address', label: 'Address', required: false },
  { key: 'postalCode', label: 'Postal Code', required: false },
  { key: 'city', label: 'City', required: false },
  { key: 'region', label: 'Region', required: false },
  { key: 'country', label: 'Country', required: false },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]['key'];
export type ColumnMapping = Partial<Record<ImportField, string>>;

export type ImportPreview = {
  headers: string[];
  rowCount: number;
  sampleRows: Array<Record<string, string>>;
  suggestedMapping: ColumnMapping;
  errors: string[];
};

const HEADER_HINTS: Record<ImportField, RegExp> = {
  businessName: /^(business|company|name|nom|raison|entreprise|société|societe)/i,
  category: /^(category|categorie|catégorie|secteur|industry|type)/i,
  website: /^(website|site|url|web|domaine|domain)/i,
  email: /^(e-?mail|courriel|contact.?mail)/i,
  phone: /^(phone|tel|téléphone|telephone|mobile|numero|numéro)/i,
  address: /^(address|adresse|street|rue)/i,
  postalCode: /^(postal|zip|cp|code.?postal)/i,
  city: /^(city|ville|commune|town)/i,
  region: /^(region|région|state|province|departement|département)/i,
  country: /^(country|pays|nation)/i,
};

export function parseCsvPreview(content: string, sampleSize = 5): ImportPreview {
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  const headers = (parsed.meta.fields ?? []).filter(Boolean);
  const rows = parsed.data.filter((row) => Object.values(row).some((value) => String(value ?? '').trim()));

  const suggestedMapping: ColumnMapping = {};
  for (const field of IMPORT_FIELDS) {
    const match = headers.find((header) => HEADER_HINTS[field.key].test(header));
    if (match) suggestedMapping[field.key] = match;
  }

  return {
    headers,
    rowCount: rows.length,
    sampleRows: rows.slice(0, sampleSize),
    suggestedMapping,
    errors: parsed.errors.slice(0, 5).map((error) => `Row ${(error.row ?? 0) + 1}: ${error.message}`),
  };
}

export type ImportResult = {
  batchId: string;
  totalRows: number;
  imported: number;
  duplicates: number;
  skipped: number;
};

export async function importCsv(
  content: string,
  mapping: ColumnMapping,
  options: { fileName: string; userId: string | null },
): Promise<ImportResult> {
  const settings = await getSettings();

  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  const rows = parsed.data.filter((row) => Object.values(row).some((value) => String(value ?? '').trim()));

  const batch = await prisma.importBatch.create({
    data: {
      userId: options.userId,
      fileName: options.fileName.slice(0, 200),
      status: JobStatus.RUNNING,
      totalRows: rows.length,
      mapping: mapping as Prisma.InputJsonValue,
    },
  });

  let imported = 0;
  let duplicates = 0;
  let skipped = 0;

  for (const row of rows) {
    const value = (field: ImportField): string | null => {
      const column = mapping[field];
      if (!column) return null;
      const raw = String(row[column] ?? '').trim();
      return raw.length > 0 ? raw : null;
    };

    const businessName = value('businessName');
    if (!businessName) {
      skipped += 1;
      continue;
    }

    const website = normaliseWebsite(value('website'));
    const email = value('email') ? normalizeEmail(value('email')!) : null;

    const business: NormalizedBusiness = {
      externalId: '',
      name: businessName,
      primaryCategory: value('category'),
      categories: value('category') ? [value('category')!] : [],
      country: value('country'),
      countryCode: null,
      region: value('region'),
      city: value('city'),
      postalCode: value('postalCode'),
      address: value('address'),
      latitude: null,
      longitude: null,
      phone: value('phone'),
      website,
      email,
      rating: null,
      reviewCount: 0,
      ratingBreakdown: null,
      reviews: [],
      openNow: null,
      businessStatus: null,
      sourceUrl: null,
    };

    try {
      const outcome = await upsertBusinessAsLead(business, {
        provider: 'csv-import',
        settings,
        ownerId: options.userId,
        importBatchId: batch.id,
        source: 'import',
      });

      if (outcome.created) {
        imported += 1;
        if (email) {
          await prisma.lead.update({
            where: { id: outcome.lead.id },
            data: { emailSource: 'csv-import', emailFoundAt: new Date(), emailStatus: 'FOUND' },
          });
        }
      } else {
        duplicates += 1;
      }
    } catch (error) {
      console.error('[import] row failed', error);
      skipped += 1;
    }
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { status: JobStatus.COMPLETED, imported, duplicates, skipped, finishedAt: new Date() },
  });

  return { batchId: batch.id, totalRows: rows.length, imported, duplicates, skipped };
}

function normaliseWebsite(value: string | null): string | null {
  if (!value) return null;
  const domain = extractDomain(value);
  if (!domain) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${domain}`;
}
