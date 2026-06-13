# Ammex Bid Calculator

A private web app that turns the Ammex Rebar Job Estimator workbook into responsive
estimating software for desktop, iPad, and iPhone. All math is a faithful port of the
spreadsheet — the workbook is the source of truth; this app only performs the calculations.

## Run locally

```bash
npm install
cp .env.local.example .env.local   # set your password
npm run dev                         # http://localhost:3000
```

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: **New Project → Import** the repo. Framework is auto-detected (Next.js).
3. Add an Environment Variable: `NEXT_PUBLIC_APP_PASSWORD` = your password.
4. Deploy.

## Password / access

The login screen checks `NEXT_PUBLIC_APP_PASSWORD` (default `ammex`). Because `NEXT_PUBLIC_`
variables ship in the browser bundle, this is a **light access gate for a private tool, not
hardened authentication**. For real protection, enable Vercel's built-in Deployment Protection
(Password / Vercel Authentication) on the project, or add Basic-Auth middleware.

## How the numbers map to the workbook

All formulas live in `lib/calc.js`, each annotated with the workbook cell it reproduces:

- **Estimate** → `Estimator!B9, B27:B42`
- **Quick review flags** → `Estimator!B44:B47`
- **Reverse bid** → `Estimator!B53:B61`
- **Sensitivity** → `Sensitivity!A17:I22`

### One intentional fix

The workbook's Sensitivity tab added tools% and contingency% (`1 + tools + cont`), while the
Estimator compounds them (`(1+tools)(1+cont)`). That ~$22 gap at 140 lb/MH meant the sensitivity
row never tied to the headline bid. The app unifies on the Estimator's compounding method so the
planned-output row matches the recommended bid exactly. To revert, swap the marked line in
`computeSensitivity()` in `lib/calc.js`.

## Stack

Next.js 14 (App Router) · React 18 · Tailwind CSS · client-side calculations · no database.
