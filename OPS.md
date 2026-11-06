# Operations automation

These are the one-shot ops scripts that used to exist with no npm script and no
schedule. They are now all wired behind one guarded entry point.

## What each script does

| Command | Script | Effect | Default |
|---|---|---|---|
| `npm run ops:run` | `scripts/ops-run.mjs` | Runs translate-blog → sync-catalog → update-seo → IndexNow → Bing | **dry-run** report only |
| `npm run ops:catalog` | `scripts/sync-products-to-supabase.mjs` | Diffs `data/products.json` against the live admin catalogue and **prints** PATCH/POST actions | dry-run |
| `npm run ops:catalog:apply` | same | Applies the diff through the admin API (SEO fields included) | writes |
| `npm run ops:seo` / `ops:seo:apply` | `scripts/update-seo.mjs` | SEO-columns-only DB fallback when the admin API is unreachable | dry-run |
| `npm run blog:translate` | `scripts/translate-blog.mjs` | Fills missing blog fields for de/es/fr/ja/zh-CN from `titleVi`/`contentVi` | fills nothing, reports |
| `npm run blog:translate:apply` | same | Same, writes the JSON files (idempotent - never overwrites existing translation) | writes |
| `npm run ops:indexnow` | `scripts/ping-indexnow.mjs` | Announces every localized homepage + product URL to IndexNow | skip if unconfigured |
| `npm run ops:bing` | `scripts/submit-bing-sitemap.mjs` | Submits `/sitemap.xml` to Bing Webmaster Tools | skip if `BING_API_KEY` unset |
| `npm run translate:smoke` | `scripts/translate-smoke.mjs` | Smoke test for the translation provider | skip on failure |

Touching IndexNow/Bing (external side effects) additionally needs
`OPS_ALLOW_EXTERNAL=1` with `ops:run --apply`.

## Suggested cadence

- **After editing `data/products.json` or `data/blog/*.json`**:
  ```powershell
  npm run ops:run            # preview what would change
  npm run ops:run:apply      # apply (with OPS_ALLOW_EXTERNAL=1 if you want IndexNow/Bing)
  ```
- **Weekly/monthly**: run `npm run blog:translate` so missing blog translations
  are detected before a reader hits an untranslated post.
- **After a deploy**: `npm run ops:indexnow` and `npm run ops:bing` re-announce the
  current sitemap (the server also pings IndexNow automatically on admin product writes).

## Why SEO has two scripts

`sync-products-to-supabase.mjs` is the primary path (goes through the admin API
and carries the full catalogue). `update-seo.mjs` is narrow on purpose: SEO
columns only, direct to the DB. It exists for the operator who can reach
Postgres but not the live API. They intentionally overlap; never run both in
apply mode on the same change.
