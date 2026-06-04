import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, formatUnits, Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { server } from "../../../../../../proxy";
import { getMintingPageLogoAndName } from "../../../../../../lib/supabase";
import { withX402VerifyOnly, VerifyOnlyContext, PaymentAuthorization } from "../../../../../../lib/withX402VerifyOnly";
import { createPaywall } from '@x402/paywall';
import { evmPaywall } from '@x402/paywall/evm';
import { readMintContractDataWithMulticall, validateMintPaymentConfiguration } from "../../../../../../lib/mintContractReads";

const EVM_ADDRESS = process.env.EVM_ADDRESS as `0x${string}`;
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
const FORWARDER_CONTRACT_ADDRESS = "0x58C94dDa09A070cF40CB024fCeC7aB04f7223609" as `0x${string}`;

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
        
        const account = privateKeyToAccount(PRIVATE_KEY);
        const walletClient = createWalletClient({
            account,
            chain,
            transport: http(),
        });

        const mintWithAuthorizationAbi = [{
            "inputs": [
                { "internalType": "address", "name": "erc20CollectionPaymentAddress", "type": "address" },
                { "internalType": "address", "name": "collection", "type": "address" },
                { "internalType": "uint256", "name": "erc20Amount", "type": "uint256" },
                { "internalType": "address", "name": "payer", "type": "address" },
                { "internalType": "uint256", "name": "validAfter", "type": "uint256" },
                { "internalType": "uint256", "name": "validBefore", "type": "uint256" },
                { "internalType": "bytes32", "name": "nonce", "type": "bytes32" },
                { "internalType": "uint8", "name": "v", "type": "uint8" },
                { "internalType": "bytes32", "name": "r", "type": "bytes32" },
                { "internalType": "bytes32", "name": "s", "type": "bytes32" },
                { "internalType": "address", "name": "to", "type": "address" },
                { "internalType": "uint256", "name": "nftAmount", "type": "uint256" }
            ],
            "name": "mintWithAuthorization",
            "outputs": [],
            "stateMutability": "payable",
            "type": "function"
        }];

        const hash = await walletClient.writeContract({
            address: FORWARDER_CONTRACT_ADDRESS,
            abi: mintWithAuthorizationAbi,
            functionName: 'mintWithAuthorization',
            args: [
                USDC_ADDRESS as `0x${string}`,
                contractAddress as `0x${string}`,
                BigInt(ctx.paymentAuth.authorization.value),
                ctx.paymentAuth.authorization.from as `0x${string}`,
                BigInt(ctx.paymentAuth.authorization.validAfter),
                BigInt(ctx.paymentAuth.authorization.validBefore),
                ctx.paymentAuth.authorization.nonce as `0x${string}`,
                parseInt(ctx.paymentAuth.signature.startsWith("0x") ? ctx.paymentAuth.signature.slice(130, 132) : ctx.paymentAuth.signature.slice(128, 130), 16),
                (ctx.paymentAuth.signature.startsWith("0x") ? ctx.paymentAuth.signature.slice(0, 66) : `0x${ctx.paymentAuth.signature.slice(0, 64)}`) as `0x${string}`,
                (ctx.paymentAuth.signature.startsWith("0x") ? `0x${ctx.paymentAuth.signature.slice(66, 130)}` : `0x${ctx.paymentAuth.signature.slice(64, 128)}`) as `0x${string}`,
                ctx.paymentAuth.authorization.from as `0x${string}`, // Minting to the payer
                amount
            ]
        });

        // Comprobar que ha ido bien
        const txReceipt = await publicClient.waitForTransactionReceipt({ hash });
        if (txReceipt.status !== "success") {
            console.error("Transaction failed:", txReceipt);
            throw new Error("Minting transaction failed");
        }
        console.log("Minting transaction successful! Hash:", hash);

        // Return the authorization data for on-chain execution
        // The client/contract can use this to call transferWithAuthorization atomically
        return NextResponse.json({
            success: true,
            message: "Payment verified and minted on-chain!",
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
                payTo: FORWARDER_CONTRACT_ADDRESS,
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
