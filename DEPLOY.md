# Taets Family Travel Site — Deployment Guide

## What You're Building

- **Frontend**: Interactive world map (Leaflet + OpenStreetMap, free)
- **Backend**: Azure Functions API (3 endpoints: list, add, delete)
- **Database**: Azure Table Storage (~$0.01/month at this scale)
- **Hosting**: Azure Static Web Apps (FREE tier)
- **Admin**: Password-protected page at `/admin` to enter postcards

**Estimated monthly cost: $0–$1**

---

## Prerequisites

1. [Azure account](https://azure.microsoft.com/free) (free tier works)
2. [GitHub account](https://github.com) (free) — used for deployment
3. [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) or use the Azure Portal
4. [Node.js 18+](https://nodejs.org)

---

## Step 1 — Upload code to GitHub

1. Create a new GitHub repository (e.g. `taets-travel`)
2. Copy the contents of this `taets-travel/` folder into the repo root
3. Push to GitHub

Your repo should look like:
```
/
├── index.html
├── admin.html
├── staticwebapp.config.json
└── api/
    ├── host.json
    ├── package.json
    └── src/functions/locations.js
```

---

## Step 2 — Create Azure Storage Account

In the [Azure Portal](https://portal.azure.com):

1. Search → **Storage accounts** → **Create**
2. Settings:
   - **Resource group**: Create new, e.g. `taets-travel-rg`
   - **Storage account name**: e.g. `taetstravel` (lowercase, no spaces)
   - **Region**: pick one close to you (e.g. East US)
   - **Performance**: Standard
   - **Redundancy**: LRS (cheapest — ~$0.02/GB/month)
3. Click **Review + Create** → **Create**

After it creates:
4. Go to your storage account → **Access keys** (left menu)
5. Copy **Connection string** (key1) — you'll need this in Step 4

---

## Step 3 — Create Azure Static Web App

In the [Azure Portal](https://portal.azure.com):

1. Search → **Static Web Apps** → **Create**
2. Settings:
   - **Resource group**: same as above (`taets-travel-rg`)
   - **Name**: `taets-travel`
   - **Plan type**: **Free**
   - **Region**: East US 2 (or your preferred region)
   - **Source**: GitHub → sign in → select your repo and branch (`main`)
3. Build details:
   - **Build preset**: Custom
   - **App location**: `/`
   - **API location**: `api`
   - **Output location**: `` (leave blank)
4. Click **Review + Create** → **Create**

Azure will automatically add a GitHub Actions workflow to your repo that deploys on every push.

---

## Step 4 — Set Environment Variables

In the Azure Portal, go to your Static Web App:

1. Left menu → **Configuration** → **Application settings**
2. Add these two settings:

| Name | Value |
|------|-------|
| `AZURE_STORAGE_CONNECTION_STRING` | (paste the connection string from Step 2) |
| `ADMIN_KEY` | (choose a strong password — you'll type this into the admin page) |

3. Click **Save**

---

## Step 5 — Deploy

The GitHub Actions workflow created in Step 3 will trigger automatically when you push.
Check the **Actions** tab in your GitHub repo to watch the deployment.

Once complete, your site is live at:
- **Public map**: `https://<your-site-name>.azurestaticapps.net`
- **Admin page**: `https://<your-site-name>.azurestaticapps.net/admin`

---

## Using the Admin Page

1. Go to `/admin` on your site
2. Enter your `ADMIN_KEY` password
3. To add a postcard:
   - Enter the location name and country
   - Enter the date visited
   - Type the postcard message
   - Click **🔍 Search** to auto-find coordinates (or type them manually)
   - Click **📌 Add to Map**

The pin will appear on the public map immediately.

---

## Custom Domain (Optional)

In your Static Web App → **Custom domains** → **Add**
Follow the DNS instructions for your domain registrar.
Azure provides a free TLS certificate automatically.

---

## Costs Summary

| Service | Tier | Est. Monthly Cost |
|---------|------|-------------------|
| Azure Static Web Apps | Free | **$0** |
| Azure Storage (Table + a few KB) | Pay-as-you-go | **< $0.01** |
| OpenStreetMap tiles | Free | **$0** |
| GitHub Actions | Free (2,000 min/month) | **$0** |
| **Total** | | **~$0/month** |

---

## Troubleshooting

**Map loads but shows no pins**: Check that `AZURE_STORAGE_CONNECTION_STRING` is set correctly in Configuration. Open browser DevTools → Network tab and look at the `/api/locations` response.

**Admin login fails**: Check that `ADMIN_KEY` is set in Configuration. Keys are case-sensitive.

**API returns 500**: Check the Function logs in Azure Portal → Static Web App → Functions → your function → Monitor.

**Geocode doesn't work**: Nominatim (OpenStreetMap's geocoder) requires a user-agent and rate-limits heavy use. For a family site with occasional entries this will always be fine.
