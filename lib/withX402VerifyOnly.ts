import { NextRequest, NextResponse } from "next/server";
import { x402HTTPResourceServer, x402ResourceServer, RouteConfig, PaywallConfig, PaywallProvider } from "@x402/core/server";
import { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { NextAdapter } from "@x402/next";

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

// Cache for HTTP resource servers
const httpServerCache = new Map<x402ResourceServer, x402HTTPResourceServer>();

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
    paywallConfig?: PaywallConfig,
    paywall?: PaywallProvider,
    syncFacilitatorOnStart: boolean = true
): (request: NextRequest) => Promise<NextResponse<T>> {
    // Create or reuse HTTP resource server
    let httpServer = httpServerCache.get(server);
    if (!httpServer) {
        // Create minimal routes config for HTTP server
        const routesConfig = {
            "*": routeConfig, // Use wildcard since we handle routing ourselves
        };
        httpServer = new x402HTTPResourceServer(server, routesConfig);
        httpServerCache.set(server, httpServer);
    }

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
        const context = {
            adapter,
            path: url.pathname,
            method: request.method,
            paymentHeader: request.headers.get("PAYMENT-SIGNATURE") ?? request.headers.get("X-PAYMENT") ?? undefined,
        };

        // Process request - verify payment only
        const result = await httpServer!.processHTTPRequest(context, paywallConfig);

        if (result.type === "payment-error") {
            // Return 402 or error response
            const { status, headers, body, isHtml } = result.response;
            const responseHeaders = new Headers(headers);

            if (isHtml) {
                return new NextResponse(body as string, {
                    status,
                    headers: responseHeaders,
                }) as NextResponse<T>;
            }

            return NextResponse.json(body, {
                status,
                headers: responseHeaders,
            }) as NextResponse<T>;
        }

        if (result.type === "no-payment-required") {
            // This shouldn't happen if route is configured, but handle gracefully
            return NextResponse.json(
                { error: "Payment configuration error" },
                { status: 500 }
            ) as NextResponse<T>;
        }

        // Payment verified! Extract authorization data
        const { paymentPayload, paymentRequirements } = result;

        // Extract EIP-3009 authorization from payload
        const payload = paymentPayload.payload as {
            authorization?: EIP3009Authorization;
            signature?: string;
        };

        if (!payload.authorization || !payload.signature) {
            return NextResponse.json(
                { error: "Invalid payment payload: missing authorization data" },
                { status: 400 }
            ) as NextResponse<T>;
        }

        const paymentAuth: PaymentAuthorization = {
            authorization: payload.authorization,
            signature: payload.signature,
        };

        const verifyContext: VerifyOnlyContext = {
            paymentAuth,
            paymentPayload,
            paymentRequirements,
        };

        // Call the handler with verification context
        // NOTE: We do NOT call processSettlement() - that's the key difference!
        const handlerResponse = await routeHandler(request, verifyContext);

        return handlerResponse;
    };
}
