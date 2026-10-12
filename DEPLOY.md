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
| `ADMIN_KEY` | (a one-time setup password — see "First sign-in" below) |
| `SESSION_SECRET` | (optional, long random string used to sign login tokens; defaults to `ADMIN_KEY`) |

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

**Roles**

| Role | Can do |
|------|--------|
| `admin` | Add, edit and delete postcards and photos, manage users, delete any comment |
| `edit` | Add and edit postcards and photos |
| `commenter` | Comment on postcards (and delete their own comments) |

**First sign-in:** while no `admin` user exists, sign in with username `admin` and the `ADMIN_KEY`
as the password. You land on the **Users** page (`/admin/users`); create your real accounts there.
The setup key stops working as soon as an `admin` user exists.

**Commenters:** there is no self-registration. An admin creates each commenter account on the **Users**
page (role `commenter`) and shares the username and password. Commenters then click **Sign in** on the
public map. Consider adding a rate-limit rule on `POST /api/login` in your WAF.

**Pages:** `/admin` is for postcards and photos. `/admin/users` is for user accounts (admins only).

**Photos:** attach photos when adding or editing a postcard. They are resized in the browser
(1800px full size plus a 320px thumbnail) and stored in a `photos` blob container in the same storage
account, which is created automatically. Up to 20 photos per postcard. The API serves them, so the
container can stay private. On the public map, clicking a pin shows scrolling thumbnails; click one to enlarge.

1. Go to `/admin` on your site
2. Sign in with your username and password
3. To add a postcard:
   - Enter the location name, date, and who sent it
   - Optionally attach photos
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

**Admin login fails**: Usernames are case-insensitive, passwords are not. If no users exist yet, use username `admin` with the `ADMIN_KEY` value. If you lose all admin accounts, delete the rows from the `users` table in Storage Explorer to re-enable the setup key.

**API returns 500**: Check the Function logs in Azure Portal → Static Web App → Functions → your function → Monitor.

**Geocode doesn't work**: Nominatim (OpenStreetMap's geocoder) requires a user-agent and rate-limits heavy use. For a family site with occasional entries this will always be fine.
