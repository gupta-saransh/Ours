/**
 * Generates a VAPID key pair for Web Push. Run once:
 *
 *   npx tsx scripts/generate-vapid.ts
 *
 * Copy the printed values into your .env (and into the Vercel project's
 * Environment Variables). Regenerating invalidates every existing browser
 * subscription, so only do it once unless the private key leaks.
 */
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log('\nAdd these to your .env and to Vercel → Settings → Environment Variables:\n');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
console.log('\n(Set VAPID_SUBJECT to a real mailto: address you control.)\n');
