import { paymentProxy } from "@x402/next";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { createPaywall } from "@x402/paywall";
import { evmPaywall } from "@x402/paywall/evm";

const facilitatorClient = new HTTPFacilitatorClient({
    url: "https://x402.org/facilitator"
});

export const server = new x402ResourceServer(facilitatorClient)
    .register("eip155:84532", new ExactEvmScheme());

export const evmAddress = process.env.WALLET_ADDRESS as `0x${string}`;
// Build paywall
export const paywall = createPaywall()
    .withNetwork(evmPaywall)
    .withConfig({
        appName: process.env.APP_NAME || "Next x402 Demo",
        appLogo: process.env.APP_LOGO || "/x402-icon-blue.png",
        testnet: true,
    })
    .build();

export const proxy = paymentProxy(
    {
        "/premium": {
            accepts: [
                {
                    scheme: "exact",
                    price: "$0.01",
                    network: "eip155:84532",
                    payTo: evmAddress,
                },
            ],
            description: "Premium content access",
        },
    },
    server,
    undefined, // paywallConfig (using custom paywall instead)
    paywall, // custom paywall provider
);

/*

export const proxy = paymentProxy(
    process.env.WALLET_ADDRESS as `0x${string}`,
    {
        "/premium": {
            price: "$0.01",
            network: "base-sepolia",
            config: {
                description: "Premium content access"
            }
        },
        "/api/mint": {
            price: "$0.001", // Small fee for minting service
            network: "base-sepolia",
            config: {
                description: "Mint NFT on Base Sepolia"
            }
        }
    }
);


*/