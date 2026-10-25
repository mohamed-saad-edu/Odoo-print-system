# HTTPS staging branch synchronization to Yaseir V4

The branch retains historical staging commits as Git ancestry and merges the verified V4 `main` source without force-resetting the test branch. The staging HTTPS deployment, existing PostgreSQL external volume, domain binding, email capture and one-workspace/invitation behavior are kept and adapted to V4's dedicated owner/runtime DB roles.

Historical staging-only Stripe/checkout patches are intentionally not reintroduced: V4 uses operator-approved manual subscriptions, and old payment UI would conflict with the current model. Legacy trial renewal and workspace-reset helpers now fail closed. The server's actual secrets, PostgreSQL volume, TLS volumes, environment file, accounts, and printer data are NOT part of the Git merge.

For safe deployment, follow `deploy/domain-test/README.md`. Never run a reset or `docker compose down -v`.
