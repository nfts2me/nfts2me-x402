import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
// import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createWalletClient, createPublicClient, http, formatUnits, Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { server } from "../../../../../../proxy";
import { getMintingPageLogoAndName } from "../../../../../../lib/supabase";
import { createPaywall } from '@x402/paywall';
import { evmPaywall } from '@x402/paywall/evm';

const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
const EVM_ADDRESS = process.env.EVM_ADDRESS as `0x${string}`;
const USDC_ADDRESSES: Record<number, `0x${string}`> = {
    8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base
    84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
};


const ABI_CHECKS = [
    { inputs: [], name: "protocolFee", outputs: [{ type: "uint256" }], type: "function", stateMutability: "view" },
    { inputs: [], name: "erc20PaymentAddress", outputs: [{ type: "address" }], type: "function", stateMutability: "view" },
    { inputs: [{ type: "uint256", name: "amount" }], name: "mintFee", outputs: [{ type: "uint256" }], type: "function", stateMutability: "view" },
    { inputs: [], name: "name", outputs: [{ type: "string" }], type: "function", stateMutability: "view" }
] as const;

/**
 * Weather API endpoint handler
 *
 * This handler returns weather data after payment verification.
 * Payment is only settled after a successful response (status < 400).
 *
 * @param req - Incoming Next.js request
 * @returns JSON response with weather data
 */
// Define the expected response type based on the report example
type SuccessResponse = {
    success: boolean;
    message: string;
    txHash: `0x${string}`;
    image?: string | null;
};

const handler = async (req: NextRequest, chain: Chain) => {
    try {
        const segments = req.url.split("/");
        const contractAddress = segments.at(-2)!;
        const amountStr = segments.at(-1)!;
        const amount = BigInt(amountStr || "1");

        // We re-use validation or assume validation passed due to paywall check, 
        // but for safety in the mint action we should probably use the same params.
        const publicClient = createPublicClient({
            chain,
            transport: http()
        });
        const [protocolFee, contractPaymentAddress, mintFee] = await Promise.all([
            publicClient.readContract({
                address: contractAddress as `0x${string}`,
                abi: ABI_CHECKS,
                functionName: "protocolFee"
            }),
            publicClient.readContract({
                address: contractAddress as `0x${string}`,
                abi: ABI_CHECKS,
                functionName: "erc20PaymentAddress"
            }),
            publicClient.readContract({
                address: contractAddress as `0x${string}`,
                abi: ABI_CHECKS,
                functionName: "mintFee",
                args: [amount]
            })
        ]);

        const USDC_ADDRESS = USDC_ADDRESSES[chain.id];
        if (!USDC_ADDRESS) {
            throw new Error(`USDC address not found for chain ${chain.id}`);
        }

        if (protocolFee !== 0n) {
            throw new Error("Protocol fee is not zero");
        }
        if (contractPaymentAddress !== USDC_ADDRESS) {
            throw new Error("ERC20 payment address is not USDC");
        }

        const erc20PaymentAddress = contractPaymentAddress;

        const account = privateKeyToAccount(PRIVATE_KEY);
        const client = createWalletClient({
            account,
            chain,
            transport: http(),
        });

        // Try to get user address from headers (if injected) or fallback to server wallet
        const USER_ADDRESS = (req.headers.get("x-payment-from") || account.address) as `0x${string}`;

        console.log("Minting to USER_ADDRESS", USER_ADDRESS);

        const allowance = await publicClient.readContract({
            address: erc20PaymentAddress,
            abi: [{ name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] }],
            functionName: "allowance",
            args: [account.address, contractAddress as `0x${string}`]
        }) as bigint;
        console.log("Allowance: ", allowance, "Mint fee: ", mintFee);

        if (allowance < mintFee) {
            console.log("Approving ERC20...");
            const hash = await client.writeContract({
                address: erc20PaymentAddress,
                abi: [{ name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }],
                functionName: "approve",
                args: [contractAddress as `0x${string}`, mintFee],
            });
            // await publicClient.waitForTransactionReceipt({ hash });
            console.log("Approved!");
        }

        // Execute Mint
        const hash = await client.writeContract({
            address: contractAddress as `0x${string}`,
            abi: [
                { "inputs": [{ "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }, { "internalType": "address", "name": "affiliate", "type": "address" }], "name": "mintTo", "outputs": [], "stateMutability": "payable", "type": "function" },
                { "inputs": [{ "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "mintTo", "outputs": [], "stateMutability": "payable", "type": "function" }
            ],
            functionName: 'mintTo',
            args: [USER_ADDRESS, amount]
        });

        return NextResponse.json({
            success: true,
            message: "Minting successful!",
            txHash: hash
        });

    } catch (error) {
        console.error("Minting failed:", error);
        return NextResponse.json({ error: "Minting failed" }, { status: 500 }) as unknown as NextResponse<SuccessResponse>;
    }
};

// La configuración de x402 para el pago.
// Incluye el precio, la red, el contrato y la cantidad.
function getMintNftX402Config(actionName: string, chain: Chain, network: string, contractAddress: string, amount: string) {
    return {
        accepts: [
            {
                scheme: "exact",
                price: async (context: any) => {
                    const publicClient = createPublicClient({
                        chain,
                        transport: http()
                    });

                    const [protocolFee, erc20PaymentAddress, mintFee] = await Promise.all([
                        publicClient.readContract({
                            address: contractAddress as `0x${string}`,
                            abi: ABI_CHECKS,
                            functionName: "protocolFee"
                        }),
                        publicClient.readContract({
                            address: contractAddress as `0x${string}`,
                            abi: ABI_CHECKS,
                            functionName: "erc20PaymentAddress"
                        }),
                        publicClient.readContract({
                            address: contractAddress as `0x${string}`,
                            abi: ABI_CHECKS,
                            functionName: "mintFee",
                            args: [BigInt(amount)]
                        })
                    ]);
                    const USDC_ADDRESS = USDC_ADDRESSES[chain.id];
                    if (!USDC_ADDRESS) {
                        throw new Error(`USDC address not found for chain ${chain.id}`);
                    }

                    if (protocolFee !== 0n) {
                        throw new Error("Protocol fee is not zero");
                    }
                    if (erc20PaymentAddress !== USDC_ADDRESS) {
                        throw new Error("ERC20 payment address is not USDC");
                    }
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
            bazaar: { // 666 nota alberto, revisar bazaar aquí https://x402.gitbook.io/x402/core-concepts/bazaar-discovery-layer y aquí: https://x402.gitbook.io/x402/core-concepts/bazaar-discovery-layer#adding-metadata 
                discoverable: true,
                category: "nfts",
                tags: ["mint", "nft", "nfts", "erc721"],
            },
        },
    };
}

const TESTNET_CHAIN_IDS = ["84532", "11155111", "80002"];

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
    // console.log("LOG MIO: GET /api/mint/[chainId]/[contractAddress]/[amount]");
    const params = await props.params;
    const { chainId, contractAddress, amount } = params;

    // Fetch minting page info from Supabase
    const mintingPageInfo = await getMintingPageLogoAndName(chainId, contractAddress);
    // console.log("LOG MIO: mintingPageInfo", mintingPageInfo);

    // Default to testnet=true if we can't determine, or follow user preference. 
    // User asked "indicar si es testnet o no en funcion del chainid".
    const testnet = isTestnet(chainId);

    const appName = mintingPageInfo?.name || process.env.APP_NAME || "Next x402 Demo";
    const appLogo = formatLogoUrl(mintingPageInfo?.ipfs_logo) || process.env.APP_LOGO || "/x402-icon-blue.png";
    const actionName = `Mint ${amount} NFT${amount === "1" ? "" : "s"} from ${mintingPageInfo?.name}`;
    // console.log("LOG MIO: appName", appName);
    // console.log("LOG MIO: appLogo", appLogo);

    const dynamicPaywall = createPaywall()
        .withNetwork(evmPaywall)
        .withConfig({
            appName,
            appLogo,
            testnet,
        })
        .build();

    // console.log("LOG MIO: dynamicPaywall", dynamicPaywall);

    const chain = chainId === "84532" ? baseSepolia : base;
    // console.log("LOG MIO: chain", chain);
    const protectedHandler = withX402(
        ((req: NextRequest) => handler(req, chain)) as any,
        getMintNftX402Config(actionName, chain, `eip155:${chainId}`, contractAddress, amount) as any,
        server,
        undefined,
        dynamicPaywall
    );

    // console.log("LOG MIO: protectedHandler", protectedHandler);

    return protectedHandler(req);
}
