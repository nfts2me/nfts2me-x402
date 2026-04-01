import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, formatUnits, Chain } from "viem";
import { base, baseSepolia } from "viem/chains";
import { server } from "../../../../../../proxy";
import { getMintingPageLogoAndName } from "../../../../../../lib/supabase";
import { withX402VerifyOnly, VerifyOnlyContext, PaymentAuthorization } from "../../../../../../lib/withX402VerifyOnly";
import { createPaywall } from '@x402/paywall';
import { evmPaywall } from '@x402/paywall/evm';
import { readMintContractDataWithMulticall, validateMintPaymentConfiguration } from "../../../../../../lib/mintContractReads";

const EVM_ADDRESS = process.env.EVM_ADDRESS as `0x${string}`;

/**
 * Verify-only mint handler response type
 * 
 * Returns the EIP-3009 authorization data for on-chain settlement.
 * The actual minting will be done atomically on-chain using transferWithAuthorization.
 */
type VerifyOnlyResponse = {
    success: boolean;
    message: string;
    authorization: PaymentAuthorization;
    // Additional context for on-chain execution
    mintParams: {
        chainId: string;
        contractAddress: string;
        amount: string;
        mintFee: string;
        usdcAddress: string;
    };
};

/**
 * Handler that receives verified payment authorization but does NOT settle.
 * 
 * This is meant to be used with a smart contract that atomically:
 * 1. Calls USDC.transferWithAuthorization() with the provided authorization
 * 2. Executes the minting operation
 * 3. Reverts everything if either step fails
 */
const handler = async (
    ctx: VerifyOnlyContext,
    chain: Chain,
    contractAddress: string,
    amountStr: string
): Promise<NextResponse<VerifyOnlyResponse>> => {
    try {
        const amount = BigInt(amountStr || "1");

        const publicClient = createPublicClient({
            chain,
            transport: http()
        });

        // Fetch contract data for validation via a single multicall.
        const { protocolFee, erc20PaymentAddress: contractPaymentAddress, mintFee } =
            await readMintContractDataWithMulticall(
                publicClient,
                chain.id,
                contractAddress as `0x${string}`,
                amount,
            );

        const USDC_ADDRESS = validateMintPaymentConfiguration(chain.id, protocolFee, contractPaymentAddress);

        // Log the authorization data for debugging
        console.log("VERIFY-ONLY HANDLER: Payment verified!");
        console.log("Authorization:", JSON.stringify(ctx.paymentAuth, null, 2));
        console.log("From:", ctx.paymentAuth.authorization.from);
        console.log("To:", ctx.paymentAuth.authorization.to);
        console.log("Value:", ctx.paymentAuth.authorization.value);

        // Return the authorization data for on-chain execution
        // The client/contract can use this to call transferWithAuthorization atomically
        return NextResponse.json({
            success: true,
            message: "Payment verified! Use the authorization data to execute transferWithAuthorization on-chain.",
            authorization: ctx.paymentAuth,
            mintParams: {
                chainId: String(chain.id),
                contractAddress,
                amount: amountStr,
                mintFee: mintFee.toString(),
                usdcAddress: USDC_ADDRESS,
            },
        });

    } catch (error) {
        console.error("Verification handler failed:", error);
        return NextResponse.json(
            {
                error: "Verification failed",
                details: error instanceof Error ? error.message : String(error)
            } as unknown as VerifyOnlyResponse,
            { status: 500 }
        );
    }
};

/**
 * x402 route configuration
 * Fetches the mint fee dynamically from the contract
 */
function getMintNftX402Config(actionName: string, chain: Chain, network: string, contractAddress: string, amount: string) {
    return {
        accepts: [
            {
                scheme: "exact",
                price: async () => {
                    const publicClient = createPublicClient({
                        chain,
                        transport: http()
                    });

                    const { protocolFee, erc20PaymentAddress, mintFee } =
                        await readMintContractDataWithMulticall(
                            publicClient,
                            chain.id,
                            contractAddress as `0x${string}`,
                            BigInt(amount),
                        );

                    validateMintPaymentConfiguration(chain.id, protocolFee, erc20PaymentAddress);
                    console.log("DEBUG: Contract data fetched:", { protocolFee, erc20PaymentAddress, mintFee });

                    return formatUnits(mintFee, 6);
                },
                network,
                payTo: EVM_ADDRESS,
            },
        ],
        description: actionName,
        mimeType: "application/json",
        extensions: {
            bazaar: {
                discoverable: true,
                category: "nfts",
                tags: ["mint", "nft", "nfts", "erc721"],
            },
        },        
    };
}

const TESTNET_CHAIN_IDS = ["84532", "11155111", "80002"];

const SUPPORTED_CHAINS: Record<string, Chain> = {
    "8453": base,
    "84532": baseSepolia,
};

function isTestnet(chainId: string | number): boolean {
    return TESTNET_CHAIN_IDS.includes(String(chainId));
}

function formatLogoUrl(ipfsUrl?: string | null): string | undefined {
    if (!ipfsUrl) return undefined;
    if (ipfsUrl.startsWith("ipfs://")) {
        return ipfsUrl.replace("ipfs://", "https://ipfs.io/ipfs/");
    }
    return ipfsUrl;
}

export async function GET(req: NextRequest, props: { params: Promise<{ chainId: string, contractAddress: string, amount: string }> }) {
    const params = await props.params;
    const { chainId, contractAddress, amount } = params;

    // Fetch minting page info from Supabase
    const mintingPageInfo = await getMintingPageLogoAndName(chainId, contractAddress);

    const chain = SUPPORTED_CHAINS[chainId];
    if (!chain) {
        return NextResponse.json(
            {
                error: `Unsupported chainId: ${chainId}`,
                supportedChainIds: Object.keys(SUPPORTED_CHAINS),
            },
            { status: 400 }
        );
    }

    const testnet = isTestnet(chain.id);

    const appName = mintingPageInfo?.name || process.env.APP_NAME || "Next x402 Demo";
    const appLogo = formatLogoUrl(mintingPageInfo?.ipfs_logo) || process.env.APP_LOGO || "/x402-icon-blue.png";
    const actionName = `Mint ${amount} NFT${amount === "1" ? "" : "s"} from ${mintingPageInfo?.name}`;

    const dynamicPaywall = createPaywall()
        .withNetwork(evmPaywall)
        .withConfig({
            appName,
            appLogo,
            testnet,
        })
        .build();

    // Use withX402VerifyOnly instead of withX402
    // This verifies payment but does NOT settle - we handle settlement on-chain
    const protectedHandler = withX402VerifyOnly(
        (_request: NextRequest, context: VerifyOnlyContext) => handler(context, chain, contractAddress, amount),
        getMintNftX402Config(actionName, chain, `eip155:${chain.id}`, contractAddress, amount) as any,
        server,
        undefined,
        dynamicPaywall
    );

    return protectedHandler(req);
}
