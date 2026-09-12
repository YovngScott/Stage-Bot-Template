# Instagram: implementation and release gates

## Implemented in this release

- Existing Stage Instagram Login connection retained, explicitly limited to the Stage tenant.
- Per-tenant Facebook Page/Instagram connection, validated against Meta and encrypted server-side. No tokens returned by connection status.
- Authenticated connection/rule administration. Connection and rules tables are service-role only, with RLS enabled.
- Shared callback `/api/meta/instagram/webhook` routes normal messages by connected account; dedicated legacy callback also hydrates sparse edits.
- Text, first image and first audio attachment processing. Bounded downloads, HTTPS Meta CDN allowlist, redirect rejection, MIME checks, provider timeouts.
- Unicode keyword matching, exact or whole phrase, first enabled match; scoped to each tenant. No AI call for matching text replies.
- Existing consent, human handoff, usage limits and tenant instructions retained. Output guard also applied before Instagram sends.
- Desktop/mobile connection workspace with inline keyword rules. Isolated QA harness does not bypass production authentication and is excluded from Docker.

## Verified locally

- Backend TypeScript check and 49 automated tests.
- Dashboard TypeScript check and production build.
- Isolated rendered component at 1440 and 390 px: form save, labels, focus, no horizontal overflow or JS errors. This is not an authenticated end-to-end customer login test.
- Production database tables have RLS enabled and no anon/authenticated table access.
- Restricted `record_tenant_usage` to service_role and fixed its search_path; verified anonymous/customer execution denied and server execution retained.

The project-wide advisor also reports pre-existing SECURITY DEFINER analytics views, other mutable function search paths and disabled leaked-password protection. These are not a clean project-wide security bill of health. Review the [view advisory](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view) before external customer release. New Instagram tables intentionally have no client RLS policies because only the authenticated backend accesses them with service_role.

## Mandatory before enabling customer onboarding

1. Configure the **parent Facebook app** `META_APP_ID` and `META_APP_SECRET` on the callback host and each tenant backend. The Instagram child app secret is not interchangeable. Preserve `CREDENCIALES_SECRET` across deploys; never rotate without migrating ciphertext.
2. Configure Facebook Login web SDK domains and the Instagram webhook callback for Facebook Login in Meta. Subscribe the relevant Instagram fields in the app dashboard. The existing Stage Instagram Login callback remains unchanged.
3. Obtain the applicable Advanced Access/App Review approval for external customer accounts, including business/access verification where Meta requires it. Published alone does not prove external onboarding authorization. Do not make irreversible Tech Provider declarations without the business owner's decision.
4. Validate the actual login flow with a second tenant, page permissions, token expiry/revocation and fresh real DMs, image and voice messages. No live media latency or end-to-end customer onboarding guarantee has been established.

## Remaining product work (not claimed complete)

- Comment/reel-specific triggers, media picker and private comment replies.
- Shared-callback sparse edit routing, durable background jobs and automatic retry/recovery after process termination. Current normal webhook work is acknowledged before background processing; persistent inbound dedupe alone is not a durable queue.
- Long-lived token exchange/renewal and revocation lifecycle, disconnect/reconnect UX, pagination for businesses with over 100 Pages.
- Facebook sign-in to the Stage/Supabase account itself is separate from the channel's Facebook consent flow.
- Business-scoped AI evaluation for multiple industries. Existing general-topic guards are not a guarantee that every off-topic question is rejected.

Do not advertise this release as fully production-ready for arbitrary customers until these gates have been completed and measured.
