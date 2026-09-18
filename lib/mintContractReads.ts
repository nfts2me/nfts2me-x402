import { createPublicClient } from "viem";
import {
    USDC_ADDRESSES,
    WETH_USDC_POOLS,
    MULTICALL3_ADDRESSES,
    FORWARDER_CONTRACT_ADDRESSES,
    isNativeUsdcChain,
    NATIVE_USDC_QUOTE_FOR_ONE,
} from "./networks";

export const ABI_CHECKS = [
    { inputs: [], name: "protocolFee", outputs: [{ type: "uint256" }], type: "function", stateMutability: "view" },
    { inputs: [], name: "erc20PaymentAddress", outputs: [{ type: "address" }], type: "function", stateMutability: "view" },
    { inputs: [{ type: "uint256", name: "amount" }], name: "mintFee", outputs: [{ type: "uint256" }], type: "function", stateMutability: "view" },
    // v1 contracts expose mintPrice() (per unit) instead of mintFee(amount)
    { inputs: [], name: "mintPrice", outputs: [{ type: "uint256" }], type: "function", stateMutability: "view" },
    { inputs: [], name: "name", outputs: [{ type: "string" }], type: "function", stateMutability: "view" },
] as const;

type MulticallResult<T> =
    | { status: "success"; result: T }
    | { status: "failure"; error: Error };

/** Prefer v2 mintFee(amount); fall back to v1 mintPrice() * amount. */
function resolveMintFee(
    mintFeeResult: MulticallResult<bigint>,
    mintPriceResult: MulticallResult<bigint>,
    amount: bigint,
): bigint {
    if (mintFeeResult.status === "success") {
        return mintFeeResult.result;
    }
    if (mintPriceResult.status === "success") {
        return mintPriceResult.result * amount;
    }
    throw new Error("Failed to read mintFee/mintPrice via multicall");
}

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

export function getWETHUSDCPoolAddress(chainId: number): `0x${string}` {
    const poolAddress = WETH_USDC_POOLS[chainId];
    if (!poolAddress) {
        throw new Error(`WETH/USDC pool address not found for chain ${chainId}`);
    }
    return poolAddress;
}

export function getQuoteUsdcForOneNative(chainId: number): bigint | undefined {
    if (isNativeUsdcChain(chainId)) return NATIVE_USDC_QUOTE_FOR_ONE;
    return undefined;
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
    console.log("Llamada a readMintContractDataWithMulticall con valores: ", { chainId, contractAddress, amount: amount.toString() });
    const multicallAddress = getMulticallAddress(chainId);
    const nativeUsdcQuote = getQuoteUsdcForOneNative(chainId);
    const poolAddress = nativeUsdcQuote === undefined ? getWETHUSDCPoolAddress(chainId) : undefined;
    const forwarderAddress = FORWARDER_CONTRACT_ADDRESSES[chainId];
    if (!forwarderAddress && nativeUsdcQuote === undefined) {
        throw new Error(`Forwarder contract address not configured for chainId: ${chainId}`);
    }

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

    const collectionResults = await publicClient.multicall({
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
                address: contractAddress,
                abi: ABI_CHECKS,
                functionName: "mintPrice",
            },
        ],
    });

    const [
        protocolFeeResult,
        erc20PaymentAddressResult,
        mintFeeResult,
        mintPriceResult,
    ] = collectionResults;

    // v1 contracts may not have protocolFee; treat a revert as 0
    const protocolFee = protocolFeeResult.status === "success" ? protocolFeeResult.result : 0n;
    const mintFee = resolveMintFee(mintFeeResult, mintPriceResult, amount);

    if (erc20PaymentAddressResult.status !== "success") {
        throw new Error("Failed to read erc20PaymentAddress via multicall");
    }

    let quoteForOneEth: bigint;
    if (nativeUsdcQuote !== undefined) {
        quoteForOneEth = nativeUsdcQuote;
    } else if (forwarderAddress && poolAddress) {
        quoteForOneEth = await publicClient.readContract({
            address: forwarderAddress,
            abi: quoteAbi,
            functionName: "quoteUSDCForNative",
            args: [poolAddress, 10n ** 18n],
        });
    } else {
        throw new Error("Failed to read quoteUSDCForNative via multicall");
    }

    return {
        protocolFee,
        erc20PaymentAddress: erc20PaymentAddressResult.result,
        mintFee,
        quoteForOneEth,
    };
}

// El allowance es optimistic en el sentido de que suponemos que siempre va a ser USDC. Si no, abajo se soluciona.
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
                address: contractAddress,
                abi: ABI_CHECKS,
                functionName: "mintPrice",
            },
            {
                address: optimisticTokenAddress,
                abi: ERC20_ALLOWANCE_ABI,
                functionName: "allowance",
                args: [owner, spender],
            },
        ],
    });

    const [
        protocolFeeResult,
        erc20PaymentAddressResult,
        mintFeeResult,
        mintPriceResult,
        allowanceResult,
    ] = results;

    // v1 contracts may not have protocolFee; treat a revert as 0
    const protocolFee = protocolFeeResult.status === "success" ? protocolFeeResult.result : 0n;
    const mintFee = resolveMintFee(mintFeeResult, mintPriceResult, amount);

    if (erc20PaymentAddressResult.status !== "success") {
        throw new Error("Failed to read erc20PaymentAddress via multicall");
    }

    const allowance = allowanceResult.status === "success" ? allowanceResult.result : undefined;

    return {
        protocolFee,
        erc20PaymentAddress: erc20PaymentAddressResult.result,
        mintFee,
        optimisticAllowanceTokenAddress: optimisticTokenAddress,
        optimisticAllowance: allowance,
    };
}
