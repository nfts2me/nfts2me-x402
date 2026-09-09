import { createPublicClient, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getRpcTransport } from "./rpc";
import { getCollectionMintingPageUrl, describePaymentToken, SUPPORTED_CHAINS, USDC_ADDRESSES } from "./networks";
import { sendTelegramMessage } from "./telegram";

const PAY_TO_EVM_ADDRESS = process.env.PAY_TO_EVM_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const DAILY_THRESHOLD_USD = Number(
    process.env.NATIVE_BALANCE_DAILY_THRESHOLD_USD ?? "1",
);
const ALERT_SUPPRESS_MS = Number(
    process.env.MINT_ERROR_ALERT_SUPPRESS_MS ?? String(15 * 60 * 1000),
); // 15 min for identical errors

type AlertSuppressEntry = {
    lastAlertAtMs: number;
};

function getAlertState() {
    const anyGlobal = globalThis as any;
    if (!anyGlobal.__nfts2meMintErrorAlerts) {
        anyGlobal.__nfts2meMintErrorAlerts = {} as Record<string, AlertSuppressEntry>;
    }
    return anyGlobal.__nfts2meMintErrorAlerts as Record<string, AlertSuppressEntry>;
}

function settlementAddress(): `0x${string}` {
    // Quien paga el gas es la wallet de PRIVATE_KEY (sender de writeContract).
    if (PRIVATE_KEY) {
        return privateKeyToAccount(PRIVATE_KEY as `0x${string}`).address;
    }
    if (PAY_TO_EVM_ADDRESS) return PAY_TO_EVM_ADDRESS as `0x${string}`;
    throw new Error("Missing PRIVATE_KEY and PAY_TO_EVM_ADDRESS env vars.");
}

export function isInsufficientFundsErrorMessage(message: string): boolean {
    const m = message.toLowerCase();
    // Base/op-geth: "out of gas: gas required exceeds: 218546" al hacer eth_estimateGas
    // cuando el sender no tiene ETH nativo suficiente para el gas.
    return (
        /insufficient funds/.test(m) ||
        /exceeds the balance of the account/.test(m) ||
        /gas required exceeds/.test(m) ||
        /out of gas/.test(m) ||
        /intrinsic gas too low/.test(m)
    );
}

function jsonSafe(value: unknown): string {
    try {
        return JSON.stringify(
            value,
            (_key, v) => (typeof v === "bigint" ? v.toString() : v),
            2,
        );
    } catch {
        return String(value);
    }
}

function fingerprint(parts: string[]): string {
    return parts.join("|").slice(0, 280);
}

function compactErrorKey(message: string): string {
    if (isInsufficientFundsErrorMessage(message)) return "low_funds";
    return message
        .replace(/0x[a-fA-F0-9]+/g, "0x")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
}

function isAlertSuppressed(key: string): boolean {
    const entry = getAlertState()[key];
    return Boolean(entry && Date.now() - entry.lastAlertAtMs < ALERT_SUPPRESS_MS);
}

function markAlertSent(key: string) {
    getAlertState()[key] = { lastAlertAtMs: Date.now() };
}

export type MintFailureAlert = {
    chainId: number;
    context: string;
    errorMessage: string;
    userFacingMessage?: string;
    httpStatus?: number;
    url?: string;
    contractAddress?: string;
    amount?: string;
    functionName?: string;
    forwarderAddress?: string;
    erc20PaymentAddress?: string;
    args?: unknown;
    paymentAuth?: unknown;
};

/**
 * Avisa por Telegram de cualquier fallo de mint/settlement.
 * Deduplca el mismo error en la misma cadena durante ALERT_SUPPRESS_MS.
 */
export async function alertMintFailure(alert: MintFailureAlert) {
    const {
        chainId,
        context,
        errorMessage,
        userFacingMessage,
        httpStatus,
        url,
        contractAddress,
        amount,
        functionName,
        forwarderAddress,
        erc20PaymentAddress,
        args,
        paymentAuth,
    } = alert;

    const lowFunds = isInsufficientFundsErrorMessage(errorMessage);
    const key = fingerprint([
        String(chainId),
        context,
        compactErrorKey(errorMessage),
        functionName ?? "",
        contractAddress ?? "",
    ]);
    if (isAlertSuppressed(key)) return;

    const chain = SUPPORTED_CHAINS[String(chainId)];
    const chainLabel = chain ? `${chain.name} (${chainId})` : `chain ${chainId}`;
    let settlement = "unknown";
    try {
        settlement = settlementAddress();
    } catch {
        // ignore
    }

    const paymentToken = describePaymentToken(chainId, erc20PaymentAddress);
    const mintingPage = contractAddress
        ? getCollectionMintingPageUrl(contractAddress, chainId)
        : undefined;
    const usdcAddress = USDC_ADDRESSES[chainId];

    const title = lowFunds
        ? `⚠️ Mint failed: low native gas on ${chainLabel}`
        : `🚨 Mint failed on ${chainLabel}`;

    const lines = [
        title,
        `When: ${new Date().toISOString()}`,
        `Context: ${context}`,
        httpStatus != null ? `HTTP: ${httpStatus}` : undefined,
        url ? `URL: ${url}` : undefined,
        mintingPage ? `Minting page: ${mintingPage}` : undefined,
        `Settlement (gas payer): ${settlement}`,
        forwarderAddress ? `Forwarder: ${forwarderAddress}` : undefined,
        contractAddress ? `Collection: ${contractAddress}` : undefined,
        amount ? `Amount: ${amount}` : undefined,
        paymentToken ? `Payment token: ${paymentToken.label}` : undefined,
        paymentToken ? `Token address: ${paymentToken.tokenAddress}` : undefined,
        paymentToken ? `contractPaymentAddress: ${paymentToken.contractPaymentAddress}` : undefined,
        usdcAddress ? `USDC (chain): ${usdcAddress}` : undefined,
        functionName ? `Function: ${functionName}` : undefined,
        userFacingMessage ? `User-facing: ${userFacingMessage}` : undefined,
        "",
        "Error:",
        errorMessage.slice(0, 1500),
    ].filter((line) => line !== undefined);

    if (paymentAuth !== undefined) {
        lines.push("", "Payment authorization:", jsonSafe(paymentAuth).slice(0, 900));
    }
    if (args !== undefined) {
        lines.push("", "Call args (for eth_call / estimateGas):", jsonSafe(args).slice(0, 900));
    }

    const message = lines.join("\n").slice(0, 4000);
    const sent = await sendTelegramMessage(message);
    if (sent) markAlertSent(key);
}

const NATIVE_COINGECKO_ID_BY_CHAIN: Record<number, string> = {
    // Base mainnet / base sepolia usan ETH como asset nativo.
    8453: "ethereum",
    84532: "ethereum",
    // Polygon: id típico en CoinGecko.
    137: "matic-network",
};

const priceCache = new Map<string, { cachedAtMs: number; usd: number }>();

async function getNativeUsdPrice(chainId: number): Promise<number | null> {
    const coingeckoId = NATIVE_COINGECKO_ID_BY_CHAIN[chainId];
    if (!coingeckoId) return null;

    const now = Date.now();
    const cached = priceCache.get(coingeckoId);
    if (cached && now - cached.cachedAtMs < 60 * 60 * 1000) {
        return cached.usd;
    }

    try {
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
            coingeckoId,
        )}&vs_currencies=usd`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = (await res.json()) as Record<string, { usd?: number }>;
        const usd = Number(data?.[coingeckoId]?.usd);
        if (!Number.isFinite(usd) || usd <= 0) return null;

        priceCache.set(coingeckoId, { cachedAtMs: now, usd });
        return usd;
    } catch {
        return null;
    }
}

export async function getSettlementNativeBalanceWei(chainId: number): Promise<bigint> {
    const chain = SUPPORTED_CHAINS[String(chainId)];
    if (!chain) throw new Error(`Unsupported chainId: ${chainId}`);

    const publicClient = createPublicClient({
        chain,
        transport: getRpcTransport(chainId),
    });

    const address = settlementAddress();
    const balance = await publicClient.getBalance({ address });
    return balance;
}

export async function getSettlementNativeBalanceUsd(params: { chainId: number }) {
    const { chainId } = params;
    const balanceWei = await getSettlementNativeBalanceWei(chainId);

    const nativeUsdPer1 = await getNativeUsdPrice(chainId);
    if (!nativeUsdPer1) {
        return {
            balanceWei,
            balanceNative: null as number | null,
            balanceUsd: null as number | null,
            nativeUsdPer1,
        };
    }

    const balanceNative = Number(formatUnits(balanceWei, 18));
    const balanceUsd = balanceNative * nativeUsdPer1;

    return {
        balanceWei,
        balanceNative,
        balanceUsd,
        nativeUsdPer1,
    };
}

export async function maybeSendDailyNativeBalanceAlert(params: {
    chainId: number;
    thresholdUsd?: number;
}) {
    const thresholdUsd = params.thresholdUsd ?? DAILY_THRESHOLD_USD;
    const settlement = settlementAddress();
    const chain = SUPPORTED_CHAINS[String(params.chainId)];
    const chainLabel = chain ? `${chain.name} (${params.chainId})` : `chain ${params.chainId}`;
    const symbol = chain?.nativeCurrency?.symbol ?? "native";
    const data = await getSettlementNativeBalanceUsd({ chainId: params.chainId });
    if (data.balanceUsd === null || data.balanceUsd === undefined) {
        return { alerted: false, reason: "missing_price" as const, data, chainLabel, symbol, settlement };
    }

    if (data.balanceUsd >= thresholdUsd) {
        return { alerted: false, reason: "above_threshold" as const, data, chainLabel, symbol, settlement };
    }

    return { alerted: true, reason: "below_threshold" as const, data, chainLabel, symbol, settlement };
}

export async function checkSupportedChainsNativeBalances(thresholdUsd = DAILY_THRESHOLD_USD) {
    const settlement = settlementAddress();
    const results: Array<{
        chainId: number;
        chainLabel: string;
        symbol: string;
        alerted: boolean;
        reason: "missing_price" | "above_threshold" | "below_threshold" | "runtime_error";
        balanceUsd: number | null;
        balanceNative: number | null;
    }> = [];

    for (const chainIdStr of Object.keys(SUPPORTED_CHAINS)) {
        const chainId = Number(chainIdStr);
        try {
            const res = await maybeSendDailyNativeBalanceAlert({ chainId, thresholdUsd });
            results.push({
                chainId,
                chainLabel: res.chainLabel,
                symbol: res.symbol,
                alerted: res.alerted,
                reason: res.reason,
                balanceUsd: res.data.balanceUsd,
                balanceNative: res.data.balanceNative,
            });
        } catch (err) {
            console.error(`[native-balance] failed for chain ${chainId}:`, err);
            const chain = SUPPORTED_CHAINS[chainIdStr];
            results.push({
                chainId,
                chainLabel: chain ? `${chain.name} (${chainId})` : `chain ${chainId}`,
                symbol: chain?.nativeCurrency?.symbol ?? "native",
                alerted: false,
                reason: "runtime_error",
                balanceUsd: null,
                balanceNative: null,
            });
        }
    }

    const low = results.filter((r) => r.reason === "below_threshold");
    const errors = results.filter((r) => r.reason === "runtime_error" || r.reason === "missing_price");

    if (low.length > 0 || errors.length > 0) {
        const lines = [
            `📉 Native balance check (threshold $${thresholdUsd.toFixed(2)})`,
            `Settlement: ${settlement}`,
            "",
            ...results.map((r) => {
                if (r.reason === "below_threshold" && r.balanceUsd != null && r.balanceNative != null) {
                    return `• ${r.chainLabel}: ${r.balanceNative.toFixed(6)} ${r.symbol} (~$${r.balanceUsd.toFixed(2)}) ⚠️`;
                }
                if (r.reason === "above_threshold" && r.balanceUsd != null && r.balanceNative != null) {
                    return `• ${r.chainLabel}: ${r.balanceNative.toFixed(6)} ${r.symbol} (~$${r.balanceUsd.toFixed(2)})`;
                }
                if (r.reason === "missing_price") {
                    return `• ${r.chainLabel}: could not fetch USD price`;
                }
                return `• ${r.chainLabel}: check failed`;
            }),
        ];
        await sendTelegramMessage(lines.join("\n"));
    }

    return { results, alerted: low.length > 0 };
}

