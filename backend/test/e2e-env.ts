// Runs before any test module is loaded, so the app's config sees it: the tests drive the outbox themselves.
process.env.OUTBOX_DISPATCH = 'off';
