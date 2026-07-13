// =====================================================
// Supabase Client - معتز العلقمي
// =====================================================
// This file provides a safe Supabase client.
// It only initializes if VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.

import { createClient, SupabaseClient } from '@supabase/supabase-js'

let supabase: SupabaseClient | null = null

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
} else {
  console.warn('Supabase not configured. Using localStorage fallback.')
}

export { supabase }

// =====================================================
// Providers (with encryption support via Edge Function)
// =====================================================

export async function saveProviderToSupabase(providerData: any, userId: string) {
  if (!supabase) {
    console.log('Supabase not available, saving to localStorage instead')
    return { success: false, fallback: true }
  }

  try {
    // In production, call your Edge Function to encrypt the API key first
    // const { data: encrypted } = await supabase.functions.invoke('encrypt-provider', {
    //   body: { providerData, userId, action: 'encrypt' }
    // })

    const { error } = await supabase
      .from('providers')
      .insert({
        user_id: userId,
        name: providerData.name,
        type: providerData.type,
        encrypted_data: providerData, // Replace with encrypted version in production
        is_enabled: true,
      })

    if (error) throw error
    return { success: true }
  } catch (error: any) {
    console.error('Error saving provider to Supabase:', error)
    return { success: false, error: error.message }
  }
}

export async function getUserProvidersFromSupabase(userId: string) {
  if (!supabase) return []

  try {
    const { data, error } = await supabase
      .from('providers')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Error fetching providers:', error)
    return []
  }
}

// =====================================================
// Chats & Messages
// =====================================================

export async function saveChatToSupabase(chatData: any, userId: string) {
  if (!supabase) return { success: false, fallback: true }

  try {
    const { error } = await supabase.from('chats').upsert({
      id: chatData.id,
      user_id: userId,
      title: chatData.title,
      provider_id: chatData.providerId,
      model: chatData.model,
      mode: chatData.mode,
      updated_at: new Date().toISOString(),
    })

    if (error) throw error
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function saveMessageToSupabase(message: any, chatId: string) {
  if (!supabase) return { success: false, fallback: true }

  try {
    const { error } = await supabase.from('messages').insert({
      chat_id: chatId,
      role: message.role,
      content: message.content,
      model: message.model,
      tokens: message.tokens,
    })

    if (error) throw error
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function getUserChatsFromSupabase(userId: string) {
  if (!supabase) return []

  try {
    const { data, error } = await supabase
      .from('chats')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Error fetching chats:', error)
    return []
  }
}
