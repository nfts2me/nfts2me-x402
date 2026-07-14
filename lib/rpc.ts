import { BaseError, ContractFunctionRevertedError, fallback, http } from "viem";
import { RPC_URLS } from "./networks";

/**
 * Crea un transporte viem con fallback: RPC por defecto de la cadena + URLs alternativas.
 * Si un RPC falla (p.ej. rate limit), viem prueba el siguiente automáticamente.
 */
export function getRpcTransport(chainId: number) {
    const extra = (RPC_URLS[chainId] ?? []).map((url) => http(url));
    return fallback([http(), ...extra], { rank: false, retryCount: 2 });
}

/**
 * Extrae un mensaje de error descriptivo de errores on-chain (reverts, RPC, etc.).
 */
export function extractOnchainErrorMessage(error: unknown): string {
    if (error instanceof BaseError) {
        const revertError = error.walk(
            (err) => err instanceof ContractFunctionRevertedError,
        );
        if (revertError instanceof ContractFunctionRevertedError) {
            const reason = revertError.reason ?? revertError.shortMessage;
            if (reason) return reason;
        }
        return error.shortMessage || error.message;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

/**
 * Mensaje orientado al usuario final para mostrar en el paywall.
 * El paywall de x402 solo lee status + statusText en respuestas no-OK, no el JSON body.
 */
export function toUserFacingMintError(message: string): string {
    if (
        /insufficient funds for transfer/i.test(message) ||
        /exceeds the balance of the account/i.test(message)
    ) {
        return "Minting failed: server wallet has insufficient native tokens to pay for gas.";
    }
    return message;
}

/**
 * Sanitiza un mensaje para usarlo como HTTP statusText (visible en el paywall).
 */
export function toHttpStatusText(message: string, maxLength = 120): string {
    const sanitized = message
        .replace(/[\r\n]+/g, " ")
        .replace(/[^\t\x20-\x7E]/g, "")
        .trim();

    if (!sanitized) return "Minting failed";
    if (sanitized.length <= maxLength) return sanitized;
    return `${sanitized.slice(0, maxLength - 3)}...`;
}
