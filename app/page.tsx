import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <a href="https://nfts2me.com" target="_blank" rel="noopener noreferrer"><h1 className="text-4xl font-bold">NFTs2Me x402 Service</h1></a>
      </main>
    </div>
  );
}
