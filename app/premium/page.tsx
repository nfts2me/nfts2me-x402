export default function PremiumPage() {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-8 font-[family-name:var(--font-geist-sans)]">
            <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start text-center">
                <h1 className="text-4xl font-bold text-green-500">Premium Content Unlocked! 🔓</h1>
                <p className="text-xl">
                    You have successfully paid for this content.
                </p>
                <div className="bg-gray-100 dark:bg-gray-800 p-6 rounded-lg">
                    <p className="font-mono">Secret Code: X402-ROCKS</p>
                </div>
                <a
                    href="/"
                    className="rounded-full border border-solid border-black/[.08] dark:border-white/[.145] transition-colors flex items-center justify-center hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] hover:border-transparent text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5"
                >
                    Back to Home
                </a>
            </main>
        </div>
    );
}
