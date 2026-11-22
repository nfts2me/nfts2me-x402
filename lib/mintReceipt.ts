import { isAddressEqual, pad, toEventSelector, zeroAddress } from "viem";

/** keccak256 de la firma del evento: el mismo topic en ERC-20 y ERC-721. Se calcula, no se escribe a mano. */
const TRANSFER_EVENT_TOPIC = toEventSelector("Transfer(address,address,uint256)");
const ZERO_ADDRESS_TOPIC = pad(zeroAddress, { size: 32 });

type ReceiptLog = {
    address: string;
    topics: readonly string[];
};

/**
 * Cuenta los NFTs que la colección ha minteado a `recipient` en una TX, mirando solo los logs del recibo
 * (no hace ninguna llamada al RPC).
 *
 * Un mint ERC-721 es `Transfer(address(0), recipient, tokenId)` con los tres argumentos indexados
 * (4 topics). En ERC-20 el importe no va indexado (3 topics), así que no se confunden.
 *
 * Es una comprobación orientativa: un contrato que no emita el `Transfer` estándar (ERC-1155, ERC-2309
 * `ConsecutiveTransfer`) daría 0 aunque haya minteado. Sirve para avisar, no para decidir la respuesta.
 */
export function countErc721MintsTo(
    logs: readonly ReceiptLog[],
    collection: string,
    recipient: string,
): number {
    const recipientTopic = pad(recipient as `0x${string}`, { size: 32 }).toLowerCase();
    let minted = 0;
    for (const log of logs) {
        if (log.topics.length !== 4) continue;
        if (log.topics[0]?.toLowerCase() !== TRANSFER_EVENT_TOPIC) continue;
        if (log.topics[1]?.toLowerCase() !== ZERO_ADDRESS_TOPIC) continue;
        if (log.topics[2]?.toLowerCase() !== recipientTopic) continue;
        if (!isAddressEqual(log.address as `0x${string}`, collection as `0x${string}`)) continue;
        minted++;
    }
    return minted;
}
