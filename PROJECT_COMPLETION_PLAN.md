# YatraAI Project Completion Plan

Use this file as the single source of truth until the project is finished. Do not expand scope unless every item in the MVP checklist is already done.

## Final Goal

Ship a stable MVP of YatraAI:

> A user can sign in, open the dashboard, see Nepal destinations with safety/weather context, check route details, receive hazard notifications, and create a simple trip plan.

Everything else is bonus.

## Golden Rule

If a feature does not help the demo story below, freeze it.

Demo story:

1. User lands on the app.
2. User signs in or registers.
3. User opens the dashboard.
4. User chooses or enables their location.
5. User sees destination cards with safety level and live/weather data.
6. User opens a route modal for a destination.
7. User sees hazard notifications.
8. User plans a trip.
9. User can view their trip.

## Current Project Status

Known good:

- TypeScript passes with `npx tsc --noEmit`.
- Most tests pass: `140/142` passed when checked.
- Core app structure is strong.
- Dashboard, destinations, route modal, notifications, trip planning, admin, auth, and routing already exist.

Known blockers:

- `npm run lint` fails because ESLint 9 needs `eslint.config.js`.
- `npm run build` fails in restricted/offline environments because `next/font/google` fetches Google fonts.
- README says `npm test`, but `package.json` does not currently define a `test` script.
- AI tests are outdated relative to the current AI client provider behavior.
- There are many uncommitted changes and deleted files; avoid broad cleanup until the MVP is stable.

## MVP Scope

Must finish:

- Authentication happy path.
- Dashboard happy path.
- Destination cards.
- Location selection or permission-denied fallback.
- Route details modal.
- Hazard notification bell and panel.
- Trip planning happy path.
- Basic profile/settings only if required by auth or trip flow.
- Production build.
- Deployment documentation.

Freeze for now:

- Advanced admin polish.
- Perfect routing graph generation.
- Full AI provider perfection.
- Social/friends polish beyond basic stability.
- Advanced SOS flows unless already reliable.
- Large visual redesigns.
- Big refactors.

## Exact Completion Checklist

### 1. Stabilize Developer Commands

- Add a real `test` script to `package.json`.
- Fix lint config for ESLint 9 or pin ESLint config correctly.
- Keep these commands green:
  - `npx tsc --noEmit`
  - `npm test`
  - `npm run lint`
  - `npm run build`

Acceptance:

- A fresh developer can run the commands listed above without guessing.

### 2. Fix Build Blockers

- Replace `next/font/google` remote dependency or vendor fonts locally.
- Confirm `app/layout.tsx` does not require network access during build.
- Run `npm run build`.

Acceptance:

- Production build completes successfully.

### 3. Fix AI Test Mismatch

- Decide whether the app uses `zai`, `ollama`, `groq`, `gemini`, or `claude` as default.
- Make `lib/ai/client.ts` read provider settings in a testable way.
- Update `lib/__tests__/ai/client.test.ts` to match current provider response formats.
- Keep AI failures graceful: the app should not crash if no AI provider is configured.

Acceptance:

- All tests pass.
- Missing AI keys degrade safely.

### 4. Lock Dashboard Happy Path

Focus files:

- `app/dashboard/page.tsx`
- `app/dashboard/_components/DestinationCard.tsx`
- `app/dashboard/_components/NotificationBell.tsx`
- `app/dashboard/_components/NotificationPanel.tsx`
- `app/dashboard/_components/LocationPicker.tsx`
- `app/dashboard/_components/SafetyMap.tsx`

Tasks:

- Dashboard loads without crashing.
- Empty state is clear when no destinations exist.
- Loading state is visible and not stuck forever.
- Error state has a retry button.
- Location denied state explains what to do.
- Manual location picker works.
- Destination filter/search works enough for demo.
- Saved destination toggle does not visually lie if API fails.

Acceptance:

- Dashboard can be used for 5 minutes without console-breaking errors.

### 5. Finish Destination Cards

Focus file:

- `app/dashboard/_components/DestinationCard.tsx`

Tasks:

- Card displays destination name, district, province, altitude if available.
- Card displays safety level clearly.
- Weather area handles loading, success, and unavailable states.
- Save button works or gracefully rolls back.
- Details link points to the correct destination page.
- Plan Trip button routes correctly.
- Route button appears only when route data exists.

Acceptance:

- At least 6 destination cards look good and behave correctly.

### 6. Finish Route Modal

Focus files:

- `components/route-modal.tsx`
- `components/route-map-mini.tsx`
- `app/api/routes/route.ts`
- `lib/routing/*`

Tasks:

- Modal opens reliably from a destination card.
- Modal closes with close button, backdrop, and Escape.
- Map loads without server-side rendering errors.
- Route path is readable.
- Distance and duration display correctly.
- If route data is missing, show a useful message instead of crashing.

Acceptance:

- Demo route from current/manual location to one destination works.

### 7. Finish Notifications

Focus files:

- `app/dashboard/_components/NotificationBell.tsx`
- `app/dashboard/_components/NotificationPanel.tsx`
- `app/api/notifications/route.ts`
- `app/api/notifications/[id]/read/route.ts`
- `app/api/notifications/read-all/route.ts`

Tasks:

- Bell fetches notifications.
- Bell shows unread count.
- Panel opens and closes cleanly.
- Mark one as read works.
- Mark all as read works.
- Empty notification state looks intentional.
- API failures do not crash the dashboard.

Acceptance:

- Notification demo works with at least one hazard notification.

### 8. Finish Trip Planning Happy Path

Focus files:

- `app/plan/page.tsx`
- `app/plan/[destinationId]/analysis/page.tsx`
- `app/trips/page.tsx`
- `app/trips/new/page.tsx`
- `app/trips/[id]/page.tsx`
- `app/api/plan/route.ts`
- `app/api/trips/route.ts`

Tasks:

- User can start trip planning from dashboard.
- Destination is prefilled when coming from a card.
- User can enter date/budget/basic details.
- Plan generation handles AI unavailable state.
- User can save a trip.
- User can view saved trip.

Acceptance:

- One complete trip can be created and opened during demo.

### 9. Stabilize Auth

Focus files:

- `app/sign-in/page.tsx`
- `app/register/page.tsx`
- `app/forgot-password/page.tsx`
- `app/api/auth/[...all]/route.ts`
- `lib/auth.ts`
- `lib/auth-client.ts`

Tasks:

- Register works.
- Sign in works.
- Sign out works.
- Protected pages redirect correctly.
- OAuth is either working or hidden from the demo.
- Forgot password works or is marked unavailable.

Acceptance:

- Demo user can sign in and reach dashboard.

### 10. Stabilize Data and Database

Focus files:

- `prisma/schema.prisma`
- `prisma/migrations/*`
- `scripts/ensure-db.mjs`
- seed scripts in `scripts/`

Tasks:

- Confirm local database setup steps.
- Confirm migrations run.
- Confirm seed data exists for demo destinations.
- Confirm required services: PostgreSQL/PostGIS, OSRM, Nominatim if needed.
- Write exact setup commands in README or deployment docs.

Acceptance:

- Fresh setup can produce enough data for dashboard and route demo.

### 11. Polish User Experience

Tasks:

- Add clear loading skeletons where slow APIs exist.
- Add retry buttons where fetches fail.
- Remove broken or unused buttons from MVP screens.
- Make mobile layout usable enough.
- Check dark theme contrast.
- Check no modal traps the user.
- Check all primary CTAs have obvious labels.

Acceptance:

- A first-time user knows what to click next.

### 12. Deployment Readiness

Focus files:

- `docs/deployment.md`
- `.env.example`
- `next.config.ts`
- `package.json`

Tasks:

- List required environment variables.
- Separate required vs optional API keys.
- Confirm production database URL.
- Confirm image host allowlist.
- Confirm cron route secret.
- Confirm deployment command.
- Confirm build command.

Acceptance:

- You can deploy without relying on memory.

## One-Week Schedule

### Day 1: Make the Project Measurable

- Fix scripts: test, lint, build.
- Run TypeScript, tests, lint, build.
- Write down failures.
- Do not add features.

Done when:

- You know exactly which checks pass and fail.

### Day 2: Dashboard Stability

- Fix dashboard loading/error/empty states.
- Fix location fallback.
- Verify destination cards.
- Verify saved destination behavior.

Done when:

- Dashboard feels usable even with imperfect data.

### Day 3: Routes and Notifications

- Verify route API.
- Verify route modal.
- Verify notification API.
- Verify mark-read behavior.

Done when:

- User can open a route and interact with alerts.

### Day 4: Trip Planning

- Verify dashboard to plan flow.
- Verify plan page.
- Verify save trip.
- Verify trips page.

Done when:

- User can create one trip from one destination.

### Day 5: Auth and Data

- Verify register/sign-in/sign-out.
- Verify protected routes.
- Verify seed data.
- Verify database setup commands.

Done when:

- A fresh demo account can use the MVP.

### Day 6: Production Rehearsal

- Run full checks.
- Run production build.
- Deploy or simulate deploy.
- Fix only deployment blockers.

Done when:

- The app builds and the MVP flow works outside dev assumptions.

### Day 7: Demo and Buffer

- Prepare demo account.
- Prepare demo route.
- Prepare backup screenshots.
- Fix final visible bugs.
- Stop adding features.

Done when:

- You can present the app calmly.

## Final Demo Script

Use this exact script:

1. Open landing page.
2. Sign in.
3. Open dashboard.
4. Set location manually if browser GPS is unreliable.
5. Search or filter destinations.
6. Explain safety level on a destination card.
7. Open route modal.
8. Explain route path and safety context.
9. Open notification bell.
10. Mark a hazard notification as read.
11. Click Plan Trip.
12. Create/save a trip.
13. Open Trips page and show saved trip.

## Definition of Done

The project is complete when:

- `npx tsc --noEmit` passes.
- `npm test` passes.
- `npm run lint` passes or lint exceptions are documented.
- `npm run build` passes.
- MVP demo script works from start to finish.
- Required environment variables are documented.
- Known limitations are listed honestly.
- No major page in the demo crashes.

## Known Limitations to Mention Honestly

Use these if asked:

- Route intelligence is strongest for seeded Nepal routes and may degrade outside supported areas.
- AI-generated explanations depend on configured provider availability.
- Hazard data freshness depends on ingestion schedule and external data sources.
- Some admin/social features are present but not the MVP focus.

## Do Not Do This Week

- Do not redesign the whole app.
- Do not rewrite routing from scratch.
- Do not perfect every admin page.
- Do not add new AI providers.
- Do not add new social features.
- Do not chase every console warning.
- Do not delete large sets of files unless you are certain they are unused.
- Do not start a new feature after Day 5.

## Emergency Triage Order

If time is running out, fix in this order:

1. Build failure.
2. Sign-in failure.
3. Dashboard crash.
4. Missing demo data.
5. Route modal crash.
6. Trip save failure.
7. Notification read failure.
8. Visual polish.

## Daily Routine

At the start of each day:

1. Read this file.
2. Pick only today’s section.
3. Run the smallest relevant check.
4. Fix one blocker at a time.
5. Commit or save a clear checkpoint.

At the end of each day:

1. Run `npx tsc --noEmit`.
2. Write what still fails.
3. Do not continue endlessly at night unless it is a build blocker.

## Final Reminder

This project is already good enough to become a strong MVP. The task now is not to prove how much it can contain. The task is to make one clean story work reliably.

