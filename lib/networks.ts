import { Chain, zeroAddress } from "viem";
import { arc as viemArc, base, baseSepolia, polygon, robinhood } from "viem/chains";

/** viem still points Arc at explorer.arc.io; Etherscan is the canonical explorer. */
export const arc: Chain = {
    ...viemArc,
    blockExplorers: {
        default: {
            name: "Etherscan",
            url: "https://arc.etherscan.io",
        },
    },
};

export { robinhood };

export const USDC_ADDRESSES: Record<number, `0x${string}`> = {
    137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // Polygon Mainnet
    8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base
    84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
    // Arc native USDC ERC-20 interface (6 decimals). Same address on testnet.
    5042: "0x3600000000000000000000000000000000000000",
};

/** Robinhood Chain has no Circle USDC. Settlement asset is Paxos USDG (6 decimals). */
export const USDG_ADDRESSES: Record<number, `0x${string}`> = {
    4663: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
};

// Lo desplegamos nosotros.
// Base/Polygon/Sepolia: N2MMintmasterX402.sol
// Arc (5042): N2MMintmasterX402Arc.sol (mintWithAuthorizationNativeUSDC; sin pool).
export const FORWARDER_CONTRACT_ADDRESSES: Record<number, `0x${string}`> = {
    137: "0x52f17BEdBb1BC243000524a4622F5D621A75c713", // Polygon Mainnet
    8453: "0x5F5a6890000d932B4a8cec5b408F26339A84437C", // Base mainnet
    84532: "0xDD164E8A0E4d1E5C6ca6e59F85223Aa56506080D", // BaseSepolia
    5042: "0x5F982E5590173e756B481508841998A0bE56138F", // Arc (5042) N2MMintmasterX402Arc
};

export const TESTNET_CHAIN_IDS = ["84532", "11155111", "80002"];

/** Native gas is USDC (18 decimals); ERC-20 USDC (6 decimals) is the same asset. */
export const NATIVE_USDC_CHAIN_IDS = new Set([5042]);

export function isNativeUsdcChain(chainId: string | number): boolean {
    return NATIVE_USDC_CHAIN_IDS.has(Number(chainId));
}

/** 1 native unit (1e18) = 1 USDC = 1e6 ERC-20 units. */
export const NATIVE_USDC_QUOTE_FOR_ONE = 10n ** 6n;

/** Native USDC (18 decimals) → ERC-20 USDC (6 decimals). Ceiling so the forwarder check cannot fail. */
export const NATIVE_TO_ERC20_USDC_SCALE = 10n ** 12n;

export function nativeUsdcToErc20Amount(nativeAmount: bigint): bigint {
    if (nativeAmount === 0n) return 0n;
    return (nativeAmount + NATIVE_TO_ERC20_USDC_SCALE - 1n) / NATIVE_TO_ERC20_USDC_SCALE;
}

export const USDC_EIP712: Record<number, { name: string; version: string }> = {
    5042: { name: "USDC", version: "2" },
};

/**
 * Redes que verifica nuestro facilitador interno (in-process, sin HTTP), no PayAI.
 * Añadir aquí una chain de SUPPORTED_CHAINS basta para cubrirla.
 */
export const SELF_FACILITATOR_CHAINS: Record<string, Chain> = {
    "5042": arc,
};

export function usesSelfFacilitator(chainId: string | number): boolean {
    return String(chainId) in SELF_FACILITATOR_CHAINS;
}

export const SUPPORTED_CHAINS: Record<string, Chain> = {
    "137": polygon,
    "8453": base,
    "84532": baseSepolia,
    "5042": arc,
    // Robinhood needs Permit2 + USDG; not enabled.
    // "4663": robinhood,
};

// Coger las pools de aquí. https://app.uniswap.org/explore/pools/base
// Si no está, ir por ejemplo aqúi: https://sepolia.basescan.org/address/0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24#readContract
// Go to the Uniswap V3 Factory Contract on Base
// - Sepolia Basescan (Factory Address: 0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24).
// - Click on the Read Contract tab.
// - Locate the getPool function.
// - Input the following parameters into the fields:
//   * tokenA: 0x4200000000000000000000000000000000000006 (WETH)
//   * tokenB: 0x036cbd53842c5426634e7929541ec2318f3dcf7e (USDC)
//   *   fee: 3000 (This represents the standard 0.3% fee tier. 
//   *   fee: Use 500 for 0.05% or
//   *   fee: 10000 for 1%).

// Base Sepolia, la que más movimiento parece tener:
// https://sepolia.basescan.org/address/0x46880b404CD35c165EDdefF7421019F8dD25F4Ad#tokentxns

// Base, listado: https://app.uniswap.org/explore/pools/base
// La más barata: https://app.uniswap.org/explore/pools/base/0xd0b53D9277642d899DF5C87A3966A349A798F224
export const WETH_USDC_POOLS: Record<number, `0x${string}`> = {
    137: "0xB6e57ed85c4c9dbfEF2a68711e9d6f36c56e0FcB", // Polygon Mainnet
    8453: "0xd0b53D9277642d899DF5C87A3966A349A798F224", // Base mainnet
    84532: "0x46880b404CD35c165EDdefF7421019F8dD25F4Ad", // Base Sepolia
};

// URLs alternativas de RPC por cadena (añadir manualmente según necesidad).
// El transporte fallback usa el RPC por defecto de viem como primario y estas como respaldo.
export const RPC_URLS: Record<number, string[]> = {
    137: [],
    8453: ["https://gateway.tenderly.co/public/base"],
    84532: [
        "https://base-sepolia-rpc.publicnode.com",
        "https://base-sepolia.gateway.tenderly.co",
    ],
    5042: [
        "https://rpc.blockdaemon.mainnet.arc.io",
        "https://rpc.drpc.mainnet.arc.io",
        "https://rpc.quicknode.mainnet.arc.io",
    ],
    4663: ["https://rpc.ordofi.network"],
};

export const MULTICALL3_ADDRESSES: Record<number, readonly `0x${string}`[]> = {
    137: ["0xcA11bde05977b3631167028862bE2a173976CA11"], // Polygon Mainnet
    8453: ["0xcA11bde05977b3631167028862bE2a173976CA11"], // Base mainnet
    84532: ["0xcA11bde05977b3631167028862bE2a173976CA11"], // Base Sepolia
    5042: ["0xcA11bde05977b3631167028862bE2a173976CA11"], // Arc Mainnet
    4663: ["0xcA11bde05977b3631167028862bE2a173976CA11"], // Robinhood Chain
};

export function isTestnet(chainId: string | number): boolean {
    return TESTNET_CHAIN_IDS.includes(String(chainId));
}

export function getCollectionMintingPageUrl(
    contractAddress: string,
    chainId: string | number,
): string {
    return `https://${contractAddress}_${chainId}.nfts2.me/`;
}

export type PaymentTokenInfo = {
    kind: "native" | "usdc" | "other";
    label: "Native" | "USDC" | "Other";
    tokenAddress: string;
    contractPaymentAddress: string;
};

export function describePaymentToken(
    chainId: number,
    paymentAddress?: string | null,
): PaymentTokenInfo | undefined {
    if (!paymentAddress) return undefined;
    const normalized = paymentAddress.toLowerCase();
    if (normalized === zeroAddress.toLowerCase()) {
        return {
            kind: "native",
            label: "Native",
            tokenAddress: zeroAddress,
            contractPaymentAddress: paymentAddress,
        };
    }
    const usdc = USDC_ADDRESSES[chainId];
    if (usdc && normalized === usdc.toLowerCase()) {
        return {
            kind: "usdc",
            label: "USDC",
            tokenAddress: usdc,
            contractPaymentAddress: paymentAddress,
        };
    }
    return {
        kind: "other",
        label: "Other",
        tokenAddress: paymentAddress,
        contractPaymentAddress: paymentAddress,
    };
}
