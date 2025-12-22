"use client";

import { useState } from "react";

export default function MintPage() {
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [message, setMessage] = useState("");
    const [txHash, setTxHash] = useState("");

    const handleMint = async () => {
        try {
            setStatus("loading");
            setMessage("Initiating mint request... Payment may be required.");

            const response = await fetch("/api/mint", {
                method: "POST",
            });

            if (response.status === 402) {
                // This should be intercepted by x402-next client if installed/configured,
                // or the browser should handle the Paywall if returning HTML.
                // However, usually for APIs, x402-next middleware returns a 402 JSON.
                setMessage("Payment required. Please complete the payment.");
                return;
            }

            if (!response.ok) {
                throw new Error(`Request failed: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            setStatus("success");
            setMessage(data.message || "Minting successful!");
            if (data.txHash) setTxHash(data.txHash);

        } catch (error: any) {
            console.error("Mint error:", error);
            setStatus("error");
            setMessage(error.message || "Minting failed");
        }
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-8 font-[family-name:var(--font-geist-sans)]">
            <main className="flex flex-col gap-8 row-start-2 items-center text-center max-w-lg">
                <h1 className="text-4xl font-bold">Mint Your NFT 🎨</h1>
                <p className="text-xl text-gray-600 dark:text-gray-400">
                    Exclusive mint on Base Sepolia.
                </p>

                <div className="bg-gray-100 dark:bg-gray-800 p-6 rounded-lg w-full">
                    <p className="mb-4">Price: 0.001 USDC</p>

                    {status === "idle" && (
                        <button
                            onClick={handleMint}
                            className="rounded-full bg-blue-600 text-white font-bold transition-transform hover:scale-105 active:scale-95 text-base h-12 px-8 flex items-center justify-center mx-auto"
                        >
                            Pay & Mint
                        </button>
                    )}

                    {status === "loading" && (
                        <div className="animate-pulse">Processing...</div>
                    )}

                    {status === "success" && (
                        <div className="text-green-500">
                            <p className="font-bold mb-2">🎉 {message}</p>
                            {txHash && (
                                <p className="text-xs break-all text-gray-500">Tx: {txHash}</p>
                            )}
                            <button
                                onClick={() => setStatus("idle")}
                                className="mt-4 text-blue-500 underline text-sm"
                            >
                                Mint Another
                            </button>
                        </div>
                    )}

                    {status === "error" && (
                        <div className="text-red-500">
                            <p>{message}</p>
                            <button
                                onClick={() => setStatus("idle")}
                                className="mt-4 text-sm underline"
                            >
                                Try Again
                            </button>
                        </div>
                    )}
                </div>

                <a href="/" className="text-sm underline opacity-60 hover:opacity-100">
                    Back to Home
                </a>
            </main>
        </div>
    );
}
