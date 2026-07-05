# Native Tracking Infrastructure

Self-contained Voluum/Keitaro-style tracker for native traffic (Mediago, Facebook, Google).

## Structure

- `backend/` — NestJS API (click redirect, conversions, S2S postbacks, tracker script). Shared tracking utilities live in `backend/src/shared/tracking/`.
- `admin/` — Next.js admin dashboard

## Quick start

```bash
# Start PostgreSQL
docker compose up -d

# Backend
cd backend
cp .env.example .env
npm install
npx prisma migrate dev
npm run start:dev

# Admin
cd admin
cp .env.example .env.local
npm install
npm run dev
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /:externalId` | Voluum-style redirect (UUID path) |
| `GET /click/:slug` | Click redirect — stores click, 302 to landing page |
| `GET /t/tracker.js` | Client tracking script (`tk-cid` + `tkCallback`) |
| `POST /conversions` | Server-side conversion intake |
| `GET /postback/:clickId` | Pixel-style conversion trigger |
| `GET /api/analytics/live` | Live incoming traffic feed |
| `GET /api/analytics/breakdown` | CR breakdown by publisher/device/OS/country |
| `GET /api/campaigns` | Campaign CRUD (admin) |
| `GET /api/landers` | Lander CRUD + upload/deploy bundle (admin) |

## Landers (upload + deploy)

1. Open **Admin → Landers → New lander**
2. Pick a campaign — slug, root domain, and public URL are suggested from verified tracker domains
3. Upload a zip or HTML/CSS/JS files — tracker script is auto-injected into `index.html`
4. **Download deploy bundle** — contains processed files + `deploy.sh`
5. On your server: unzip and run `bash deploy.sh` (edit `REMOTE` / `REMOTE_PATH` if needed)

Campaign `destinationUrl`, `landerId`, and `landerName` are updated automatically when you save.

Set `LANDERS_STORAGE_ROOT` in backend `.env` (default: `./storage/landers`).

## Click URL examples

**Voluum-style** (set campaign External ID = `8d92ac23-ca85-497e-87c4-44ddd2ade345`):
```
http://localhost:3001/8d92ac23-ca85-497e-87c4-44ddd2ade345?adid=${AD_ID}&adtitle=${AD_TITLE}&campaignid=${CAMPAIGN_ID}&publishername=${PUBLISHER_NAME}&siteid=${SITE_ID}&contentname=${CONTENT_NAME}&platform=${PLATFORM}&assetid=${ASSET_ID}&click_id=${TRACKING_ID}
```

**Slug-based**:
```
http://localhost:3001/click/seniorsante-plus?tracking_id={TRACKING_ID}&utm_source=mediago
```

Each click stores Voluum-like data: IP, geo (country/region/city), device/OS/brand/model/browser, publisher, platform, and all raw URL params.

## Conversion API

```bash
curl -X POST http://localhost:3001/conversions \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{"clickId":"dabc123","eventType":"lead","metadata":{"email":"user@example.com"}}'
```
