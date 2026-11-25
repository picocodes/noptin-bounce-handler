# Noptin Cloudflare Bounce Handler

Forward Cloudflare Email Sending hard bounces and spam complaints to [Noptin](https://noptin.com/) on your WordPress website.

## Deploy to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hizzle-co/cloudflare-bounce-handler)

1. Copy your Cloudflare bounce handler URL from [Noptin's bounce handling settings](https://noptin.com/guide/email-subscribers/bounce-handling/).
2. Click Deploy to Cloudflare and follow the deployment prompts.
3. Configure `NOPTIN_BOUNCE_URL` as an encrypted Worker secret. If the deployment form does not offer a secret field, add it under the deployed Worker's Settings > Variables and Secrets.
4. Confirm that queues `noptin-bounces` and `noptin-bounces-failed` exist. Create missing queues before retrying deployment if necessary.
5. Configure an [Email Sending event subscription](https://developers.cloudflare.com/email-service/reference/event-subscriptions/) for `cf.email.sending.message.bounced` and `cf.email.sending.message.complained`, targeting `noptin-bounces`.

Keep your existing email sending connection. Inbound Email Routing is not supported.

## Deploy with Wrangler

Requires Node.js 22 or later and a Cloudflare account with Email Sending, Workers and Queues.

```sh
git clone https://github.com/hizzle-co/cloudflare-bounce-handler.git
cd cloudflare-bounce-handler
npm install
npx wrangler login
```

Create these queues if they do not already exist:

```sh
npx wrangler queues create noptin-bounces
npx wrangler queues create noptin-bounces-failed
npm run deploy
npx wrangler secret put NOPTIN_BOUNCE_URL
```

Paste the complete URL when prompted. Then configure the event subscription as described above.

## Behavior

- Forwards the original JSON event for hard bounces and spam complaints.
- Ignores soft bounces and unrelated events.
- Acknowledges forwarded events only after HTTP success with JSON boolean `true`.
- Retries failed messages individually after 300 seconds, up to 100 retries.
- Sends exhausted messages to `noptin-bounces-failed`. Monitor this queue and recover events before retention expires.
- Does not expose a public HTTP Worker endpoint.

Queues provide at-least-once delivery; duplicate deliveries are possible.

## Security

Never commit the bounce handler URL. Store it as a Worker secret or in an ignored local `.dev.vars` file. The Worker does not explicitly log URLs, email addresses or event bodies. Review Cloudflare logging and tracing settings separately.

## Tests

Run `npm test` with Node.js 22 or later. The tests mock HTTP responses and do not require credentials.

## License

MIT. See [LICENSE](LICENSE).
