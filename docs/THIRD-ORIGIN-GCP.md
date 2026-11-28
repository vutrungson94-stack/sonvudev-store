# Third origin: GCP Always Free e2-micro (in progress, 2026-11-28)

Status at end of day: **billing account reopened, $1 alerts-only budget created, VM NOT created yet.** Do not treat GCP as an active origin until a VM answers `/api/health` and its URL is added to the Worker `ORIGINS` secret.

## Why a third origin

Fly and Render currently provide two-way failover through the edge Worker. A third independent host lowers the chance that both free tiers are unavailable at once. Oracle Cloud Always Free was tried first and its card verification failed with the same VCB Visa that Fly/Render accepted; GCP Free Tier is the next candidate.

## What is already done

- GCP billing account `01BCA7-…` was **closed**; it was reopened in Account management (the Budgets console is reachable again).
- Budget `sonvudev-zero-cost-guard`: **Alerts only**, **Monthly**, **Specified amount $1**, thresholds 50/90/100% on Actual spend, email to billing admins. Chosen deliberately: **spend caps only cover Gemini/Vertex/Cloud Run/functions — not Compute Engine**, and they do not pause an already-running VM. Alerts-only is the only useful guard for an e2-micro VM.
- Card verification on GCP may create a temporary $0–$1 hold (not a charge), same pattern as Render/Fly.

## Free Tier limits that must not be exceeded

From Google Cloud Free Tier (Compute Engine):

- **1 non-preemptible `e2-micro` VM**, only in `us-west1` (Oregon), `us-central1` (Iowa), `us-east1` (South Carolina). Limits are by **hours**, combined across those regions.
- **30 GB-month** standard persistent disk.
- **1 GB outbound data/month** from North America (excluding China/Australia). Cloudflare edge caching keeps origin egress low.
- No GPU, no extra disks, no snapshots, no reserved/static IP. Ephemeral external IP is free while the VM runs.
- Free Tier has no end date today, but Google can change it with 30 days notice.

## Next steps (tomorrow)

1. Create the VM (Cloud Shell or console):
   ```bash
   gcloud compute instances create sonvudev-store \
     --zone=us-central1-a \
     --machine-type=e2-micro \
     --image-family=debian-12 \
     --image-project=debian-cloud \
     --boot-disk-size=10GB \
     --boot-disk-type=pd-standard \
     --tags=http-server,https-server \
     --scopes=cloud-platform
   ```
2. Get the ephemeral IP, SSH in, install Docker, deploy the same `sonvudev-store` image with the real env (copy `.env` via `scp`; never paste secrets into chat). Serve HTTP on port 80; Cloudflare terminates TLS.
3. Verify `curl http://<IP>/api/health` returns `ok:true`.
4. Add `http://<IP>` to the Worker secret `ORIGINS`:
   ```powershell
   npx wrangler secret put ORIGINS --config cloudflare/origin-balancer/wrangler.jsonc
   # keep BOTH existing origins and append the GCP URL
   ```
5. Add GitHub secret `GCP_HEALTH_URL=http://<IP>/api/health`, then extend `scripts/origin-commit.mjs` + `.github/workflows/auto-heal.yml` to probe and deploy GCP alongside Fly/Render.
6. Restrict port 80 to Cloudflare IP ranges once the Worker is serving through it.
7. Update `BAN-GIAO` and `docs/MAINTENANCE-MODE.md` with the third origin's live state.

## Stop condition

If VM creation or billing still fails with the VCB Visa, stop. Fly + Render already satisfy the zero-cost goal: two-way failover, friendly maintenance page, and auto-heal of a recovered origin's latest commit.
