// Supabase Edge Function: encrypt-provider
// Deploy with: supabase functions deploy encrypt-provider
//
// This function encrypts sensitive API keys before storing them in the database.
// It uses AES-GCM encryption with a key from Supabase Secrets (ENCRYPTION_KEY).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { providerData, userId, action } = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY is not set in Supabase Secrets');
    }

    if (action === 'encrypt') {
      // Encrypt the API key
      const encoder = new TextEncoder();
      const keyData = encoder.encode(encryptionKey);
      
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt"]
      );

      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        cryptoKey,
        encoder.encode(providerData.apiKey)
      );

      const encryptedData = {
        ...providerData,
        apiKey: Array.from(new Uint8Array(encrypted)),
        iv: Array.from(iv),
        encrypted: true,
      };

      // Store in Supabase (example)
      const { error } = await supabase
        .from('providers')
        .insert({
          user_id: userId,
          name: providerData.name,
          type: providerData.type,
          encrypted_data: encryptedData,
          created_at: new Date().toISOString(),
        });

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, message: 'تم تشفير وحفظ المزود بنجاح' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'decrypt') {
      // Decrypt when needed (only in secure Edge Functions, never expose to client)
      // This would be called from another secure function like /api/chat
      return new Response(JSON.stringify({ message: 'Decryption should only happen server-side' }));
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 });

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
