import { createPublicClient } from "viem";
import { x402Facilitator } from "@x402/core/facilitator";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { SELF_FACILITATOR_CHAINS } from "../networks";
import { getRpcTransport } from "../rpc";

const SETTLE_UNSUPPORTED_REASON =
    "This facilitator only verifies payments. The resource server submits the on-chain transaction.";

/** Dirección dummy: verify solo lee RPC; no debe tocar PRIVATE_KEY. */
const VERIFY_ONLY_SIGNER_ADDRESS = "0x0000000000000000000000000000000000000001" as const;

function verifyOnlySigner(chainId: number) {
    const chain = SELF_FACILITATOR_CHAINS[String(chainId)];
    if (!chain) {
        throw new Error(`No self-facilitator RPC configured for chain ${chainId}`);
    }

    const publicClient = createPublicClient({
        chain,
        transport: getRpcTransport(chainId),
    });

    const cannotSettle = async (): Promise<`0x${string}`> => {
        throw new Error(SETTLE_UNSUPPORTED_REASON);
    };

    return toFacilitatorEvmSigner({
        address: VERIFY_ONLY_SIGNER_ADDRESS,
        getCode: (args) => publicClient.getCode(args),
        readContract: (args) => publicClient.readContract(args as never),
        verifyTypedData: (args) => publicClient.verifyTypedData(args as never),
        writeContract: cannotSettle,
        sendTransaction: cannotSettle,
        waitForTransactionReceipt: async () => {
            throw new Error(SETTLE_UNSUPPORTED_REASON);
        },
    });
}

function isExactEip3009Payload(payload: PaymentPayload): boolean {
    const inner = payload.payload as { authorization?: { to?: unknown }; signature?: unknown } | undefined;
    return Boolean(inner?.authorization && typeof inner.signature === "string");
}

let cachedFacilitator: x402Facilitator | undefined;

/**
 * Facilitador interno: verifica EIP-3009 contra RPC propio y no envía TXs.
 * No hay superficie HTTP. Añadir una red = incluirla en SELF_FACILITATOR_CHAINS.
 */
function getVerifyOnlyFacilitator(): x402Facilitator {
    if (cachedFacilitator) return cachedFacilitator;

    const facilitator = new x402Facilitator();
    facilitator.onBeforeSettle(async () => ({
        abort: true,
        reason: SETTLE_UNSUPPORTED_REASON,
    }));

    for (const chain of Object.values(SELF_FACILITATOR_CHAINS)) {
        const signer = verifyOnlySigner(chain.id);
        facilitator.register(`eip155:${chain.id}`, new ExactEvmScheme(signer));
    }

    cachedFacilitator = facilitator;
    return facilitator;
}

export function getVerifyOnlyFacilitatorClient(): FacilitatorClient {
    const facilitator = getVerifyOnlyFacilitator();
    return {
        verify: async (payload: PaymentPayload, requirements: PaymentRequirements) => {
            if (!isExactEip3009Payload(payload)) {
                return {
                    isValid: false,
                    invalidReason: "unsupported_payload",
                    payer: "",
                };
            }
            return facilitator.verify(payload, requirements);
        },
        settle: (payload, requirements) => facilitator.settle(payload, requirements),
        getSupported: async () => facilitator.getSupported() as Awaited<ReturnType<FacilitatorClient["getSupported"]>>,
    };
}
