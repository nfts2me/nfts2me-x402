import { createClient } from '@supabase/supabase-js';
import { unstable_cache } from 'next/cache';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export const getMintingPageLogoAndName = unstable_cache(
    async (chainId: string, contractAddress: string) => {
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
    },
    ['minting-page-image'],
    { revalidate: 3600 * 24 } // Cache for 24 hours since user said it doesn't change
);
