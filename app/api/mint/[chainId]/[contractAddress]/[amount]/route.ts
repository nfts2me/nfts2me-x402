import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
// import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createWalletClient, createPublicClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { server, paywall, evmAddress } from "../../../../../../proxy";
import { getMintingPageImage } from "../../../../../../lib/supabase";

const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
const EVM_ADDRESS = process.env.EVM_ADDRESS as `0x${string}`;
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

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

const handler = async (req: NextRequest) => {
    try {
        const segments = req.url.split("/");
        const chainId = segments.at(-3)!;
        const contractAddress = segments.at(-2)!;
        const amountStr = segments.at(-1)!;
        const amount = BigInt(amountStr || "1");

        console.log("Minting to contract", contractAddress, "amount", amount);

        // We re-use validation or assume validation passed due to paywall check, 
        // but for safety in the mint action we should probably use the same params.
        const publicClient = createPublicClient({
            chain: baseSepolia,
            transport: http()
        });
        const erc20PaymentAddress = USDC_ADDRESS;
        const [mintFee] = await Promise.all([
            publicClient.readContract({
                address: contractAddress as `0x${string}`,
                abi: ABI_CHECKS,
                functionName: "mintFee",
                args: [amount]
            })
        ]);

        const account = privateKeyToAccount(PRIVATE_KEY);
        const client = createWalletClient({
            account,
            chain: baseSepolia,
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
            await publicClient.waitForTransactionReceipt({ hash });
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

function getMintNftX402Config() {
    return {
        accepts: [
            {
                scheme: "exact",
                price: async (context: any) => {
                    // console.log("DEBUG: Price function called", context);
                    const segments = context.adapter.req.url.split("/");

                    const chainId = segments.at(-3)!;
                    const contractAddress = segments.at(-2)!;
                    const amount = segments.at(-1)!;

                    const publicClient = createPublicClient({
                        chain: baseSepolia,
                        transport: http()
                    });

                    const [protocolFee, erc20PaymentAddress, mintFee, name] = await Promise.all([
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
                        }),
                        publicClient.readContract({
                            address: contractAddress as `0x${string}`,
                            abi: ABI_CHECKS,
                            functionName: "name"
                        })
                    ]);
                    console.log("DEBUG: Contract data fetched:", { protocolFee, erc20PaymentAddress, mintFee, name });

                    return formatUnits(mintFee, 6);
                },
                network: "eip155:84532",
                payTo: EVM_ADDRESS,
            },
        ],
        description: "Mint NFT",
        mimeType: "application/json",
        /*extensions: {
            ...declareDiscoveryExtension({
                output: {
                    example: {
                        report: {
                            success: true,
                            message: "Minting successful!",
                            txHash:
                                "0x0d28bd6b9c2234f9a22767dd01e4c84250aa3c20ba44535616959d6d15505ee1",
                        },
                    },
                },
            }),
        },*/
    };
}

/**
 * Protected weather API endpoint using withX402 wrapper
 */
export const GET = withX402(
    handler as any,
    getMintNftX402Config() as any,
    server,
    undefined, // paywallConfig (using custom paywall from proxy.ts)
    paywall,
);
