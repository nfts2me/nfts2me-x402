import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, formatUnits, Chain, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { server } from "../../../../../proxy";
import { getMintingPageLogoAndName } from "../../../../../lib/supabase";
import { withX402VerifyOnly, VerifyOnlyContext, PaymentAuthorization } from "../../../../../lib/withX402VerifyOnly";
import { createPaywall } from '@x402/paywall';
import { evmPaywall } from '@x402/paywall/evm';
import { readMintContractDataWithMulticall, getUsdcAddress, ZERO_ADDRESS, getWETHUSDCPoolAddress } from "../../../../../lib/mintContractReads";

const isDev = process.env.NODE_ENV === "development";

function logDev(...args: any[]) {
    if (isDev) {
        console.log(...args);
    }
}

const EVM_ADDRESS = process.env.EVM_ADDRESS as `0x${string}`;
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
const FORWARDER_CONTRACT_ADDRESS = "0xDD164E8A0E4d1E5C6ca6e59F85223Aa56506080D" as `0x${string}`; // Versión con swap y quote.
const SLIPPAGE_MULTIPLIER: bigint = 101n;

const COMMISSION_ENABLED = (() => {
    const raw = process.env.COMMISSION_ENABLED?.trim().toLowerCase();
    if (raw === undefined) return true; // enabled by default
    return raw === "true" || raw === "1" || raw === "yes";
})();
const COMMISSION_AMOUNT = BigInt(process.env.COMMISSION_AMOUNT ?? "20000");
const COMMISSION_DECIMALS = Number(process.env.COMMISSION_DECIMALS ?? "6");

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
        protocolFee: string;
        commissionEnabled: boolean;
        commissionAmount: string;
        commissionDecimals: number;
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
async function convertEthToUsdc(
    publicClient: ReturnType<typeof createPublicClient>,
    poolAddress: `0x${string}`,
    ethAmount: bigint
): Promise<bigint> {
    if (ethAmount === 0n) return 0n;

    const quoteAbi = [{
        "inputs": [
            { "internalType": "address", "name": "pool", "type": "address" },
            { "internalType": "uint256", "name": "nativeAmount", "type": "uint256" }
        ],
        "name": "quoteUSDCForNative",
        "outputs": [{ "internalType": "uint256", "name": "usdcAmount", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    }] as const;

    const usdcAmount = await publicClient.readContract({
        address: FORWARDER_CONTRACT_ADDRESS,
        abi: quoteAbi,
        functionName: "quoteUSDCForNative",
        args: [poolAddress, ethAmount],
    });

    return usdcAmount;
}

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
        const { protocolFee: protocolFeeForOne, erc20PaymentAddress: contractPaymentAddress, mintFee } =
            await readMintContractDataWithMulticall(
                publicClient,
                chain.id,
                contractAddress as `0x${string}`,
                amount,
            );
        const totalProtocolFee = protocolFeeForOne * amount;

        const USDC_ADDRESS = getUsdcAddress(chain.id);
        if (contractPaymentAddress !== USDC_ADDRESS && contractPaymentAddress !== ZERO_ADDRESS) {
            throw new Error("Unsupported payment token. Only USDC and Native ETH are supported.");
        }

        // Log the authorization data for debugging
        logDev("VERIFY-ONLY HANDLER: Payment verified!");
        logDev("Authorization:", JSON.stringify(ctx.paymentAuth, null, 2));
        logDev("From:", ctx.paymentAuth.authorization.from);
        logDev("To:", ctx.paymentAuth.authorization.to);
        logDev("Value:", ctx.paymentAuth.authorization.value);

        const account = privateKeyToAccount(PRIVATE_KEY);
        const walletClient = createWalletClient({
            account,
            chain,
            transport: http(),
        });

        const forwarderAbi = [
            {
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
            },
            {
                "inputs": [
                    { "internalType": "address", "name": "erc20CollectionPaymentAddress", "type": "address" },
                    { "internalType": "address", "name": "collection", "type": "address" },
                    { "internalType": "address", "name": "pool", "type": "address" },
                    { "internalType": "uint256", "name": "erc20Amount", "type": "uint256" },
                    { "internalType": "uint256", "name": "mintingFeeAmount", "type": "uint256" },
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
                "name": "mintWithAuthorizationNative",
                "outputs": [],
                "stateMutability": "payable",
                "type": "function"
            },
            {
                "inputs": [
                    { "internalType": "address", "name": "erc20CollectionPaymentAddress", "type": "address" },
                    { "internalType": "address", "name": "collection", "type": "address" },
                    { "internalType": "address", "name": "pool", "type": "address" },
                    { "internalType": "uint256", "name": "erc20Amount", "type": "uint256" },
                    { "internalType": "uint256", "name": "protocolFeeAmount", "type": "uint256" },
                    { "internalType": "uint256", "name": "erc20MintingFeeAmount", "type": "uint256" },
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
                "name": "mintWithAuthorizationUSDCWithNativeProtocolFee",
                "outputs": [],
                "stateMutability": "payable",
                "type": "function"
            }
        ] as const;

        const isErc20Usdc = contractPaymentAddress.toLowerCase() === USDC_ADDRESS.toLowerCase();
        const isErc20Native = contractPaymentAddress === ZERO_ADDRESS;

        let functionName: 'mintWithAuthorization' | 'mintWithAuthorizationNative' | 'mintWithAuthorizationUSDCWithNativeProtocolFee';
        let args: any[];

        // Extract signature components
        const v = parseInt(ctx.paymentAuth.signature.startsWith("0x") ? ctx.paymentAuth.signature.slice(130, 132) : ctx.paymentAuth.signature.slice(128, 130), 16);
        const r = (ctx.paymentAuth.signature.startsWith("0x") ? ctx.paymentAuth.signature.slice(0, 66) : `0x${ctx.paymentAuth.signature.slice(0, 64)}`) as `0x${string}`;
        const s = (ctx.paymentAuth.signature.startsWith("0x") ? `0x${ctx.paymentAuth.signature.slice(66, 130)}` : `0x${ctx.paymentAuth.signature.slice(64, 128)}`) as `0x${string}`;

        const erc20Amount = BigInt(ctx.paymentAuth.authorization.value);
        const payer = ctx.paymentAuth.authorization.from as `0x${string}`;
        const validAfter = BigInt(ctx.paymentAuth.authorization.validAfter);
        const validBefore = BigInt(ctx.paymentAuth.authorization.validBefore);
        const nonce = ctx.paymentAuth.authorization.nonce as `0x${string}`;
        const to = ctx.paymentAuth.authorization.from as `0x${string}`;

        if (isErc20Usdc) {
            if (totalProtocolFee === 0n) {
                logDev("Case 1: USDC, no protocol fee");
                // Case 1: USDC, no protocol fee
                functionName = 'mintWithAuthorization';
                args = [
                    USDC_ADDRESS,
                    contractAddress as `0x${string}`,
                    erc20Amount,
                    payer,
                    validAfter,
                    validBefore,
                    nonce,
                    v,
                    r,
                    s,
                    to,
                    amount
                ];
            } else {
                logDev("Case 2: USDC, with protocol fee (native ETH)");
                // Case 2: USDC, with protocol fee (native ETH)
                const poolAddress = getWETHUSDCPoolAddress(chain.id);
                functionName = 'mintWithAuthorizationUSDCWithNativeProtocolFee';
                args = [
                    USDC_ADDRESS,
                    contractAddress as `0x${string}`,
                    poolAddress,
                    erc20Amount,
                    totalProtocolFee,
                    mintFee,
                    payer,
                    validAfter,
                    validBefore,
                    nonce,
                    v,
                    r,
                    s,
                    to,
                    amount
                ];
            }
        } else if (isErc20Native) {
            if (totalProtocolFee === 0n) {
                logDev("Case 3: Native ETH, no protocol fee");
            } else {
                logDev("Case 4: Native ETH, with protocol fee (native ETH)");
            }
            // Case 3 & 4: Native ETH
            const poolAddress = getWETHUSDCPoolAddress(chain.id);
            const mintingFeeAmount = totalProtocolFee === 0n ? mintFee : mintFee + totalProtocolFee;
            functionName = 'mintWithAuthorizationNative';
            args = [
                USDC_ADDRESS,
                contractAddress as `0x${string}`,
                poolAddress,
                erc20Amount,
                mintingFeeAmount,
                payer,
                validAfter,
                validBefore,
                nonce,
                v,
                r,
                s,
                to,
                amount
            ];
            logDev("DEBUG: Args: ", args);
        } else {
            throw new Error("Invalid payment configuration");
        }

        logDev("Before sending transaction");
        const hash = await walletClient.writeContract({
            address: FORWARDER_CONTRACT_ADDRESS,
            abi: forwarderAbi as any,
            functionName: functionName as any,
            args: args as any
        });

        logDev("Minting transaction sent. Hash:", hash);

        // Comprobar que ha ido bien
        const txReceipt = await publicClient.waitForTransactionReceipt({ hash });
        if (txReceipt.status !== "success") {
            console.error("Transaction failed:", txReceipt);
            throw new Error("Minting transaction failed");
        }
        logDev("Minting transaction successful! Hash:", hash);
        const etherscanTxUrl = `${chain.blockExplorers?.default.url}/tx/${hash}`;

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
                protocolFee: totalProtocolFee.toString(),
                commissionEnabled: COMMISSION_ENABLED,
                commissionAmount: COMMISSION_ENABLED ? COMMISSION_AMOUNT.toString() : "0",
                commissionDecimals: COMMISSION_DECIMALS,
                usdcAddress: USDC_ADDRESS,
            },
            mintTxHash: hash,
            etherscanTxUrl: etherscanTxUrl,
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

                    const { protocolFee: protocolFeeForOne, erc20PaymentAddress, mintFee } =
                        await readMintContractDataWithMulticall(
                            publicClient,
                            chain.id,
                            contractAddress as `0x${string}`,
                            BigInt(amount),
                        );

                    const totalProtocolFee = protocolFeeForOne * BigInt(amount);

                    const USDC_ADDRESS = getUsdcAddress(chain.id);
                    if (erc20PaymentAddress !== USDC_ADDRESS && erc20PaymentAddress !== ZERO_ADDRESS) {
                        throw new Error("Unsupported payment token. Only USDC and Native ETH are supported.");
                    }

                    const isErc20Usdc = erc20PaymentAddress.toLowerCase() === USDC_ADDRESS.toLowerCase();
                    const isErc20Native = erc20PaymentAddress === ZERO_ADDRESS;

                    let finalPrice: bigint;

                    if (isErc20Usdc) {
                        if (totalProtocolFee === 0n) {
                            finalPrice = mintFee;
                        } else {
                            const poolAddress = getWETHUSDCPoolAddress(chain.id);
                            const usdcProtocolFee = await convertEthToUsdc(publicClient, poolAddress, totalProtocolFee);
                            const usdcProtocolFeeWithSlippage = (usdcProtocolFee * SLIPPAGE_MULTIPLIER + 99n) / 100n;
                            finalPrice = mintFee + usdcProtocolFeeWithSlippage;
                        }
                    } else if (isErc20Native) {
                        const poolAddress = getWETHUSDCPoolAddress(chain.id);
                        if (totalProtocolFee === 0n) {
                            const usdcMintFee = await convertEthToUsdc(publicClient, poolAddress, mintFee);
                            const usdcMintFeeWithSlippage = (usdcMintFee * SLIPPAGE_MULTIPLIER + 99n) / 100n;
                            finalPrice = usdcMintFeeWithSlippage;
                        } else {
                            const totalNativeFee = mintFee + totalProtocolFee;
                            const usdcTotalFee = await convertEthToUsdc(publicClient, poolAddress, totalNativeFee);
                            const usdcTotalFeeWithSlippage = (usdcTotalFee * SLIPPAGE_MULTIPLIER + 99n) / 100n;
                            finalPrice = usdcTotalFeeWithSlippage;
                        }
                    } else {
                        throw new Error("Invalid payment configuration");
                    }

                    const commission = COMMISSION_ENABLED ? COMMISSION_AMOUNT : 0n;
                    const price = finalPrice + commission;
                    logDev("DEBUG: Contract data fetched:", { totalProtocolFee, erc20PaymentAddress, mintFee, commission, commissionEnabled: COMMISSION_ENABLED, finalPrice: finalPrice.toString(), price: price.toString() });

                    return formatUnits(price, COMMISSION_DECIMALS);
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
                tags: ["mint", "nft", "nfts", "erc721", "nfts2me"],
                info: {
                    input: {
                        type: "http",
                        method: "GET",
                        pathParams: {
                            chainId: chain.id.toString(),
                            contractAddress: contractAddress,
                            amount: amount
                        },
                        routeTemplate: "/x402mint/:chainId/:contractAddress/:amount"
                    },
                    inputSchema: {
                        type: "object",
                        properties: {
                            chainId: {
                                type: "string",
                                description: "EVM Chain ID (8453 for Base Mainnet, 84532 for Base Sepolia)"
                            },
                            contractAddress: {
                                type: "string",
                                description: "The EVM address of the NFT collection contract"
                            },
                            amount: {
                                type: "string",
                                description: "The number of NFTs to mint"
                            }
                        },
                        required: ["chainId", "contractAddress", "amount"]
                    },
                    output: {
                        type: "json",
                        example: {
                            success: true,
                            message: "Payment verified and minted on-chain!",
                            mintTxHash: "0x...",
                            etherscanTxUrl: "https://..."
                        },
                        schema: {
                            type: "object",
                            properties: {
                                success: { type: "boolean" },
                                message: { type: "string" },
                                mintTxHash: { type: "string" },
                                etherscanTxUrl: { type: "string" }
                            },
                            required: ["success", "message", "mintTxHash"]
                        }
                    }
                }
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

    // 1. Sanitize and validate chainId
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

    // 2. Sanitize and validate contractAddress using Viem's isAddress
    if (!isAddress(contractAddress)) {
        return NextResponse.json(
            { error: `Invalid contract address format: ${contractAddress}` },
            { status: 400 }
        );
    }

    // 3. Sanitize and validate amount
    const parsedAmount = parseInt(amount, 10);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return NextResponse.json(
            { error: `Invalid mint amount: ${amount}. Must be a positive integer.` },
            { status: 400 }
        );
    }

    // Fetch minting page info from Supabase
    const mintingPageInfo = await getMintingPageLogoAndName(chainId, contractAddress);

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
        "/x402mint/:chainId/:contractAddress/:amount",
        undefined,
        dynamicPaywall
    );

    return protectedHandler(req);
}
