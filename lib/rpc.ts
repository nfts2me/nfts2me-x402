import { BaseError, ContractFunctionRevertedError, fallback, http } from "viem";
import { RPC_URLS, SUPPORTED_CHAINS } from "./networks";

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
            if (revertError.reason) return revertError.reason;
            // Custom errors (p. ej. UnauthorizedRelayer()): viem no rellena `reason`,
            // solo `data.errorName`. Sin esto se perdería el nombre del error.
            const errorName = revertError.data?.errorName;
            if (errorName) {
                const errorArgs = (revertError.data?.args ?? []).map(String).join(", ");
                return `${errorName}(${errorArgs})`;
            }
            if (revertError.shortMessage) return revertError.shortMessage;
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

/** El forwarder (2204/2205) rechaza la llamada porque la wallet de PRIVATE_KEY no es relayer. */
export function isUnauthorizedRelayerErrorMessage(message: string): boolean {
    return /UnauthorizedRelayer/i.test(message);
}

/**
 * Mensaje orientado al usuario final para mostrar en el paywall.
 * El paywall de x402 solo lee status + statusText en respuestas no-OK, no el JSON body.
 */
export function toUserFacingMintError(message: string): string {
    if (isUnauthorizedRelayerErrorMessage(message)) {
        return withSupportHint(
            "Minting failed: the gateway wallet is not an authorized relayer on the forwarder contract (the forwarder owner must call setRelayer).",
        );
    }
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

const PAYWALL_CRASH_OVERLAY = `<script data-x402-crash-overlay="1">
(() => {
  let shown = false;
  function show(message) {
    if (shown) return;
    shown = true;
    const safe = String(message || "Unexpected error").replace(/[<>&]/g, (c) =>
      c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"
    );
    const el = document.createElement("div");
    el.id = "n2m-paywall-crash";
    el.setAttribute("role", "alert");
    el.style.cssText = "font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:1.5rem;color:#111;background:#fff;line-height:1.45";
    el.innerHTML = "<h1 style=\\"font-size:1.25rem;margin:0 0 .75rem\\">Could not load the payment page</h1>"
      + "<p style=\\"margin:0 0 .75rem\\">" + safe + "</p>"
      + "<p style=\\"margin:0;color:#555\\">If this keeps happening, contact x402support@nfts2me.com with this URL.</p>";
    (document.body || document.documentElement).prepend(el);
  }
  window.addEventListener("error", (e) => {
    const msg = String(e.message || (e.error && e.error.message) || "");
    if (/Unsupported chain ID/i.test(msg)) show(msg);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    const msg = String(reason && reason.message ? reason.message : reason || "");
    if (/Unsupported chain ID/i.test(msg)) show(msg);
  });
})();
</script>`;

function paywallExtraChainsScript(): string {
    const chains = Object.values(SUPPORTED_CHAINS).map((chain) => ({
        id: chain.id,
        name: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: chain.rpcUrls,
        blockExplorers: chain.blockExplorers,
        contracts: chain.contracts,
        testnet: chain.testnet,
    }));
    const json = JSON.stringify(chains).replace(/</g, "\\u003c");
    return `<script data-x402-extra-chains="1">window.__x402ExtraChains=${json};</script>`;
}

function paywallHeadScripts(): string {
    return `${paywallExtraChainsScript()}${PAYWALL_ERROR_FETCH_PATCH}${PAYWALL_CRASH_OVERLAY}`;
}

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

    // @x402/paywall 2.26.0 embebe viem/chains con Arc Testnet (5042002) pero no
    // Arc mainnet (5042). El lookup `Object.values(ay).find(id)` lanza y deja
    // #root vacío. Concatenamos SUPPORTED_CHAINS inyectadas en window.
    // El identificador minificado `ay` es frágil; el overlay cubre si cambia.
    patched = patched.replaceAll(
        "Object.values(ay).find(",
        "Object.values(ay).concat(window.__x402ExtraChains||[]).find(",
    );

    if (patched.includes("data-x402-error-fetch-patch")) return patched;
    const scripts = paywallHeadScripts();
    const headClose = /<\/head>/i;
    if (headClose.test(patched)) {
        return patched.replace(headClose, `${scripts}$&`);
    }
    return `${scripts}${patched}`;
}
