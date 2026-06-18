import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { debug, maskSecret } from './debug'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

debug('Supabase', 'Initializing client', {
  configured: isSupabaseConfigured,
  url: url ?? '(missing)',
  anonKey: maskSecret(anonKey),
})

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey)
  : null

if (supabase) {
  debug('Supabase', 'Client created successfully')
} else {
  debug('Supabase', 'Client NOT created — missing env vars')
}
