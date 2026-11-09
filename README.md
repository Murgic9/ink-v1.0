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
- `PAYSTACK_PUBLIC_KEY` with your Paystack public key.
- `PAYSTACK_SECRET_KEY` with your Paystack secret key. Keep this server-side only.
- `PAYSTACK_TEST_MODE=true` while testing, then set it to `false` for live payments.
- `PAYSTACK_CURRENCY=NGN` (USD configuration falls back to NGN until USD is enabled for the Paystack account).
- `PAYSTACK_AMOUNT=299900` in Paystack's smallest currency unit (₦2,999.00).

Important: the included store is file-backed. Production uses `/var/data` by default, so attach a Render persistent disk at that mount path to preserve user accounts, writings, streaks, reset tokens, and chats through restarts and code updates. Set `DATA_DIR` only if the disk is mounted elsewhere. In production, the server stops with an error if the selected data directory is unavailable instead of silently switching to deployment-local or temporary storage. A MongoDB URI may be configured, but the current routes use the file store.

Paystack keys must match the mode: use `pk_test_` and `sk_test_` keys with `PAYSTACK_TEST_MODE=true`, or `pk_live_` and `sk_live_` keys with `PAYSTACK_TEST_MODE=false`.

### Render launch checklist

1. Create a Render Web Service from the repository and set the build, start, and health-check values above.
2. Add a paid Render persistent disk mounted at `/var/data`; production will not start if its data directory is unavailable.
3. Add every environment variable in the Render Environment tab. Generate `JWT_SECRET` with a password manager or a cryptographically secure generator and use 32 or more characters.
4. Set `ADMIN_PASSWORD` before the first deploy. Log in using `inkurgic@gmail.com`; the old `ember@inkurgic.com` alias remains supported for existing accounts.
5. Deploy and open `/api/health`. Confirm it returns `ok: true`.
6. Test registration, legacy login, password reset email, writing creation, private drafts, Streak Forge check-in, image uploads, and Ember support replies.
7. Set `CLIENT_URL` to the final Render URL, redeploy, and repeat the reset and Paystack return flows. Both URLs are generated from this value.
8. Configure a custom domain only after the service URL works, then update `CLIENT_URL` again.

Gmail delivery will be skipped with a server warning when SMTP variables are absent. That is useful locally, but production must have SMTP configured for welcome, login, reset, and Ember-reply emails.

Meaningful account, profile, writing, social, and streak updates are also routed to the registered user's email address. See [PERSONA.md](PERSONA.md) for the product voice and answers to common project questions.

After deployment, verify `https://your-render-url.onrender.com/api/health`, registration, login, writing creation/deletion, and support chat. Configure `CLIENT_URL` after the final public URL is known.

## Notes

The app ships with a working Express API and a JSON fallback data store so the frontend can function even without a MongoDB connection.

Writer Premium lasts one calendar month from each verified payment. After it expires, premium features are disabled and the account can renew through the Subscribe button. Renewal requires a new verified Paystack payment; it is not automatic.
