export default {
  /**
   * Forwards hard bounces and complaints, retrying failed deliveries individually.
   * @param {MessageBatch} batch Cloudflare Email Sending event messages.
   * @param {object} env Worker bindings.
   */
  async queue( batch, env ) {
    for ( const message of batch.messages ) {
      try {
        const event = typeof message.body === 'string'
          ? JSON.parse( message.body )
          : message.body;

        const isComplaint =
          event?.type === 'cf.email.sending.message.complained';

        const isHardBounce =
          event?.type === 'cf.email.sending.message.bounced' &&
          event?.payload?.bounce?.type === 'hard';

        if ( !isComplaint && !isHardBounce ) {
          message.ack();
          continue;
        }

        const endpoint = new URL( env.NOPTIN_BOUNCE_URL );
        if ( endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ) {
          throw new Error( 'Invalid bounce handler URL.' );
        }

        const response = await fetch( endpoint.href, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify( event ),
          redirect: 'error',
          signal: AbortSignal.timeout( 15000 ),
        } );

        if ( !response.ok || await response.json() !== true ) {
          throw new Error( 'Noptin did not acknowledge the event.' );
        }

        console.log( 'Event successfully forwarded to Noptin.' );
        message.ack();
      } catch {
        console.warn( 'Noptin bounce delivery failed; retrying.' );
        message.retry( { delaySeconds: 300 } );
      }
    }
  },
};
