import type { Handler } from '@netlify/functions';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

webpush.setVapidDetails(
  'mailto:admin@bonusball.app',
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export const handler: Handler = async () => {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('*');

  if (error) {
    return { statusCode: 500, body: 'Failed to load subscriptions' };
  }

  const payload = JSON.stringify({
    title: 'Bonus Ball Update',
    body: 'New announcement available!'
  });

  await Promise.allSettled(
    data.map(sub =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        },
        payload
      )
    )
  );

  return {
    statusCode: 200,
    body: 'Push sent'
  };
};
