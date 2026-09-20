import type { EmailStatus, Lead, LeadStatus } from '@prisma/client';

/** The exact lead shape the table needs — keeps the RSC payload small. */
export type LeadRow = {
  id: string;
  businessName: string;
  category: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number;
  oneStarCount: number;
  twoStarCount: number;
  badReviewCount: number;
  badReviewPercentage: number;
  reviewBreakdownAvailable: boolean;
  email: string | null;
  emailStatus: EmailStatus;
  emailSource: string | null;
  leadScore: number;
  status: LeadStatus;
  createdAt: string;
};

export function toLeadRow(lead: Lead): LeadRow {
  return {
    id: lead.id,
    businessName: lead.businessName,
    category: lead.category,
    city: lead.city,
    region: lead.region,
    country: lead.country,
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
    reviewBreakdownAvailable: lead.reviewBreakdownAvailable,
    email: lead.email,
    emailStatus: lead.emailStatus,
    emailSource: lead.emailSource,
    leadScore: lead.leadScore,
    status: lead.status,
    createdAt: lead.createdAt.toISOString(),
  };
}
