# YatraAI 90% Completion Roadmap

This file describes what “90% complete” means for YatraAI if time is not the main constraint. The goal is not to endlessly add features. The goal is to make YatraAI reliable, explainable, useful, deployable, maintainable, and demo-proof.

## What 90% Complete Means

YatraAI is 90% complete when:

- A real user can use it without developer help.
- The main flows work in production, not only locally.
- Failures are graceful and understandable.
- Data pipelines can be rerun safely.
- Routing and safety results are explainable.
- Admin tools can correct bad data.
- Tests cover the dangerous parts.
- Deployment is repeatable.
- The app has a clear product identity.

90% complete does not mean:

- Every possible feature exists.
- Every edge case is perfect.
- Every destination in Nepal has perfect data.
- AI is always available.
- Routing is as complete as Google Maps.

## Product North Star

YatraAI should answer this question:

> “Is this trip in Nepal safe for me right now, and what should I watch out for?”

Everything should support that.

## Final Product Pillars

### 1. Destination Intelligence

Users should understand where they can go and why a place is safe or risky.

Must have:

- Destination list with search/filter.
- Destination detail page.
- Safety score and level.
- Weather context.
- Hazard context.
- Altitude and terrain context.
- Best season or travel window.
- Nearby alternatives.
- Save destination.
- Admin correction for bad destination data.

90% acceptance:

- At least 100 high-quality Nepal destinations are usable.
- Each destination has name, district, province, coordinates, category, safety level, and useful description.
- Bad coordinates can be detected and fixed.
- Safety level has visible explanation, not only a label.

### 2. Route Intelligence

Users should understand route options, risks, and tradeoffs.

Must have:

- Route from user/manual origin to destination.
- Route modal with map.
- Distance and duration.
- Major road/place chain.
- Per-route risk summary.
- Hazard overlap along route.
- Fallback route when external API fails.
- Clear unavailable state.

90% acceptance:

- Common Nepal routes work reliably.
- Route output explains why it is safe/risky.
- If route intelligence is incomplete, the UI says so honestly.
- App never crashes because route data is missing.

### 3. Hazard and Disaster Intelligence

Users should know what is happening now or recently.

Must have:

- Disaster ingestion pipeline.
- Hazard database.
- User-facing alerts.
- Notification bell.
- Mark read/read all.
- Hazard reports from users.
- Admin verification/moderation.
- Cron or scheduled refresh.

90% acceptance:

- Recent hazards appear in the system.
- Duplicate hazard data is handled.
- Users near or interested in affected areas can be notified.
- Admin can verify, reject, edit, or delete hazard reports.

### 4. Personalization

Users should get advice that fits their profile.

Must have:

- User profile.
- Home/current location.
- Health preferences or constraints.
- Saved destinations.
- Completed trips.
- Basic behavior tracking for recommendations.
- Recommended destinations.

90% acceptance:

- Recommendations change based on user context.
- Health or accessibility constraints influence warnings.
- User can update personal information easily.

### 5. Trip Planning

Users should turn a destination into an actionable trip.

Must have:

- Create trip.
- Destination search.
- Origin selection.
- Dates.
- Budget.
- Members or solo trip mode.
- AI/non-AI plan generation.
- Save plan.
- View trip.
- Update trip status.

90% acceptance:

- User can create, save, view, and update a trip.
- Trip planning works even when AI provider fails.
- Saved trips have enough information to be useful later.

### 6. Emergency and Safety Actions

Users should be able to act during unsafe situations.

Must have:

- Emergency contacts.
- SOS alert creation.
- Emergency numbers page.
- Location sharing.
- Clear safety guidance.

90% acceptance:

- User can add emergency contacts.
- User can trigger SOS or safety alert.
- Location sharing works with a link.
- Emergency features fail safely and clearly.

### 7. Admin and Data Stewardship

Admin should be able to keep the system trustworthy.

Must have:

- Admin auth guard.
- User management.
- Destination management.
- Hazard management.
- Route node/edge management.
- Report moderation.
- Audit logs.
- Analytics dashboard.

90% acceptance:

- Admin can fix bad public data without touching the database manually.
- Sensitive admin pages are protected.
- Important admin actions are logged.

### 8. Reliability and Deployment

The app should run outside your laptop.

Must have:

- Production build.
- Environment variable documentation.
- Database migration path.
- Seed/demo data path.
- Deployment guide.
- Cron setup.
- External service fallback behavior.
- Health endpoint.

90% acceptance:

- Fresh deployment can be reproduced from docs.
- Missing optional API keys do not destroy the whole app.
- Required API keys are clearly documented.
- Build, test, and lint commands are reliable.

## Recommended Build Order

Do not build by excitement. Build by dependency.

### Phase 1: Foundation

Goal:

- Make the project measurable and stable.

Tasks:

- Fix `npm test`.
- Fix `npm run lint`.
- Fix `npm run build`.
- Fix font build dependency.
- Fix AI test mismatch.
- Document required services.
- Clean up package scripts.

Done when:

- TypeScript, tests, lint, and build are green.

### Phase 2: Data Foundation

Goal:

- Make destinations, hazards, and routes trustworthy enough.

Tasks:

- Audit destination schema.
- Audit seed data.
- Validate coordinates.
- Ensure migrations run cleanly.
- Create repeatable seed process.
- Document DB reset/setup.
- Add admin correction flows where missing.

Done when:

- A fresh database can support the dashboard demo.

### Phase 3: User MVP

Goal:

- Make the main user story excellent.

Tasks:

- Auth happy path.
- Dashboard happy path.
- Destination card polish.
- Location picker.
- Route modal.
- Notification panel.
- Trip planning.
- Trips page.

Done when:

- A user can complete the final demo script without developer help.

### Phase 4: Explainability

Goal:

- Make safety/routing decisions understandable.

Tasks:

- Explain destination safety score.
- Explain route risk.
- Show hazard contribution.
- Show weather contribution.
- Add “data last updated” labels.
- Make degraded states visible.

Done when:

- Users understand why the app recommends or warns.

### Phase 5: Safety and Emergency

Goal:

- Make safety actions reliable.

Tasks:

- Emergency contacts.
- SOS flow.
- Location sharing.
- Emergency numbers.
- Notification delivery.
- Email/SMS fallback if available.

Done when:

- Emergency flows are tested and cannot silently fail.

### Phase 6: Admin Reliability

Goal:

- Make the app maintainable without code changes.

Tasks:

- Admin destination CRUD.
- Admin hazard CRUD.
- Hazard report moderation.
- Route graph correction.
- User management.
- Audit logs.
- Analytics.

Done when:

- Bad public data can be corrected from the UI.

### Phase 7: Production Hardening

Goal:

- Make the production app boring in the best way.

Tasks:

- Add monitoring/logging.
- Add rate limits to risky APIs.
- Add input validation everywhere.
- Add error boundaries.
- Add API error format consistency.
- Add loading/empty/error states to all MVP pages.
- Add security checks for protected APIs.

Done when:

- Common failures are handled without crashes or data leaks.

### Phase 8: Quality and Polish

Goal:

- Make it feel finished.

Tasks:

- Mobile responsiveness.
- Accessibility pass.
- Copywriting pass.
- Visual consistency.
- Remove dead buttons.
- Remove unused pages from navigation.
- Add onboarding guidance.
- Add helpful empty states.

Done when:

- A first-time user understands the app quickly.

## Testing Strategy

### Unit Tests

Prioritize:

- Safety scoring.
- Route risk scoring.
- Hazard deduplication.
- AI fallback behavior.
- Data validation.
- Cache behavior.

### Integration Tests

Prioritize:

- Dashboard API.
- Notifications API.
- Routes API.
- Trips API.
- Auth-protected endpoints.

### Manual Test Scripts

Keep scripts for:

- New user onboarding.
- Dashboard route check.
- Hazard notification read flow.
- Trip creation.
- SOS/location sharing.
- Admin hazard moderation.

## Quality Bar by Area

### UI

- No stuck loading states.
- No blank pages.
- No primary button that does nothing.
- No modal without escape/close path.
- No unreadable text.

### API

- Validate inputs.
- Return useful errors.
- Avoid leaking stack traces.
- Require auth where needed.
- Fail gracefully when external services are down.

### Database

- Migrations are ordered and documented.
- Seed process is repeatable.
- Important models have constraints.
- Dangerous deletes are protected.

### AI

- AI is optional, not a single point of failure.
- Non-AI fallback exists for trip planning and explanations.
- Provider errors are logged but not shown raw to users.
- Prompts use structured facts, not random page state.

### Routing

- Coordinates are validated.
- Outside-Nepal requests are handled clearly.
- Missing route data shows degraded output.
- Route naming is understandable.

## Feature Completion Matrix

Use these labels:

- `0%` not started.
- `30%` UI exists but unreliable.
- `60%` happy path works.
- `80%` errors/fallbacks handled.
- `90%` production-ready enough.

Track these:

- Auth:
- Dashboard:
- Destination cards:
- Destination detail:
- Location picker:
- Route modal:
- Route API:
- Hazard ingestion:
- Notifications:
- Hazard reporting:
- Trip planning:
- Trips page:
- Emergency contacts:
- SOS:
- Location sharing:
- Admin destinations:
- Admin hazards:
- Admin users:
- Admin audit logs:
- Deployment:
- Tests:
- Documentation:

## What to Stop Doing

Stop:

- Adding new feature ideas before stabilizing existing ones.
- Rewriting whole systems when one small fix works.
- Treating AI as required for every flow.
- Chasing perfect routing before the UI can explain degraded routing.
- Keeping broken buttons visible.
- Building admin polish before user flow works.
- Working without a daily acceptance target.

## What to Do Every Week

Every week:

1. Pick one pillar.
2. Define one user story.
3. Make it work end-to-end.
4. Add fallback/error state.
5. Add or update tests.
6. Update docs.
7. Run full checks.

Example:

> “This week, a user can create a trip from a destination card and view it later.”

That is better than:

> “This week, improve planning.”

## Long-Term Ideal Demo

A strong final demo should look like this:

1. User signs in.
2. Dashboard shows personalized Nepal destination recommendations.
3. User sets location manually or with GPS.
4. Destination cards show safety, weather, and route availability.
5. User opens one destination detail page.
6. User sees safety explanation.
7. User opens route modal.
8. Route shows distance, duration, path, and risk explanation.
9. User opens hazard notifications.
10. User reports a hazard.
11. Admin verifies the hazard.
12. User receives or sees updated safety context.
13. User creates a trip.
14. User views trip plan.
15. User shares location or emergency contact if needed.

## 90% Definition of Done

YatraAI is 90% complete when all of these are true:

- Main demo works end-to-end.
- Production build passes.
- Tests pass.
- Lint passes or documented exceptions are minimal.
- Deployment docs are accurate.
- Required environment variables are documented.
- Seed/demo data can be recreated.
- Dashboard is reliable.
- Route modal is reliable.
- Trip planning is reliable.
- Notifications are reliable.
- Admin can correct destination and hazard data.
- AI failure does not break core flows.
- External service failure produces understandable degraded states.
- User-facing pages have loading, empty, and error states.
- Known limitations are documented honestly.

## Final Advice

The project should not become “everything travel.” It should become:

> The clearest safety-first travel companion for Nepal.

That is the shape. Build toward that, one complete flow at a time.

