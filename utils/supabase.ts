import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Debugging: If these are undefined, the .env.local isn't being read
if (!supabaseUrl || !supabaseKey) {
  console.error("Critical: Supabase Environment Variables are missing!");
}

export const supabase = createClient(supabaseUrl || '', supabaseKey || '', {
  auth: {
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'astra-auth-token',
  },
  global: {
    headers: { 'x-application-name': 'ASTRA-Medical-System' },
  },
});

export const checkAstraConnection = async () => {
  try {
    const { data, error } = await supabase.from('users').select('count', { count: 'exact', head: true });
    return !error;
  } catch (err) {
    return false;
  }
};