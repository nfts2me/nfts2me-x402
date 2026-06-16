import { Chain } from "viem";
import { base, baseSepolia, polygon } from "viem/chains";

export const USDC_ADDRESSES: Record<number, `0x${string}`> = {
    137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // Polygon Mainnet
    8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base
    84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
};

export const FORWARDER_CONTRACT_ADDRESSES: Record<number, `0x${string}`> = {
    137: "0x52f17BEdBb1BC243000524a4622F5D621A75c713", // Polygon Mainnet
    8453: "0x5F5a6890000d932B4a8cec5b408F26339A84437C", // Base mainnet
    84532: "0xDD164E8A0E4d1E5C6ca6e59F85223Aa56506080D" // BaseSepolia
};

export const TESTNET_CHAIN_IDS = ["84532", "11155111", "80002"];

export const SUPPORTED_CHAINS: Record<string, Chain> = {
    "137": polygon,
    "8453": base,
    "84532": baseSepolia,
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

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;

export const MULTICALL3_ADDRESSES: Record<number, readonly `0x${string}`[]> = {
    137: ["0xcA11bde05977b3631167028862bE2a173976CA11"], // Polygon Mainnet
    8453: ["0xcA11bde05977b3631167028862bE2a173976CA11"], // Base mainnet
    84532: ["0xcA11bde05977b3631167028862bE2a173976CA11"], // Base Sepolia
};

export function isTestnet(chainId: string | number): boolean {
    return TESTNET_CHAIN_IDS.includes(String(chainId));
}
