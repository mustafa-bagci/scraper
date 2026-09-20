# Murgay Lead Intelligence

An internal lead-generation and prospecting platform for **Murgay**.

> Find businesses that match your exact criteria, understand their public review
> profile, discover legitimate business contact information, and turn them into
> qualified prospects.

The core loop is deliberately narrow and deep:

```
Business discovery → review intelligence → qualification →
public business email discovery → lead management → export
```

It is not a CRM. It is the thing that fills one.

---

## Table of contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Environment variables](#environment-variables)
- [Architecture](#architecture)
- [Provider abstraction](#provider-abstraction)
- [Review intelligence](#review-intelligence)
- [Lead scoring](#lead-scoring)
- [Email discovery](#email-discovery)
- [Website crawler](#website-crawler)
- [Background jobs](#background-jobs)
- [Export & import](#export--import)
- [Security](#security)
- [Cost control](#cost-control)
- [Data protection](#data-protection)
- [Connecting a live provider](#connecting-a-live-provider)
- [Testing](#testing)
- [Design notes](#design-notes)
- [What is deliberately not here](#what-is-deliberately-not-here)

---

## What it does

| Area | Capability |
|---|---|
| **Discovery** | Search a provider by country, region, city, postal code, category, keyword and result count. Runs as a background job with live counters. |
| **Review intelligence** | Full 1★–5★ distribution, bad-review count and percentage using an operator-defined definition of "bad". Never fabricated when the source cannot supply it. |
| **Qualification** | Transparent, rule-based lead score with a per-lead "Why?" breakdown. No model, no hidden weighting. |
| **Contact discovery** | Public business emails read from the business's own website, with the exact source page stored for every address. |
| **Lead management** | Sorting, filtering, pagination, column customisation, bulk selection, bulk status change, bulk email discovery, notes, activity trail, permanent deletion. |
| **Export / import** | CSV, XLSX and JSON export of the selection, the current filters or everything; CSV import with column mapping and duplicate detection. |
| **Operations** | Saved searches, full search history, export history, daily usage quotas, provider failure handling. |

---

## Quick start

Requirements: **Node 20+** and **PostgreSQL 14+**.

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
#    Set DATABASE_URL, then generate a secret:
#    openssl rand -base64 48   → paste into AUTH_SECRET

# 3. Create the schema and load demo data
npx prisma migrate dev
npx prisma db seed

# 4. Run
npm run dev
```

Open <http://localhost:3000>. Sign in with the credentials printed by the seed
script (by default `admin@murgay.com` / `ChangeMe!2026` — change these via
`ADMIN_EMAIL` / `ADMIN_PASSWORD` before seeding, or change the password in the
database afterwards).

**No API key is required to try the product.** The default configuration uses
`MockBusinessProvider`, which generates deterministic synthetic businesses, so
search, scoring, review statistics, email discovery, export and the dashboard
are all fully exercisable offline.

The seed creates 60 businesses, 700+ reviews, ~38 discovered emails, three saved
searches and a search history. All demo web addresses use the reserved
`.example` TLD (RFC 2606), so demo data can never cause a request to a real
business.

---

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (runs `prisma generate`). |
| `npm run dev` | Development server. |
| `npm run build` | Production build (runs `prisma generate` first). |
| `npm run start` | Serve the production build. |
| `npm run lint` | ESLint, zero-warning policy. |
| `npm run typecheck` | `tsc --noEmit` in strict mode. |
| `npm test` | Logic tests for SSRF, email extraction, scoring, filters, dedupe, robots.txt. |
| `npx prisma migrate dev` | Apply/author migrations in development. |
| `npx prisma migrate deploy` | Apply migrations in production. |
| `npx prisma db seed` | Seed the admin account, settings and demo data. |
| `npx prisma studio` | Browse the database. |

---

## Environment variables

See [`.env.example`](.env.example). `.env` is git-ignored and must never be
committed.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. |
| `AUTH_SECRET` | yes | ≥ 32 chars. Signs session cookies **and** derives the key that encrypts provider API keys at rest. Rotating it invalidates both. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | seed only | Credentials for the account the seed script creates. |
| `BUSINESS_DATA_PROVIDER` | no | `mock` (default) or `google-places`. |
| `BUSINESS_DATA_API_KEY` | conditional | Required by `google-places`. |
| `EMAIL_FINDER_PROVIDER` | no | `website-crawler` (default) or `mock`. |
| `EMAIL_VERIFICATION_PROVIDER` | no | `none` (default), `syntax` or `mock`. |

Environment variables are the fallback. Anything configured in
**Settings → Data Providers** is stored in the database (API keys encrypted with
AES-256-GCM) and takes precedence. Validation happens once, at startup, through
a Zod schema in `src/lib/env.ts`; a malformed environment fails loudly instead of
misbehaving later.

---

## Architecture

Next.js App Router, TypeScript in strict mode, Tailwind + shadcn-style
components, Prisma + PostgreSQL, Zod at every boundary.

```
src/
├── app/
│   ├── (app)/               # authenticated shell
│   │   ├── dashboard/  search/  leads/  leads/[id]/  leads/import/
│   │   ├── searches/  exports/  settings/
│   ├── login/
│   └── api/                 # leads, search, email, jobs, export, import,
│                            # providers, settings, saved-searches, health
├── components/
│   ├── ui/                  # design-system primitives
│   ├── dashboard/  leads/  search/  settings/  layout/
├── lib/
│   ├── api/                 # route wrapper: auth, CSRF, validation, errors
│   ├── auth/                # sessions, login/logout actions
│   ├── crawler/             # SSRF-safe fetcher, robots.txt, page walker
│   ├── db/  email/  filters/  dedupe/  scoring/  reviews/
│   ├── providers/           # business/ + email/ abstractions
│   ├── security/            # SSRF policy, crypto, rate limiting
│   └── settings/
├── server/                  # use cases: leads, search, jobs, exports, imports,
│                            # dashboard — no React, no HTTP
├── types/                   # shared contracts (filters, settings, rows)
└── middleware.ts            # route protection + security headers
```

Two rules hold throughout:

1. **Business logic never lives in a component.** Pages and components render;
   `src/server/*` and `src/lib/*` decide.
2. **One definition per concept.** Filtering, scoring and the bad-review rule
   each exist in exactly one module, used by search, the lead list, the
   dashboard and exports alike.

### API surface

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/leads` | List leads; filters as query parameters. |
| `POST` | `/api/leads` | Create a lead manually (duplicate detection applies). |
| `POST` | `/api/leads/query` | List leads with a structured filter object. |
| `GET` `PATCH` `DELETE` | `/api/leads/:id` | Read, edit, permanently delete a lead. |
| `POST` `DELETE` | `/api/leads/:id/notes` | Add / remove a note. |
| `POST` | `/api/leads/bulk` | Bulk status change, bulk delete, delete-all-filtered. |
| `POST` | `/api/search` | Queue a discovery job → `202 { searchRunId }`. |
| `GET` `DELETE` | `/api/search/:id` | Live job counters; delete a run from history. |
| `POST` | `/api/email/find` | Queue bulk public-email discovery → `202 { jobId }`. |
| `POST` | `/api/email/verify` | Verify one lead's primary address. |
| `GET` | `/api/jobs/:id` | Background job progress. |
| `GET` `POST` | `/api/export` | Download CSV / XLSX / JSON. |
| `POST` | `/api/import` | `mode: "preview"` then `mode: "commit"`. |
| `GET` `PATCH` | `/api/providers` | Provider selection and encrypted API keys. |
| `GET` `PATCH` | `/api/settings` | Read / write a settings section. |
| `GET` `POST` | `/api/saved-searches` | List / create saved searches. |
| `PATCH` `DELETE` | `/api/saved-searches/:id` | Rename, re-filter, delete. |
| `GET` | `/api/health` | Unauthenticated liveness probe. |

Every request body, query and settings write is validated with Zod, and every
response uses the same `{ ok, data | error }` envelope.

### Filter engine

`src/lib/filters/engine.ts` exposes the same semantics twice:

- `toPrismaWhere(filters)` — SQL, for the lead list, dashboard and exports.
- `matchesFilters(record, filters)` — in-memory, applied to freshly discovered
  provider records **before** they are stored.

That is why the "687 match your filters" counter during a search agrees with
what the lead list then shows. The filter object is one Zod schema
(`src/types/filters.ts`) and is what saved searches persist.

---

## Provider abstraction

Nothing above the provider layer knows which vendor answered.

```ts
interface BusinessDataProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  isConfigured(): boolean;
  searchBusinesses(params, pageToken?): Promise<BusinessSearchPage>;
  getBusinessDetails(externalId): Promise<NormalizedBusiness | null>;
  getBusinessReviews(externalId): Promise<ProviderReview[]>;
}
```

```
src/lib/providers/
├── business/
│   ├── BusinessDataProvider.ts   # contract + ProviderError
│   ├── GooglePlacesProvider.ts   # Places API (New), API-key based
│   ├── MockBusinessProvider.ts   # offline, deterministic
│   └── mock-data.ts
├── email/
│   ├── EmailFinderProvider.ts    # findEmails() / verifyEmail() contracts
│   ├── WebsiteEmailFinder.ts
│   ├── MockEmailFinder.ts
│   └── EmailVerificationProvider.ts
├── http.ts                       # timeouts, bounded retry, backoff
└── registry.ts                   # selection + decryption, server-only
```

Adding DataForSEO, SerpApi, Outscraper or Apify means writing one class and
adding it to `AVAILABLE_PROVIDERS`. No UI or application change.

**Provider failures never crash a page.** `ProviderError` carries an
operator-safe message; the technical detail is logged server-side. A failed
search shows *"Business data provider temporarily unavailable"* with a Retry
button, and the run is recorded as `FAILED` with its counters intact.

---

## Review intelligence

`badReviewCount` is the sum of the star buckets the operator flagged as bad in
**Settings → Review Rules** — 1★ + 2★ by default, changeable to include 3★.
Changing it recalculates every stored lead.

```
Total reviews: 247
1★: 18   2★: 13   3★: 27   4★: 51   5★: 138
Bad reviews: 31        Bad review percentage: 12.55%
```

**Counts are never invented.** When a source supplies only an average and a
total — which is the case for the Google Places API — `ratingBreakdown` is
`null`, `reviewBreakdownAvailable` is `false`, the table shows `n/a`, and the
lead page says:

> Review details unavailable from current data source.

---

## Lead scoring

Rules are data, stored in settings, and fully editable in the UI:

| Rule | Points |
|---|---|
| Rating ≤ 4.0 | +25 |
| Rating ≤ 3.7 | +15 |
| Review count ≥ 100 | +20 |
| Review count ≥ 300 | +10 |
| Bad review percentage ≥ 10% | +20 |
| Public email available | +10 |
| Website available | +5 |
| Phone available | +5 |

Each lead stores the breakdown that produced its score, so the detail page can
show exactly which rules fired and which did not:

```
Lead Score: 85/100

Why?
Rating ≤ 4.0                  Rating 3.8          +25
Review count ≥ 100            247 reviews         +20
Bad review percentage ≥ 10%   12.6% bad reviews   +20
Public email available        contact@…           +10
Website available             Website available    +5
Phone available               Phone available      +5
```

Saving new rules re-scores every stored lead and reports how many changed.

---

## Email discovery

Only **publicly available business contact information**, read from pages the
business itself publishes.

```
Business → website → homepage → contact → about → legal/imprint → footer links
        → extraction → normalisation → deduplication → (optional) verification
```

- Generic business mailboxes (`contact@`, `info@`, `bonjour@`, `hello@`,
  `office@`, `commercial@`, `direction@`, …) are preferred and rank highest.
- An address on the business's own domain outranks a free consumer mailbox.
- `noreply@`, mailer daemons, template placeholders and analytics identifiers
  are discarded.
- **No permutation guessing.** `first.last@domain` is never constructed.
- Every stored address keeps `emailSource` and the exact `emailSourceUrl` it was
  read from — visible on the lead page and included in exports.

Statuses: `UNKNOWN`, `FOUND`, `VALID`, `INVALID`, `RISKY`, `DISPOSABLE`.

With no verifier configured the UI says **"Verification unavailable"**. It does
not claim an address is valid. The bundled `syntax` verifier screens malformed
addresses and disposable domains and reports a well-formed address as `FOUND`,
never `VALID`, because nothing local proves a mailbox exists.

---

## Website crawler

Defaults: **5 pages per domain**, **10 s timeout**, 2 MB response cap, 3
redirects, 500 ms between requests — all configurable in **Settings → Crawler**.

- Same registrable domain only; contact/legal/about pages are visited first.
- `robots.txt` is parsed and obeyed, including `Crawl-delay`.
- Responses are size-capped **while streaming**.
- It never submits forms, never follows links behind authentication, and never
  attempts to defeat a bot protection. A 403 is recorded as a 403.

---

## Background jobs

Business discovery and bulk email work never run inside the HTTP request.

```
POST /api/search  →  202 { searchRunId }   (returns immediately)
GET  /api/search/:id  →  live counters
```

```
Search running…
1,247 businesses discovered
  934 unique
  312 duplicates
  687 match your filters
```

Bulk email discovery is the same shape (`POST /api/email/find` → `jobId`,
polled via `/api/jobs/:id`) and reports `processed / total`, found and not
found while it runs.

### Duplicate detection

1. `provider` + `externalId` when the source supplies one.
2. A deterministic `dedupeKey` over normalised name + address + postal code +
   phone/domain.
3. A looser normalised-name + normalised-phone probe.

Names are normalised past accents and legal forms (`SARL`, `SAS`, `GmbH`, …) and
phone numbers past formatting, so `Cabinet Dupont SARL` / `+33 1 23 45 67 89`
and `cabinet dupont` / `01 23 45 67 89` collapse to one business. A duplicate
refreshes the review and score signals but never overwrites your status, notes
or a discovered email.

---

## Export & import

**Export** — CSV, XLSX or JSON, for the current selection, the current filters
or every lead. Column order is fixed across all three formats:

`Business Name, Category, Country, Region, City, Postal Code, Address, Phone,
Website, Rating, Review Count, 1 Star Reviews, 2 Star Reviews, Bad Review Count,
Bad Review Percentage, Email, Email Status, Email Source, Email Source URL,
Lead Score, Lead Status, Source URL, Created At`

CSV is written with a UTF-8 BOM (accented business names survive Excel), a
configurable delimiter (`;` for French Excel), and leading `=`/`+`/`-`/`@` are
neutralised against spreadsheet formula injection.

**Import** — upload a CSV, review the auto-detected column mapping against a
live preview, then commit. Duplicate detection runs on every row; nothing is
written before you confirm.

---

## Security

| Concern | Implementation |
|---|---|
| Authentication | Database-backed sessions; only the SHA-256 hash of the token is stored. Signed JWT in an **HTTP-only**, `SameSite=Lax`, `Secure`-in-production cookie. |
| Passwords | scrypt with a per-user salt. Never stored in plain text. Unknown users still run a verification so the timing profile stays flat. |
| Route protection | Edge middleware gates every page; `getCurrentUser()` re-checks the session row and the account's active flag server-side. |
| CSRF | Same-origin check plus a double-submit cookie token on every mutating verb. |
| Input validation | Zod on every API body, query and settings write. |
| SQL injection | Prisma parameterised queries throughout. |
| XSS | React escaping; no `dangerouslySetInnerHTML` anywhere. |
| Secret handling | Provider API keys encrypted at rest (AES-256-GCM). `src/lib/env.ts` and the registry are `server-only`, so importing them from a client component is a build error. |
| Headers | CSP, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, COOP, HSTS in production. |
| Rate limiting | Per-user sliding windows on search, email discovery, verification, export and import; 10 login attempts per IP per 5 minutes. |
| Request size | 8 MB body ceiling on mutating API routes. |
| **SSRF** | See below. |

### SSRF protection

The crawler fetches operator-supplied URLs, so every request is proven to target
a public internet host before a socket opens:

- Scheme must be `http:`/`https:`; credentials in the URL are refused.
- Hostnames such as `localhost`, `*.local`, `*.internal`, `metadata.google.internal`
  are refused outright, plus any host on the operator's blocklist.
- **Every resolved address is checked** — loopback, `10/8`, `172.16/12`,
  `192.168/16`, `169.254/16` (including `169.254.169.254`), carrier-grade NAT,
  multicast, IPv6 unique-local/link-local and IPv4-mapped forms.
- **Redirects are followed manually and re-validated at every hop**, so a public
  URL that redirects to a metadata endpoint is stopped at the redirect.

This is covered by `npm test`.

---

## Cost control

Provider APIs charge per request, so limits are enforced server-side and are
visible before you spend anything. The search page shows an estimate up front:

```
Estimated provider usage
Provider     Google Places API
Businesses   100
Requests     ≈ 5
Cost         ≈ 0.40 EUR
```

Configurable in **Settings → Cost control**: maximum businesses per search,
searches per day, email lookups per day, verification requests per day, and the
per-record cost used for the estimate. Daily counters live in the database, are
reserved atomically before work starts, and unused reservations are released.

---

## Data protection

Murgay prospects in France and Belgium, so the platform provides the technical
controls an operator needs — it does not, and cannot, assert compliance on your
behalf.

- **Provenance on every record**: data source, collection timestamp, purpose,
  source URL, and for each email the exact public page it came from.
- **Erasure**: delete one lead, delete the selection, or delete everything
  matching the current filters. Deletion is permanent and cascades to reviews,
  emails, notes and activity.
- **Portability**: export any subset as CSV, XLSX or JSON.
- **Minimisation**: only business contact information is collected; the crawler
  reads public pages only and personal mailboxes are never targeted or guessed.

---

## Connecting a live provider

1. **Settings → Data Providers** → choose *Google Places API* → paste the key →
   Save. (Or set `BUSINESS_DATA_PROVIDER` / `BUSINESS_DATA_API_KEY`.)
2. **Settings → Email Providers** → *Website crawler* needs no key. Choose a
   verification provider if you have one.
3. Review **Settings → Cost control** before the first live search.

Note the honest limitation: the Places API returns an average rating and a total
review count, but **not** a star distribution. With it selected, bad-review
columns show `n/a` rather than a guess. A provider that supplies a full
breakdown (DataForSEO, Outscraper, …) restores those columns — the abstraction
is already in place.

---

## Testing

```bash
npm run lint       # ESLint, zero warnings
npm run typecheck  # strict TypeScript
npm test           # logic tests
npm run build      # production build
```

`npm test` covers the parts where a silent mistake would be expensive:

- SSRF policy — private/loopback/link-local/metadata ranges, IPv4-mapped IPv6,
  URL-credential and scheme refusals, the operator blocklist.
- Public email extraction — obfuscation (`[at]`, `(dot)`, `arobase`), `mailto:`
  priority, script/style stripping, `noreply@` and placeholder rejection.
- Review statistics — the configurable bad-review definition, and the guarantee
  that a missing breakdown yields no invented counts.
- Lead scoring — the worked example above, and the cap at `maxScore`.
- Filter engine — ranges, presence filters, and that a null rating never
  satisfies a rating range.
- Duplicate detection — accents, legal forms and phone formats collapsing.
- robots.txt — `Disallow`/`Allow` precedence, wildcards, `Crawl-delay`.

---

## Design notes

Desktop-first, dense but readable, no gimmicks. Skeleton loaders, empty states,
error states with retry, toasts, confirmation dialogs on destructive actions,
and keyboard-reachable controls throughout. Lead-list state — filters, sort,
page — lives in the URL, so every view is shareable and back-button friendly.

The chart palette is not eyeballed. The five categorical series colours were
validated for lightness banding, chroma floor, colour-vision-deficiency
separation, normal-vision separation and surface contrast, in **both** light and
dark; the dark steps are chosen against the dark surface rather than flipped
from the light ones. Charts use one measure per axis — there are no dual-axis
charts anywhere.

---

## What is deliberately not here

**No AI.** No OpenAI, Claude or Gemini calls; no generated summaries; no opaque
score. Everything is APIs, database, rules, filters, crawling and extraction. AI
can be added later — the scoring and review layers are already isolated behind
clean interfaces.

**Nothing that defeats a technical protection.** No CAPTCHA or anti-bot bypass,
no authentication bypass, no scraping behind a login, no evasion of provider
restrictions, no private-data extraction. Business data comes from an approved,
API-based source; email discovery reads only what a business publishes itself.

**No premature scope.** Campaign management, email sending, CRM features,
webhooks, multi-user workspaces, billing and Stripe are not implemented. The
schema and provider seams were designed so they can be, without a rewrite: the
`User` model and ownership columns already exist, jobs are persisted rows rather
than in-memory state, and every external integration sits behind an interface.
