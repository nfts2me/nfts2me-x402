import { NextRequest, NextResponse } from "next/server";
import { x402HTTPResourceServer, x402ResourceServer, RouteConfig, PaywallConfig, PaywallProvider } from "@x402/core/server";
import { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { NextAdapter } from "@x402/next";
import { alertMintFailure } from "./nativeFundsGuard";
import { extractOnchainErrorMessage, injectPaywallErrorFetchPatch, mintErrorResponseInit, toUserFacingMintError } from "./rpc";

/**
 * EIP-3009 authorization structure for transferWithAuthorization
 */
export interface EIP3009Authorization {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
}

/**
 * Payment authorization data extracted from verified x402 payment
 */
export interface PaymentAuthorization {
    authorization: EIP3009Authorization;
    signature: string;
}

/**
 * Context passed to the route handler with verified payment data
 */
export interface VerifyOnlyContext {
    paymentAuth: PaymentAuthorization;
    paymentPayload: PaymentPayload;
    paymentRequirements: PaymentRequirements;
}

/**
 * Route handler type that receives verification context
 */
export type VerifyOnlyHandler<T = unknown> = (
    request: NextRequest,
    context: VerifyOnlyContext
) => Promise<NextResponse<T>>;

export type VerifyOnlyAlertExtras = {
    contractAddress?: string;
    amount?: string;
    erc20PaymentAddress?: string;
};

function parseX402mintPath(pathname: string): {
    chainId: number;
    contractAddress?: string;
    amount?: string;
} {
    const parts = pathname.split("/").filter(Boolean);
    const chainId = Number(parts[1]);
    return {
        chainId: Number.isFinite(chainId) ? chainId : 0,
        contractAddress: parts[2],
        amount: parts[3],
    };
}

/**
 * Wraps a Next.js App Router API route handler with x402 payment verification ONLY.
 * 
 * Unlike `withX402`, this wrapper:
 * - Verifies payment but does NOT call the facilitator's /settle endpoint
 * - Passes the EIP-3009 authorization data to the handler
 * - Allows the handler to execute transferWithAuthorization on-chain atomically
 * 
 * @param routeHandler - Handler function that receives verified payment authorization
 * @param routeConfig - Payment configuration for this route
 * @param server - Pre-configured x402ResourceServer instance
 * @param paywallConfig - Optional paywall UI configuration
 * @param paywall - Optional custom paywall provider
 * @param syncFacilitatorOnStart - Whether to sync with facilitator on startup (defaults to true)
 * @returns A wrapped Next.js route handler
 * 
 * @example
 * ```typescript
 * const handler = async (req: NextRequest, ctx: VerifyOnlyContext) => {
 *   console.log("Authorization:", ctx.paymentAuth);
 *   // Use ctx.paymentAuth to call transferWithAuthorization on-chain
 *   return NextResponse.json({ success: true, auth: ctx.paymentAuth });
 * };
 * 
 * export const GET = withX402VerifyOnly(handler, routeConfig, server);
 * ```
 */
export function withX402VerifyOnly<T = unknown>(
    routeHandler: VerifyOnlyHandler<T>,
    routeConfig: RouteConfig,
    server: x402ResourceServer,
    routePattern: string = "*",
    paywallConfig?: PaywallConfig,
    paywall?: PaywallProvider,
    syncFacilitatorOnStart: boolean = true,
    alertExtras?: VerifyOnlyAlertExtras,
): (request: NextRequest) => Promise<NextResponse<T>> {
    // Create an HTTP resource server for this route config.
    // Do not reuse a cached instance when routeConfig can change between requests,
    // otherwise route payment requirements (price, extensions, etc.) become stale.
    const routesConfig = {
        [routePattern]: routeConfig,
    };
    const httpServer = new x402HTTPResourceServer(server, routesConfig);

    // Track initialization
    let initialized = false;
    let initPromise: Promise<void> | null = null;

    const ensureInitialized = async (): Promise<void> => {
        if (initialized) return;
        if (initPromise) return initPromise;

        if (syncFacilitatorOnStart) {
            initPromise = httpServer!.initialize().then(() => {
                initialized = true;
            });
            return initPromise;
        }
        initialized = true;
    };

    // Register paywall provider if provided
    if (paywall) {
        httpServer.registerPaywallProvider(paywall);
    }

    return async (request: NextRequest): Promise<NextResponse<T>> => {
        await ensureInitialized();

        // Create NextAdapter for the request
        const adapter = new NextAdapter(request);

        // Create HTTP context using proper structure
        const url = new URL(request.url);
        // Chrome (COOP) y algunos crawlers mandan HEAD. El patrón x402 es
        // `GET /x402mint/...`; sin reescribir el método, processHTTPRequest
        // no empareja y devolvía 500 no-payment-required.
        const isHead = request.method === "HEAD";
        const context = {
            adapter,
            path: url.pathname,
            method: isHead ? "GET" : request.method,
            paymentHeader: request.headers.get("PAYMENT-SIGNATURE") ?? request.headers.get("X-PAYMENT") ?? undefined,
        };

        const pathInfo = parseX402mintPath(url.pathname);
        const chainId = pathInfo.chainId;
        const contractAddress = alertExtras?.contractAddress ?? pathInfo.contractAddress;
        const amount = alertExtras?.amount ?? pathInfo.amount;
        const erc20PaymentAddress = alertExtras?.erc20PaymentAddress;
        const skipAlert = isHead;

        const headersOnly = (response: NextResponse<T>): NextResponse<T> => {
            if (!isHead) return response;
            return new NextResponse(null, {
                status: response.status,
                headers: response.headers,
            }) as NextResponse<T>;
        };

        const alertBase = {
            chainId,
            url: url.pathname,
            contractAddress,
            amount,
            erc20PaymentAddress,
        };

        let verifyContext: VerifyOnlyContext;
        try {
            // Process request - verify payment only
            const result = await httpServer!.processHTTPRequest(context, paywallConfig);

            if (result.type === "payment-error") {
                const { status, headers, body, isHtml } = result.response;
                if (status >= 500 && !skipAlert) {
                    await alertMintFailure({
                        ...alertBase,
                        context: "x402mint payment-error",
                        errorMessage: typeof body === "string" ? body : JSON.stringify(body),
                        httpStatus: status,
                    });
                }
                const responseHeaders = new Headers(headers);

                if (isHtml) {
                    return headersOnly(new NextResponse(injectPaywallErrorFetchPatch(body as string), {
                        status,
                        headers: responseHeaders,
                    }) as NextResponse<T>);
                }

                return headersOnly(NextResponse.json(body, {
                    status,
                    headers: responseHeaders,
                }) as NextResponse<T>);
            }

            if (result.type === "no-payment-required") {
                if (!skipAlert) {
                    await alertMintFailure({
                        ...alertBase,
                        context: "x402mint no-payment-required",
                        errorMessage: "Payment configuration error",
                        httpStatus: 500,
                    });
                }
                return headersOnly(NextResponse.json(
                    { error: "Payment configuration error" },
                    { status: 500 }
                ) as NextResponse<T>);
            }

            // Payment verified! Extract authorization data
            const { paymentPayload, paymentRequirements } = result;

            // Extract EIP-3009 authorization from payload
            const payload = paymentPayload.payload as {
                authorization?: EIP3009Authorization;
                signature?: string;
            };

            if (!payload.authorization || !payload.signature) {
                return headersOnly(NextResponse.json(
                    { error: "Invalid payment payload: missing authorization data" },
                    { status: 400 }
                ) as NextResponse<T>);
            }

            verifyContext = {
                paymentAuth: {
                    authorization: payload.authorization,
                    signature: payload.signature,
                },
                paymentPayload,
                paymentRequirements,
            };
        } catch (error) {
            const rawMessage = extractOnchainErrorMessage(error);
            const details = toUserFacingMintError(rawMessage);
            if (!skipAlert) {
                await alertMintFailure({
                    ...alertBase,
                    context: "x402mint verify wrapper",
                    errorMessage: rawMessage,
                    userFacingMessage: details,
                    httpStatus: 500,
                });
            }
            return headersOnly(NextResponse.json(
                { error: details, details },
                mintErrorResponseInit(details),
            ) as NextResponse<T>);
        }

        // HEAD no debe mintear aunque lleve PAYMENT-SIGNATURE.
        if (isHead) {
            return new NextResponse(null, { status: 200 }) as NextResponse<T>;
        }

        // Call the handler with verification context
        // NOTE: We do NOT call processSettlement() - that's the key difference!
        return await routeHandler(request, verifyContext);
    };
}
