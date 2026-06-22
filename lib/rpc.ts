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
