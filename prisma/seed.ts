/**
 * Seed script.
 *
 * Creates the initial admin account and a realistic — but unambiguously
 * synthetic — demo dataset so every screen (search, filtering, sorting,
 * scoring, lead details, email status, export, dashboard charts) has something
 * meaningful to show before any provider is connected.
 *
 * Run with: npx prisma db seed
 */
import { ActivityType, EmailStatus, JobStatus, LeadStatus, PrismaClient, WebsiteStatus } from '@prisma/client';
import { MockBusinessProvider } from '../src/lib/providers/business/MockBusinessProvider';
import { MockEmailFinder } from '../src/lib/providers/email/MockEmailFinder';
import { buildDedupeKeys, extractDomain } from '../src/lib/dedupe/service';
import { computeReviewStats } from '../src/lib/reviews/stats';
import { scoreLead, toStoredBreakdown } from '../src/lib/scoring/engine';
import { hashPassword } from '../src/lib/security/crypto';
import { DEFAULT_SETTINGS } from '../src/types/settings';

const prisma = new PrismaClient();

const TARGET_BUSINESSES = 60;

// Uneven sizes so the category ranking on the dashboard actually ranks.
const SEARCH_PLANS = [
  { country: 'France', city: 'Lyon', category: 'Dentiste', count: 14 },
  { country: 'France', city: 'Paris', category: 'Restaurant', count: 12 },
  { country: 'France', city: 'Bordeaux', category: 'Plombier', count: 10 },
  { country: 'France', city: 'Lille', category: 'Garage automobile', count: 9 },
  { country: 'Belgique', city: 'Bruxelles', category: 'Avocat', count: 8 },
  { country: 'Belgique', city: 'Gand', category: 'Agence immobilière', count: 7 },
];

const STATUS_CYCLE: LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.NEW,
  LeadStatus.NEW,
  LeadStatus.QUALIFIED,
  LeadStatus.QUALIFIED,
  LeadStatus.CONTACTED,
  LeadStatus.CONTACTED,
  LeadStatus.REPLIED,
  LeadStatus.INTERESTED,
  LeadStatus.NOT_INTERESTED,
  LeadStatus.CUSTOMER,
  LeadStatus.ARCHIVED,
];

const NOTE_TEXTS = [
  'Called the front desk — the manager handles supplier decisions, best reached before 10:00.',
  'Website has not been touched since 2019. Strong case for a refresh.',
  'They replied asking for pricing. Send the one-page overview.',
  'Already working with a competitor; revisit next quarter.',
];

async function main() {
  console.log('Seeding Murgay Lead Intelligence…');

  // --- Admin user ----------------------------------------------------------
  const email = (process.env.ADMIN_EMAIL ?? 'admin@murgay.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? 'ChangeMe!2026';

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Murgay Admin',
      passwordHash: await hashPassword(password),
      role: 'ADMIN',
    },
  });
  console.log(`  ✓ admin user: ${email}`);

  // --- Settings ------------------------------------------------------------
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value: value as object },
    });
  }
  console.log('  ✓ default settings');

  // Production deployments seed the admin account and settings only. Set
  // SEED_DEMO_DATA=false in the environment to skip the synthetic businesses.
  if (process.env.SEED_DEMO_DATA === 'false') {
    console.log('  • SEED_DEMO_DATA=false — admin and settings only, no demo data.');
    return;
  }

  const existingLeads = await prisma.lead.count();
  if (existingLeads > 0) {
    console.log(`  • ${existingLeads} leads already present — skipping demo data.`);
    return;
  }

  // --- Demo leads ----------------------------------------------------------
  const provider = new MockBusinessProvider();
  const finder = new MockEmailFinder();
  const settings = DEFAULT_SETTINGS;

  let created = 0;
  let reviewsCreated = 0;
  let emailsCreated = 0;
  let statusIndex = 0;

  for (const [planIndex, plan] of SEARCH_PLANS.entries()) {
    const perPlan = plan.count;

    const searchRun = await prisma.searchRun.create({
      data: {
        userId: user.id,
        label: `${plan.country} → ${plan.category} → ${plan.city}`,
        filters: {
          country: plan.country,
          city: plan.city,
          category: plan.category,
          rating: { max: 4.5 },
          reviewCount: { min: 20 },
          limit: perPlan,
        },
        provider: provider.id,
        status: JobStatus.COMPLETED,
        progress: 100,
        discovered: perPlan,
        unique: perPlan,
        duplicates: 0,
        matched: perPlan,
        created: perPlan,
        providerCalls: Math.ceil(perPlan / 20),
        statusMessage: `${perPlan} new leads`,
        startedAt: daysAgo(planIndex * 4 + 2),
        finishedAt: daysAgo(planIndex * 4 + 2),
        createdAt: daysAgo(planIndex * 4 + 2),
      },
    });

    const { count: _count, ...query } = plan;
    const page = await provider.searchBusinesses({ ...query, limit: perPlan });

    for (const business of page.businesses) {
      if (created >= TARGET_BUSINESSES) break;

      const stats = computeReviewStats(business.ratingBreakdown, business.reviewCount, settings.reviews);
      const keys = buildDedupeKeys({
        provider: provider.id,
        externalId: business.externalId,
        businessName: business.name,
        address: business.address,
        phone: business.phone,
        website: business.website,
      });

      // Most demo leads already carry a discovered email so the dashboard's
      // discovery-rate chart and the email-status filters have real material;
      // the rest stay undiscovered so "Find emails" has something to do.
      const shouldHaveEmail = business.website !== null && created % 10 < 9;
      let emailValue: string | null = null;
      let emailSource: string | null = null;
      let emailSourceUrl: string | null = null;
      let emailStatus: EmailStatus = EmailStatus.UNKNOWN;

      if (shouldHaveEmail) {
        const found = await finder.findEmails({
          website: business.website,
          businessName: business.name,
          domain: extractDomain(business.website),
        });
        const primary = found.candidates[0];
        if (primary) {
          emailValue = primary.email;
          emailSource = primary.source;
          emailSourceUrl = primary.sourceUrl;
          emailStatus = created % 6 === 0 ? EmailStatus.VALID : created % 7 === 0 ? EmailStatus.RISKY : EmailStatus.FOUND;
        }
      }

      const score = scoreLead(
        {
          rating: business.rating,
          reviewCount: stats.reviewCount,
          badReviewCount: stats.badReviewCount,
          badReviewPercentage: stats.badReviewPercentage,
          email: emailValue,
          website: business.website,
          phone: business.phone,
        },
        settings.scoring,
      );

      const createdAt = daysAgo(planIndex * 4 + 2 + (created % 5));
      const status = STATUS_CYCLE[statusIndex % STATUS_CYCLE.length]!;
      statusIndex += 1;

      const lead = await prisma.lead.create({
        data: {
          externalId: business.externalId,
          provider: provider.id,
          businessName: business.name,
          category: business.primaryCategory,
          categories: business.categories,
          country: business.country,
          countryCode: business.countryCode,
          region: business.region,
          city: business.city,
          postalCode: business.postalCode,
          address: business.address,
          latitude: business.latitude,
          longitude: business.longitude,
          phone: business.phone,
          website: business.website,
          websiteDomain: keys.websiteDomain,
          rating: business.rating,
          reviewCount: stats.reviewCount,
          oneStarCount: stats.oneStarCount,
          twoStarCount: stats.twoStarCount,
          threeStarCount: stats.threeStarCount,
          fourStarCount: stats.fourStarCount,
          fiveStarCount: stats.fiveStarCount,
          badReviewCount: stats.badReviewCount,
          badReviewPercentage: stats.badReviewPercentage,
          reviewBreakdownAvailable: stats.breakdownAvailable,
          email: emailValue,
          emailStatus,
          emailSource,
          emailSourceUrl,
          emailFoundAt: emailValue ? createdAt : null,
          emailCheckedAt: business.website ? createdAt : null,
          websiteStatus: business.website
            ? emailValue
              ? WebsiteStatus.CRAWLED
              : WebsiteStatus.UNKNOWN
            : WebsiteStatus.NO_WEBSITE,
          leadScore: score.score,
          scoreBreakdown: toStoredBreakdown(score) as object,
          status,
          source: 'search',
          sourceUrl: business.sourceUrl,
          openNow: business.openNow,
          businessStatus: business.businessStatus,
          dedupeKey: keys.dedupeKey,
          normalizedName: keys.normalizedName,
          normalizedPhone: keys.normalizedPhone,
          ownerId: user.id,
          searchRunId: searchRun.id,
          collectedAt: createdAt,
          createdAt,
          updatedAt: createdAt,
        },
      });

      if (business.reviews.length > 0) {
        await prisma.review.createMany({
          data: business.reviews.slice(0, settings.reviews.maxStoredReviewsPerLead).map((review) => ({
            leadId: lead.id,
            externalId: review.externalId,
            rating: review.rating,
            text: review.text,
            authorName: review.authorName,
            publishedAt: review.publishedAt,
            language: review.language,
            source: 'provider',
            sourceUrl: business.sourceUrl,
          })),
        });
        reviewsCreated += Math.min(business.reviews.length, settings.reviews.maxStoredReviewsPerLead);
      }

      if (emailValue) {
        await prisma.leadEmail.create({
          data: {
            leadId: lead.id,
            email: emailValue,
            status: emailStatus,
            source: emailSource,
            sourceUrl: emailSourceUrl,
            isPrimary: true,
            isGeneric: true,
            score: 140,
            foundAt: createdAt,
            ...(emailStatus === EmailStatus.VALID
              ? { verifiedAt: createdAt, verificationProvider: 'mock' }
              : {}),
          },
        });
        emailsCreated += 1;
      }

      await prisma.leadActivity.createMany({
        data: [
          {
            leadId: lead.id,
            userId: user.id,
            type: ActivityType.CREATED,
            message: `Lead discovered via ${provider.id} provider`,
            createdAt,
          },
          ...(emailValue
            ? [
                {
                  leadId: lead.id,
                  userId: user.id,
                  type: ActivityType.EMAIL_FOUND,
                  message: `Public email found: ${emailValue}${emailSourceUrl ? ` (on ${emailSourceUrl})` : ''}`,
                  createdAt,
                },
              ]
            : []),
          ...(status !== LeadStatus.NEW
            ? [
                {
                  leadId: lead.id,
                  userId: user.id,
                  type: ActivityType.STATUS_CHANGED,
                  message: `Status changed from NEW to ${status}`,
                  createdAt,
                },
              ]
            : []),
        ],
      });

      if (created % 7 === 0) {
        await prisma.leadNote.create({
          data: {
            leadId: lead.id,
            userId: user.id,
            body: NOTE_TEXTS[created % NOTE_TEXTS.length]!,
            createdAt,
          },
        });
      }

      created += 1;
    }
  }

  // --- Saved searches ------------------------------------------------------
  await prisma.savedSearch.createMany({
    data: [
      {
        userId: user.id,
        name: 'French dentists with poor reviews',
        description: 'Under-performing dental practices with enough volume to care about their reputation.',
        filters: {
          country: 'France',
          category: 'Dentiste',
          rating: { max: 4.0 },
          reviewCount: { min: 50 },
          badReviewCount: { min: 10 },
          email: 'required',
          limit: 100,
        },
        runCount: 2,
        lastRunAt: daysAgo(3),
      },
      {
        userId: user.id,
        name: 'Belgian agencies without a website',
        description: 'Prime targets for a first web presence.',
        filters: { country: 'Belgique', category: 'Agence immobilière', website: 'missing', limit: 50 },
        runCount: 1,
        lastRunAt: daysAgo(9),
      },
      {
        userId: user.id,
        name: 'High-volume restaurants, weak rating',
        description: 'Busy venues whose rating is dragging them down.',
        filters: {
          category: 'Restaurant',
          rating: { max: 4.2 },
          reviewCount: { min: 200 },
          badReviewPercentage: { min: 10 },
          limit: 100,
        },
        runCount: 0,
      },
    ],
  });

  console.log(`  ✓ ${created} demo businesses`);
  console.log(`  ✓ ${reviewsCreated} reviews`);
  console.log(`  ✓ ${emailsCreated} discovered emails`);
  console.log('  ✓ 3 saved searches');
  console.log('\nSign in with:');
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}\n`);
}

function daysAgo(days: number): Date {
  const date = new Date(Date.now() - days * 86_400_000);
  date.setHours(9 + (days % 8), (days * 7) % 60, 0, 0);
  return date;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
