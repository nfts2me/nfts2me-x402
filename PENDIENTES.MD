# Pendientes

El camino de producción es `GET /x402mint/...`: verify-only + mint atómico en el forwarder. Detalle en el [README](README.md) y [docs/facilitators.md](docs/facilitators.md).

## Hecho (no reabrir)

- Paywall x402 + metadata Bazaar por colección.
- `protocolFee !== 0` en Base/Polygon (swap nativo vía pool WETH/USDC).
- Facilitador propio verify-only interno (in-process, sin HTTP). Usado en Arc.
- Arc `5042` en `SUPPORTED_CHAINS` (sin pool; quote 1:1). Path nativo: `mintWithAuthorizationNativeUSDC`. Forwarder `0x5F982E55…` pegado. Paywall: el bundle de `@x402/paywall` no trae Arc mainnet; se inyectan `SUPPORTED_CHAINS` en el HTML 402.

`/api/mint` (settle después del mint) está comentado a propósito: no es atómico. No reactivar.

## Ahora (Arc)

Forwarder desplegado y en `FORWARDER_CONTRACT_ADDRESSES[5042]`. Queda:

1. Cargar la wallet de `PRIVATE_KEY` con USDC nativo (gas) si aún no está.
2. Probar `GET /x402mint/5042/<colección>/1` con pago real (colección **nativa**, típica en Arc) y desplegar el parche del paywall a producción.

## Después

- **Arc extra:** ERC-20 USDC + protocol fee nativo (hoy `400`; el 99,9% de colecciones Arc son nativas).
- **Permit2** (tokens sin EIP-3009). Bloquea Robinhood (`4663`, USDG).
- **Robinhood:** Permit2 + forwarder + token USDG. No está en `SUPPORTED_CHAINS`.
- Tests de integración de `/x402mint`.
- UI `/mint` y `/premium`: demo/stub; no son el producto.

## Fuera de alcance (salvo que se reactive un path no atómico)

Reembolso si el cobro confirma y el mint revierte. En el flujo actual van en la misma TX: un revert no deja el USDC cobrado.
