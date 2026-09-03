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

function collectErrorParts(error: unknown): string[] {
    const parts: string[] = [];
    const seen = new Set<object>();
    let current: unknown = error;

    while (current && typeof current === "object" && !seen.has(current)) {
        seen.add(current);

        if (current instanceof BaseError) {
            if (current.shortMessage) parts.push(current.shortMessage);
            if (current.details) parts.push(current.details);
            if (current.message) parts.push(current.message);
            current = current.cause;
            continue;
        }

        if (current instanceof Error) {
            if (current.message) parts.push(current.message);
            current = (current as Error & { cause?: unknown }).cause;
            continue;
        }

        break;
    }

    return [...new Set(parts.filter(Boolean))];
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
    }

    const parts = collectErrorParts(error);
    if (parts.length > 0) return parts.join(" | ");
    return String(error);
}

const SUPPORT_HINT =
    "If this persists, email x402support@nfts2me.com with details.";

function withSupportHint(message: string): string {
    if (message.includes("x402support@nfts2me.com")) return message;
    const trimmed = message.trim();
    if (!trimmed) return `Minting failed. ${SUPPORT_HINT}`;
    const separator = trimmed.endsWith(".") ? " " : ". ";
    return `${trimmed}${separator}${SUPPORT_HINT}`;
}

/**
 * Mensaje orientado al usuario final para mostrar en el paywall.
 * El paywall de x402 solo lee status + statusText en respuestas no-OK, no el JSON body.
 */
export function toUserFacingMintError(message: string): string {
    if (
        /insufficient funds/i.test(message) ||
        /insufficient native tokens/i.test(message) ||
        /exceeds the balance of the account/i.test(message) ||
        /gas required exceeds/i.test(message) ||
        /out of gas/i.test(message)
    ) {
        return withSupportHint(
            "Minting failed: server wallet has insufficient native tokens to pay for gas.",
        );
    }
    return withSupportHint(message);
}

/**
 * Sanitiza un mensaje para usarlo como HTTP statusText (visible en el paywall).
 * Conserva el mail de soporte aunque haya que recortar el resto.
 */
export function toHttpStatusText(message: string, maxLength = 220): string {
    const sanitized = message
        .replace(/[\r\n]+/g, " ")
        .replace(/[^\t\x20-\x7E]/g, "")
        .trim();

    if (!sanitized) return withSupportHint("Minting failed");
    if (sanitized.length <= maxLength) return sanitized;

    const hintIndex = sanitized.lastIndexOf("If this persists, email ");
    if (hintIndex === -1) {
        return `${sanitized.slice(0, maxLength - 3)}...`;
    }

    const hint = sanitized.slice(hintIndex).trim();
    const prefixBudget = maxLength - hint.length - 4;
    if (prefixBudget < 20) {
        return hint.slice(0, maxLength);
    }
    return `${sanitized.slice(0, prefixBudget).trim()}... ${hint}`;
}

/** HTTP/2 no transmite statusText; el paywall lo lee de esta cabecera vía un parche en el HTML 402. */
export const X402_ERROR_HEADER = "x-x402-error";

export function mintErrorResponseInit(message: string, status = 500) {
    const statusText = toHttpStatusText(message);
    return {
        status,
        statusText,
        headers: {
            [X402_ERROR_HEADER]: statusText,
        },
    };
}

const PAYWALL_ERROR_FETCH_PATCH = `<script data-x402-error-fetch-patch="1">
(() => {
  const origFetch = window.fetch.bind(window);
  window.fetch = async function (...args) {
    const res = await origFetch(...args);
    if (res.ok) return res;
    let statusText = res.headers.get("x-x402-error") || res.statusText;
    if (!statusText || statusText === "Internal Server Error") {
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        try {
          const data = await res.clone().json();
          statusText = data.details || data.error || data.message || statusText;
        } catch {}
      }
    }
    if (!statusText) return res;
    return new Response(res.body, {
      status: res.status,
      statusText: String(statusText).replace(/[\\r\\n]+/g, " ").slice(0, 250),
      headers: res.headers,
    });
  };
})();
</script>`;

export function injectPaywallErrorFetchPatch(html: string): string {
    let patched = html;

    // El paywall de x402 trata un balanceOf fallido como 0n y bloquea el pago
    // ("Insufficient balance") aunque el usuario sí tenga USDC. Si no se ha
    // podido leer el saldo, devolvemos null y el Pay now sigue adelante.
    // replaceAll: el bundle actual tiene una coincidencia, pero un minificado
    // futuro (u otro template EVM/SVM) podría repetir el helper de balance.
    patched = patched.replaceAll(
        'catch(n){return console.error("Failed to fetch token balance:",n),0n}',
        'catch(n){return console.error("Failed to fetch token balance:",n),null}',
    );
    patched = patched.replaceAll(
        "let[Z,z]=await Promise.all([iJ(P,r,ie),$ze(P,ie)]);M(y1(Z,z))",
        "let[Z,z]=await Promise.all([iJ(P,r,ie),$ze(P,ie)]);Z!=null&&M(y1(Z,z))",
    );

    if (patched.includes("data-x402-error-fetch-patch")) return patched;
    const headClose = /<\/head>/i;
    if (headClose.test(patched)) {
        return patched.replace(headClose, `${PAYWALL_ERROR_FETCH_PATCH}$&`);
    }
    return `${PAYWALL_ERROR_FETCH_PATCH}${patched}`;
}
