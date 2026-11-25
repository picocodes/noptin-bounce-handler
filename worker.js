
export default {
    async queue(batch, env) {
        for (const message of batch.messages) {
            let stage = 'parse_event';
            let httpStatus = null;

            try {
                const event = typeof message.body === 'string'
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

                if (!env.NOPTIN_BOUNCE_URL?.trim()) {
                    throw new Error('Missing endpoint');
                }

                stage = 'validate_endpoint';

                const endpoint = new URL(env.NOPTIN_BOUNCE_URL);

                if (
                    endpoint.protocol !== 'https:' ||
                    endpoint.username ||
                    endpoint.password
                ) {
                    throw new Error('Invalid endpoint');
                }

                stage = 'http_request';

                const response = await fetch(endpoint.href, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                    },
                    body: JSON.stringify(event),
                    redirect: 'manual',
                    signal: AbortSignal.timeout(15000),
                });

                httpStatus = response.status;

                stage = 'check_http_status';

                if (!response.ok) {
                    throw new Error('HTTP request unsuccessful');
                }

                stage = 'parse_response';

                const result = await response.json();

                stage = 'check_acknowledgement';

                if (result !== true) {
                    throw new Error('Invalid acknowledgement');
                }

                stage = 'acknowledge_message';

                message.ack();

                console.log('Event successfully forwarded to Noptin.');

            } catch (error) {
                console.warn('Noptin bounce delivery failed; retrying.', {
                    stage,
                    httpStatus,
                    errorType: error?.name || 'Error',
                    attempt: message.attempts,
                    retryDelay: 300,
                });

                message.retry({ delaySeconds: 300 });
            }
        }
    },
};
