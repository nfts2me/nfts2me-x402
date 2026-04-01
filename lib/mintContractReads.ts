import { createPublicClient } from "viem";

export const USDC_ADDRESSES: Record<number, `0x${string}`> = {
    8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base
    84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
};

export const MULTICALL3_ADDRESSES: Record<number, readonly `0x${string}`[]> = {
    8453: ["0xcA11bde05977b3631167028862bE2a173976CA11"], // Base
    84532: ["0xcA11bde05977b3631167028862bE2a173976CA11"], // Base Sepolia
};

export const ABI_CHECKS = [
    { inputs: [], name: "protocolFee", outputs: [{ type: "uint256" }], type: "function", stateMutability: "view" },
    { inputs: [], name: "erc20PaymentAddress", outputs: [{ type: "address" }], type: "function", stateMutability: "view" },
    { inputs: [{ type: "uint256", name: "amount" }], name: "mintFee", outputs: [{ type: "uint256" }], type: "function", stateMutability: "view" },
    { inputs: [], name: "name", outputs: [{ type: "string" }], type: "function", stateMutability: "view" },
] as const;

export const ERC20_ALLOWANCE_ABI = [
    {
        name: "allowance",
        type: "function",
        stateMutability: "view",
        inputs: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
        ],
        outputs: [{ name: "", type: "uint256" }],
    },
] as const;

function getMulticallAddress(chainId: number): `0x${string}` {
    const [multicallAddress] = MULTICALL3_ADDRESSES[chainId] ?? [];
    if (!multicallAddress) {
        throw new Error(`Multicall3 address not found for chain ${chainId}`);
    }
    return multicallAddress;
}

export function getUsdcAddress(chainId: number): `0x${string}` {
    const usdcAddress = USDC_ADDRESSES[chainId];
    if (!usdcAddress) {
        throw new Error(`USDC address not found for chain ${chainId}`);
    }
    return usdcAddress;
}

export function validateMintPaymentConfiguration(chainId: number, protocolFee: bigint, erc20PaymentAddress: `0x${string}`) {
    const usdcAddress = getUsdcAddress(chainId);

    if (protocolFee !== 0n) {
        throw new Error("Protocol fee is not zero");
    }
    if (erc20PaymentAddress !== usdcAddress) {
        throw new Error("ERC20 payment address is not USDC");
    }

    return usdcAddress;
}

export async function readMintContractDataWithMulticall(
    publicClient: ReturnType<typeof createPublicClient>,
    chainId: number,
    contractAddress: `0x${string}`,
    amount: bigint,
) {
    const multicallAddress = getMulticallAddress(chainId);

    const [protocolFee, erc20PaymentAddress, mintFee] = await publicClient.multicall({
        multicallAddress,
        allowFailure: false,
        contracts: [
            {
                address: contractAddress,
                abi: ABI_CHECKS,
                functionName: "protocolFee",
            },
            {
                address: contractAddress,
                abi: ABI_CHECKS,
                functionName: "erc20PaymentAddress",
            },
            {
                address: contractAddress,
                abi: ABI_CHECKS,
                functionName: "mintFee",
                args: [amount],
            },
        ],
    });

    return { protocolFee, erc20PaymentAddress, mintFee };
}

export async function readMintContractDataWithOptimisticAllowance(
    publicClient: ReturnType<typeof createPublicClient>,
    chainId: number,
    contractAddress: `0x${string}`,
    amount: bigint,
    owner: `0x${string}`,
    spender: `0x${string}`,
) {
    const multicallAddress = getMulticallAddress(chainId);
    const optimisticTokenAddress = getUsdcAddress(chainId);

    const results = await publicClient.multicall({
        multicallAddress,
        allowFailure: true,
        contracts: [
            {
                address: contractAddress,
                abi: ABI_CHECKS,
                functionName: "protocolFee",
            },
            {
                address: contractAddress,
                abi: ABI_CHECKS,
                functionName: "erc20PaymentAddress",
            },
            {
                address: contractAddress,
                abi: ABI_CHECKS,
                functionName: "mintFee",
                args: [amount],
            },
            {
                address: optimisticTokenAddress,
                abi: ERC20_ALLOWANCE_ABI,
                functionName: "allowance",
                args: [owner, spender],
            },
        ],
    });

    const protocolFeeResult = results[0];
    const erc20PaymentAddressResult = results[1];
    const mintFeeResult = results[2];
    const allowanceResult = results[3];

    if (protocolFeeResult.status !== "success") {
        throw new Error("Failed to read protocolFee via multicall");
    }
    if (erc20PaymentAddressResult.status !== "success") {
        throw new Error("Failed to read erc20PaymentAddress via multicall");
    }
    if (mintFeeResult.status !== "success") {
        throw new Error("Failed to read mintFee via multicall");
    }

    const allowance = allowanceResult.status === "success" ? allowanceResult.result : undefined;

    return {
        protocolFee: protocolFeeResult.result,
        erc20PaymentAddress: erc20PaymentAddressResult.result,
        mintFee: mintFeeResult.result,
        optimisticAllowanceTokenAddress: optimisticTokenAddress,
        optimisticAllowance: allowance,
    };
}
