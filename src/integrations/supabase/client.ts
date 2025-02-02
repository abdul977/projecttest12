import { createClient } from '@supabase/supabase-js';
import { RealtimeClient } from '@supabase/realtime-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  },
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
});

export const realtimeClient = new RealtimeClient(
  SUPABASE_URL.replace('http', 'ws'),
  {
    params: {
      apikey: SUPABASE_ANON_KEY,
      eventsPerSecond: 10,
      heartbeatIntervalMs: 1000
    }
  }
);