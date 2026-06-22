import { createClient } from '@supabase/supabase-js';
import { cacheLife, cacheTag } from 'next/cache';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function getMintingPageLogoAndName(chainId: string, contractAddress: string) {
    'use cache';
    // chainId and contractAddress are automatically part of the cache key.
    cacheTag(`minting-page-image:${chainId}:${contractAddress}`);
    cacheLife({
        stale: 3600,        // serve stale up to 1h on the client
        revalidate: 3600 * 24, // refresh once a day
        expire: 3600 * 24 * 7, // hard expiry after a week
    });

    try {
        const { data, error } = await supabase
            .from('MintingPages')
            .select('ipfs_logo, name')
            .eq('deployAddress', contractAddress)
            // Ensure we match the network type stored in DB. If it's number vs string, this might matter.
            // Assuming string based on usage.
            .eq('network', chainId)
            .single();

        if (error) {
            console.error('Error fetching minting page image:', error);
            return null;
        }

        return data;
    } catch (e) {
        console.error('Unexpected error fetching minting page image:', e);
        return null;
    }
}
