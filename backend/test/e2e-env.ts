// Runs before any test module is loaded, so the app's config sees it: the tests drive the outbox themselves.
process.env.OUTBOX_DISPATCH = 'off';
// Most e2e journeys select their seeded user via x-dev-user. auth.e2e-spec.ts switches to JWT before it loads the
// application, so it remains the dedicated sign-in-mode coverage.
process.env.AUTH_MODE = 'dev';
