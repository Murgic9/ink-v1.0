# INKurgic

A literary writing community for poets, storytellers, spoken-word artists, and readers.

## Getting started

1. Copy `.env.example` to `.env` and configure your settings.
2. Install dependencies with `npm install`.
3. Start the app with `npm run dev`.

## Scripts

- `npm run dev` — start the development server with nodemon
- `npm start` — start the production server

## Deploying the backend to Render

Create a Render **Web Service** connected to this repository with:

- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/api/health`

Use Node 20 or newer in Render. The service listens on Render's `PORT` automatically.

Set these environment variables in Render:

- `NODE_ENV=production`
- `PORT` is supplied by Render automatically; do not hardcode it.
- `JWT_SECRET` as a unique random value of at least 32 characters.
- `CLIENT_URL` to the exact public URL serving this app.
- `ADMIN_EMAIL=inkurgic@gmail.com`.
- `ADMIN_PASSWORD` as a strong password you choose. This updates the seeded administrator on startup. Never commit it.
- `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`.
- `SMTP_USER=inkurgic@gmail.com` and `MAIL_FROM=INKurgic <inkurgic@gmail.com>`.
- `SMTP_PASS` as a Google app password, not the Gmail account password. Enable 2-Step Verification on the Google account, then create an app password under Google Account > Security.
- `DATA_DIR=/var/data` when using the included file-backed store.
- Paystack variables are no longer required. INKurgic is currently free for writers and the Paystack checkout has been removed from the user interface.

Important: the included store is file-backed. Render services have ephemeral filesystems, so production user, writing, streak, reset-token, and chat data requires a paid Render persistent disk mounted at `/var/data` and `DATA_DIR=/var/data`. A MongoDB URI may be configured for future migration, but the current routes use the file store.

### Render launch checklist

1. Create a Render Web Service from the repository and set the build, start, and health-check values above.
2. Add a paid Render persistent disk mounted at `/var/data`; without it, production data will be lost on restart or deploy.
3. Add every environment variable in the Render Environment tab. Generate `JWT_SECRET` with a password manager or a cryptographically secure generator and use 32 or more characters.
4. Set `ADMIN_PASSWORD` before the first deploy. Log in using `inkurgic@gmail.com`; the old `ember@inkurgic.com` alias remains supported for existing accounts.
5. Deploy and open `/api/health`. Confirm it returns `ok: true`.
6. Test registration, legacy login, password reset email, writing creation, private drafts, Streak Forge check-in, image uploads, and Ember support replies.
7. Set `CLIENT_URL` to the final Render URL, redeploy, and repeat the reset flow. Reset links are generated from this value.
8. Configure a custom domain only after the service URL works, then update `CLIENT_URL` again.

Gmail delivery will be skipped with a server warning when SMTP variables are absent. That is useful locally, but production must have SMTP configured for welcome, login, reset, and Ember-reply emails.

Meaningful account, profile, writing, social, and streak updates are also routed to the registered user's email address. See [PERSONA.md](PERSONA.md) for the product voice and answers to common project questions.

After deployment, verify `https://your-render-url.onrender.com/api/health`, registration, login, writing creation/deletion, and support chat. Configure `CLIENT_URL` after the final public URL is known.

## Notes

The app ships with a working Express API and a JSON fallback data store so the frontend can function even without a MongoDB connection.
