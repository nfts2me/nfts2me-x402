import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <h1 className="text-4xl font-bold">x402-nextjs Example</h1>
        <p className="max-w-md text-center sm:text-left">
          This is an example application demonstrating the x402-nextjs library.
          Click the button below to access premium content (requires mocking payment or paying small fee).
        </p>

        <div className="flex gap-4 items-center flex-col sm:flex-row">
          <Link
            href="/premium"
            className="rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-foreground text-background gap-2 hover:bg-[#383838] dark:hover:bg-[#ccc] text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5"
          >
            Access Premium Content ($0.01)
          </Link>
        </div>
      </main>
    </div>
  );
}
