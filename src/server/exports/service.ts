import 'server-only';
import type { Lead } from '@prisma/client';
import ExcelJS from 'exceljs';
import { prisma } from '@/lib/db/prisma';
import { toPrismaWhere } from '@/lib/filters/engine';
import { getSettings } from '@/lib/settings/service';
import type { LeadFilters } from '@/types/filters';

/**
 * Lead export in CSV, XLSX and JSON.
 *
 * Column order is fixed and documented so downstream tooling (outbound
 * sequencers, CRMs) can rely on it.
 */

export const EXPORT_COLUMNS = [
  { key: 'businessName', header: 'Business Name' },
  { key: 'category', header: 'Category' },
  { key: 'country', header: 'Country' },
  { key: 'region', header: 'Region' },
  { key: 'city', header: 'City' },
  { key: 'postalCode', header: 'Postal Code' },
  { key: 'address', header: 'Address' },
  { key: 'phone', header: 'Phone' },
  { key: 'website', header: 'Website' },
  { key: 'rating', header: 'Rating' },
  { key: 'reviewCount', header: 'Review Count' },
  { key: 'oneStarCount', header: '1 Star Reviews' },
  { key: 'twoStarCount', header: '2 Star Reviews' },
  { key: 'badReviewCount', header: 'Bad Review Count' },
  { key: 'badReviewPercentage', header: 'Bad Review Percentage' },
  { key: 'email', header: 'Email' },
  { key: 'emailStatus', header: 'Email Status' },
  { key: 'emailSource', header: 'Email Source' },
  { key: 'emailSourceUrl', header: 'Email Source URL' },
  { key: 'leadScore', header: 'Lead Score' },
  { key: 'status', header: 'Lead Status' },
  { key: 'sourceUrl', header: 'Source URL' },
  { key: 'createdAt', header: 'Created At' },
] as const;

export type ExportFormatKey = 'CSV' | 'XLSX' | 'JSON';
export type ExportScope = 'selected' | 'filtered' | 'all';

export type ExportRequest = {
  format: ExportFormatKey;
  scope: ExportScope;
  leadIds?: string[];
  filters?: LeadFilters;
};

export type ExportPayload = {
  body: Buffer | string;
  contentType: string;
  fileName: string;
  rowCount: number;
};

export async function buildExport(request: ExportRequest): Promise<ExportPayload> {
  const settings = await getSettings();
  const leads = await loadLeads(request, settings.export.maxRowsPerExport);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const baseName = `murgay-leads-${request.scope}-${stamp}`;

  switch (request.format) {
    case 'JSON':
      return {
        body: JSON.stringify(leads.map(toExportRow), null, 2),
        contentType: 'application/json; charset=utf-8',
        fileName: `${baseName}.json`,
        rowCount: leads.length,
      };
    case 'XLSX': {
      const buffer = await toXlsx(leads);
      return {
        body: buffer,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName: `${baseName}.xlsx`,
        rowCount: leads.length,
      };
    }
    case 'CSV':
    default:
      return {
        body: toCsv(leads, settings.export.csvDelimiter),
        contentType: 'text/csv; charset=utf-8',
        fileName: `${baseName}.csv`,
        rowCount: leads.length,
      };
  }
}

async function loadLeads(request: ExportRequest, maxRows: number): Promise<Lead[]> {
  if (request.scope === 'selected') {
    if (!request.leadIds?.length) return [];
    return prisma.lead.findMany({
      where: { id: { in: request.leadIds.slice(0, maxRows) } },
      orderBy: { leadScore: 'desc' },
    });
  }

  const where = request.scope === 'filtered' && request.filters ? toPrismaWhere(request.filters) : {};
  return prisma.lead.findMany({ where, orderBy: { leadScore: 'desc' }, take: maxRows });
}

type ExportRow = Record<string, string | number | null>;

function toExportRow(lead: Lead): ExportRow {
  return {
    businessName: lead.businessName,
    category: lead.category,
    country: lead.country,
    region: lead.region,
    city: lead.city,
    postalCode: lead.postalCode,
    address: lead.address,
    phone: lead.phone,
    website: lead.website,
    rating: lead.rating,
    reviewCount: lead.reviewCount,
    oneStarCount: lead.oneStarCount,
    twoStarCount: lead.twoStarCount,
    badReviewCount: lead.badReviewCount,
    badReviewPercentage: lead.badReviewPercentage,
    email: lead.email,
    emailStatus: lead.emailStatus,
    emailSource: lead.emailSource,
    emailSourceUrl: lead.emailSourceUrl,
    leadScore: lead.leadScore,
    status: lead.status,
    sourceUrl: lead.sourceUrl,
    createdAt: lead.createdAt.toISOString(),
  };
}

function toCsv(leads: Lead[], delimiter: string): string {
  const header = EXPORT_COLUMNS.map((column) => escapeCsv(column.header, delimiter)).join(delimiter);
  const rows = leads.map((lead) => {
    const row = toExportRow(lead);
    return EXPORT_COLUMNS.map((column) => escapeCsv(row[column.key] ?? '', delimiter)).join(delimiter);
  });
  // BOM keeps accented business names intact when opened in Excel.
  return `﻿${[header, ...rows].join('\r\n')}\r\n`;
}

function escapeCsv(value: string | number, delimiter: string): string {
  const text = String(value ?? '');
  // Neutralise spreadsheet formula injection in exported text.
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  if (guarded.includes(delimiter) || guarded.includes('"') || /[\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

async function toXlsx(leads: Lead[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Murgay Lead Intelligence';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Leads', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = EXPORT_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: Math.min(42, Math.max(14, column.header.length + 6)),
  }));

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  for (const lead of leads) sheet.addRow(toExportRow(lead));

  sheet.autoFilter = { from: 'A1', to: { row: 1, column: EXPORT_COLUMNS.length } };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
