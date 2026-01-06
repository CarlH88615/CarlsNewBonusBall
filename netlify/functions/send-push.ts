import type { Handler } from '@netlify/functions';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

webpush.setVapidDetails(
  'https://mellow-palmier-36a4b3.netlify.app',
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);


export const handler: Handler = async (event) => {
  const { title, body } = JSON.parse(event.body || '{}');
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('*');

  if (error || !data) {
    return { statusCode: 500, body: 'Failed to load subscriptions' };
  }

  const payload = JSON.stringify({
  title: title || 'Bonus Ball Update',
  body: body || 'Open the app for details',
  url: '/'
});


  for (const sub of data) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        },
        payload,
        {
          TTL: 60
        }
      );
    } catch (err) {
      console.error('Push failed for endpoint', sub.endpoint, err);
    }
  }

  return {
    statusCode: 200,
    body: 'Push sent'
  };
};
