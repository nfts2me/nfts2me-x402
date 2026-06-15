import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
// import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createWalletClient, createPublicClient, http, formatUnits, Chain, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { server } from "../../../../../../proxy";
import { getMintingPageLogoAndName } from "../../../../../../lib/supabase";
import { createPaywall } from '@x402/paywall';
import { evmPaywall } from '@x402/paywall/evm';
import {
    ERC20_ALLOWANCE_ABI,
    readMintContractDataWithMulticall,
    readMintContractDataWithOptimisticAllowance,
    validateMintPaymentConfiguration,
} from "../../../../../../lib/mintContractReads";

const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
const EVM_ADDRESS = process.env.EVM_ADDRESS as `0x${string}`;
const MINT_GAS_LIMIT = BigInt(process.env.MINT_GAS_LIMIT ?? "900000");
const APPROVE_GAS_LIMIT = BigInt(process.env.APPROVE_GAS_LIMIT ?? "100000");


/**
 * 
 * NFT API endpoint handler
 *
 * Protecting API Routes. Vía https://github.com/x402-foundation/x402/tree/main/typescript/packages/http/next#protecting-api-routes (antiguamente --> https://github.com/coinbase/x402/tree/main/typescript/packages/http/next#protecting-api-routes)
 *                            
 * Realmente lo que hacemos es proteger una API que es la que hace el minteo.
 * PROBLEMA? 
 * Settle se hace después del mint. 
 * Primero mira, lo llama habiendo validado la cantidad, se hace el mint, y luego se cobra.
 * WARNING: El pago puede que llegue en el mismo bloque por la preconfirmación, o en el siguiente.
 * En parte nos la jugamos un poco.
 * 
 * This is the recommended approach to protect API routes as it guarantees payment settlement only AFTER successful API responses (status < 400).
 * 
 * This handler mints x amount of NFTs after payment verification.
 * Payment is only settled after a successful response (status < 400).
 * 
 * 
 *
 * @param req - Incoming Next.js request
 * @returns JSON response with NFT mint result or error message
 */
// Define the expected response type based on the report example
type SuccessResponse = {
    success: boolean;
    message: string;
    txHash: `0x${string}`;
    image?: string | null;
};

const handler = async (
    req: NextRequest,
    chain: Chain,
    contractAddress: string,
    amountStr: string
) => {
    try {
        const amount = BigInt(amountStr || "1");

        // We re-use validation or assume validation passed due to paywall check, 
        // but for safety in the mint action we should probably use the same params.
        const publicClient = createPublicClient({
            chain,
            transport: http()
        });
        const account = privateKeyToAccount(PRIVATE_KEY);
        const client = createWalletClient({
            account,
            chain,
            transport: http(),
        });

        // El allowance es optimistic en el sentido de que suponemos que siempre va a ser USDC. Si no, abajo se soluciona.
        const {
            protocolFee,
            erc20PaymentAddress,
            mintFee,
            optimisticAllowance,
            optimisticAllowanceTokenAddress,
        } = await readMintContractDataWithOptimisticAllowance(
            publicClient,
            chain.id,
            contractAddress as `0x${string}`,
            amount,
            account.address,
            contractAddress as `0x${string}`,
        );

        console.log("DEBUG: Contract data fetched with optimistic allowance:", { protocolFee, erc20PaymentAddress, mintFee, optimisticAllowance, optimisticAllowanceTokenAddress });
        // Try to get user address from headers (if injected) or fallback to server wallet
        const USER_ADDRESS = (req.headers.get("x-payment-from") || account.address) as `0x${string}`;

        console.log("Minting to USER_ADDRESS", USER_ADDRESS);

        let allowance: bigint;

        if (optimisticAllowanceTokenAddress === erc20PaymentAddress && optimisticAllowance !== undefined) {
            allowance = optimisticAllowance;
        } else {
            // Future-proof fallback: if payment token is not the optimistic one, query allowance on the actual token.
            allowance = await publicClient.readContract({
                address: erc20PaymentAddress,
                abi: ERC20_ALLOWANCE_ABI,
                functionName: "allowance",
                args: [account.address, contractAddress as `0x${string}`],
            });
        }

        // Current business rule: minting requires USDC as payment token.
        validateMintPaymentConfiguration(chain.id, protocolFee, erc20PaymentAddress);


        // Para poder enviar en el mismo bloque el approve y el mint, tengo que forzar el nonce y el gas en la llamada del approve, y no esperar
        let nonce = await publicClient.getTransactionCount({
            address: account.address,
        });

        console.log("Allowance: ", allowance, "Mint fee: ", mintFee, "Nonce: ", nonce);

        if (allowance < mintFee) {
            console.log("Approving ERC20...");
            console.log("Nonce before approval: ", nonce);
            console.log("Timestamp before approval: ", Date.now());

            // Para poder enviar en el mismo bloque el approve y el mint, tengo que forzar el nonce y el gas en la llamada del approve, y no esperar
            const hashPromise = client.writeContract({
                address: erc20PaymentAddress,
                abi: [{ name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }],
                functionName: "approve",
                gas: APPROVE_GAS_LIMIT,
                nonce: nonce++, // Lo tengo que forzar para poder enviar las dos TXs a la vez.
                args: [contractAddress as `0x${string}`, mintFee],
            });
            console.log("Timestamp after approval tx sent: ", Date.now());
            if (false) {
                const hash = await hashPromise;
                // Ya no hace falta por lo del nonce y el gas, que hace que no compruebe nada.
                await publicClient.waitForTransactionReceipt({ hash });
                console.log("Approved!");

                // Aquí ya tenemos el approval
                // leer el nuevo valor de allowance después del approval
                allowance = await publicClient.readContract({
                    address: erc20PaymentAddress,
                    abi: ERC20_ALLOWANCE_ABI,
                    functionName: "allowance",
                    args: [account.address, contractAddress as `0x${string}`],
                });
                console.log("New allowance after approval: ", allowance);
            }

        }

        // Execute Mint
        console.log("Nonce before minting: ", nonce);
        const hash = await client.writeContract({
            address: contractAddress as `0x${string}`,
            abi: [
                { "inputs": [{ "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }, { "internalType": "address", "name": "affiliate", "type": "address" }], "name": "mintTo", "outputs": [], "stateMutability": "payable", "type": "function" },
                { "inputs": [{ "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "mintTo", "outputs": [], "stateMutability": "payable", "type": "function" }
            ],
            functionName: 'mintTo',
            gas: MINT_GAS_LIMIT,
            nonce: nonce, // Lo tengo que forzar para poder enviar las dos TXs a la vez.
            args: [USER_ADDRESS, amount]
        });

        // Comprobar que ha ido bien
        const txReceipt = await publicClient.waitForTransactionReceipt({ hash });
        if (txReceipt.status !== "success") {
            console.error("Transaction failed:", txReceipt);
            return NextResponse.json({ error: "Minting transaction failed" }, { status: 500 }) as unknown as NextResponse<SuccessResponse>;
        }

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
        // extensions: {
        //     bazaar: { // 666 nota alberto, revisar bazaar aquí https://x402.gitbook.io/x402/core-concepts/bazaar-discovery-layer y aquí: https://x402.gitbook.io/x402/core-concepts/bazaar-discovery-layer#adding-metadata 
        //         discoverable: true,
        //         category: "nfts",
        //         tags: ["mint", "nft", "nfts", "erc721"],
        //     },
        // },
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
    // console.log("LOG MIO: GET /api/mint/[chainId]/[contractAddress]/[amount]");
    const params = await props.params;
    const { chainId, contractAddress, amount } = params;

    // Fetch minting page info from Supabase
    const mintingPageInfo = await getMintingPageLogoAndName(chainId, contractAddress);
    // console.log("LOG MIO: mintingPageInfo", mintingPageInfo);

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

    // console.log("LOG MIO: chain", chain);
    const protectedHandler = withX402(
        ((request: NextRequest) => handler(request, chain, contractAddress, amount)) as any,
        getMintNftX402Config(actionName, chain, `eip155:${chain.id}`, contractAddress, amount) as any,
        server as any, //   server: x402ResourceServer,
        undefined, // paywallConfig?: PaywallConfig,
        dynamicPaywall, //   paywall?: PaywallProvider,
        // syncFacilitatorOnStart?: boolean (defaults to true)
    );

    // console.log("LOG MIO: protectedHandler", protectedHandler);

    return protectedHandler(req);
}
