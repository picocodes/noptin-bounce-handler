// Never log the secret endpoint or its security code.
function redact(value, secret) {
    let text = String(value ?? '');
    const variants = new Set();
    if (typeof secret === 'string' && secret.trim()) {
        const raw = secret.trim();
        variants.add(raw);
        try {
            const url = new URL(raw);
            variants.add(url.href);
            const route = url.searchParams.get('rest_route') || url.pathname;
            const token = route.match(/\/bounce_handler\/cloudflare\/([^/]+)/i)?.[1];
            if (token) {
                variants.add(token);
                try { variants.add(decodeURIComponent(token)); } catch {}
            }
        } catch {}
        for (const item of [...variants]) {
            variants.add(encodeURIComponent(item));
            variants.add(JSON.stringify(item).slice(1, -1));
            variants.add(item.replaceAll('/', '\\/'));
        }
        for (const item of [...variants].sort((a, b) => b.length - a.length)) {
            if (item) text = text.split(item).join('[REDACTED]');
        }
    }
    return text.replace(/https?:\/\/[^\s"'<>]+/gi, '[URL REDACTED]');
}

export default {
    async queue(batch, env) {
        for (const message of batch.messages) {
            let stage = 'parse_event';
            let event;
            let httpStatus = null;
            let responseBody;
            let responseHeaders;
            const startedAt = Date.now();
            const secret = env.NOPTIN_BOUNCE_URL;
            const safe = value => redact(value, secret);

            try {
                event = typeof message.body === 'string'
                    ? JSON.parse(message.body)
                    : message.body;

                const isComplaint =
                    event?.type === 'cf.email.sending.message.complained';

                const isHardBounce =
                    event?.type === 'cf.email.sending.message.bounced' &&
                    event?.payload?.bounce?.type === 'hard';

                if (!isComplaint && !isHardBounce) {
                    message.ack();
                    continue;
                }

                stage = 'check_secret';
                if (!secret?.trim()) {
                    throw new Error('NOPTIN_BOUNCE_URL secret is missing or empty.');
                }

                stage = 'validate_endpoint';
                const endpoint = new URL(secret);
                if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
                    throw new Error('NOPTIN_BOUNCE_URL must use HTTPS without URL credentials.');
                }

                stage = 'http_request';
                const response = await fetch(endpoint.href, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'User-Agent': 'Noptin-Cloudflare-Bounce-Handler/1.0',
                    },
                    body: JSON.stringify(event),
                    redirect: 'manual',
                    signal: AbortSignal.timeout(15000),
                });

                httpStatus = response.status;
                responseHeaders = Object.fromEntries(
                    ['content-type', 'cf-ray', 'cf-mitigated', 'retry-after', 'server']
                        .map(name => [name, safe(response.headers.get(name))])
                );

                stage = 'read_response';
                responseBody = await response.text();

                stage = 'check_http_status';
                if (!response.ok) {
                    throw new Error('HTTP ' + httpStatus +
                        (httpStatus >= 300 && httpStatus < 400 ? ' (redirect not followed)' : ''));
                }

                stage = 'parse_response';
                const result = JSON.parse(responseBody);

                stage = 'check_acknowledgement';
                if (result !== true) {
                    throw new Error('Expected JSON boolean true; received ' +
                        (result === null ? 'null' : typeof result) + '.');
                }

                stage = 'acknowledge_message';
                message.ack();

                console.log('Event successfully forwarded to Noptin.', {
                    messageId: safe(message.id),
                    eventType: safe(event.type),
                    attempt: message.attempts,
                    httpStatus,
                    durationMs: Date.now() - startedAt,
                });
            } catch (error) {
                console.error('Noptin bounce delivery failed at ' + stage + ': ' +
                    safe(error?.message || error) + '; retrying.', {
                    stage,
                    messageId: safe(message.id),
                    queue: safe(batch.queue),
                    eventType: safe(event?.type),
                    attempt: message.attempts,
                    retryDelay: 300,
                    durationMs: Date.now() - startedAt,
                    httpStatus,
                    responseHeaders,
                    responseBody: responseBody === undefined ? undefined : safe(responseBody).slice(0, 4000),
                    errorType: safe(error?.name),
                    errorMessage: safe(error?.message || error),
                    errorStack: safe(error?.stack),
                    errorCause: safe(error?.cause),
                });
                message.retry({ delaySeconds: 300 });
            }
        }
    },
};
