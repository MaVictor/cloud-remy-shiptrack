# ShipTrack (Cloud Remy demo)

ShipTrack is a small order and shipment tracking platform with a React operations console, built as a demo target for the Snyk remediation agent (Remy). It's a working app with real features and passing tests, and its dependencies are deliberately out of date.

Every vulnerable dependency is pinned to a version that Remy upgraded successfully in Snyk's internal benchmark runs, where success means the fix was verified: dependencies resolve, the vulnerabilities clear, the build passes, and the tests that passed before still pass. Lockfiles were resolved as of December 2024, like an app that hasn't refreshed its lockfile since.

**Please don't upgrade dependencies or regenerate lockfiles on `main`.** That's the agent's job in the demo. Direct dependencies are pinned exactly, but transitive ones are only held back by the lockfiles, so deleting a lockfile, running `npm update`, or merging a Dependabot PR quietly clears part of what Remy is supposed to fix. Fork or import the repo and let Remy open the PRs.

## Services

| Path | Package manager | What it does |
|---|---|---|
| `services/web` | npm | React operations console: sign in, create and search orders, ship them, upload attachments, download labels and customs paperwork, leave notes, run reports |
| `services/api` | npm | Orders, auth, attachments, customs e-filing, carrier webhooks, label downloads, warehouse routing, reports, merchant portal |
| `services/worker` | npm | Scheduled jobs: ERP stock sync, carrier polling, customs submission, ops digest, attachment cleanup, warehouse report |
| `services/carrier-gateway` | Yarn | One API in front of DHL, UPS and PostNord: rate quotes, labels, tracking, circuit breaker, live feed |

Each service has its own manifest, lockfile, build check and tests. Node 20 or later.

To use the app, build the UI once and start the API, which serves it:

```sh
cd services/web && npm ci && npm run build
cd ../api && npm ci && npm start
```

Then open http://localhost:3000 and sign in as `ops@shiptrack.example.com` / `correct-horse` (admin) or `dana@shiptrack.example.com` / `battery-staple` (agent). Without MongoDB the API keeps orders in memory. For UI development, run `npm run dev` in `services/web` alongside the API.

```sh
cd services/web && npm ci && npm run build && npm test
cd services/api && npm ci && npm run build && npm test
cd services/worker && npm ci && npm run build && npm test
cd services/carrier-gateway && yarn install --frozen-lockfile && yarn build && yarn test
```

The tests don't need MongoDB, MySQL, SQL Server or any carrier account. External calls go to local stubs.

## What Snyk finds

As of October 2026, scanning with `snyk test --all-projects` and `snyk code test`:

- Open Source: about 530 unique issues across the four projects, almost all fixable by upgrade
- Code: about 55 findings, most of them in test fixtures

Counts drift as new advisories are published.
