# Pendientes

El camino de producción es `GET /x402mint/...`: verify-only + mint atómico en el forwarder. Detalle en el [README](README.md) y [docs/facilitators.md](docs/facilitators.md).

## Hecho (no reabrir)

- Paywall x402 + metadata Bazaar por colección.
- `protocolFee !== 0` en Base/Polygon (swap nativo vía pool WETH/USDC).
- Facilitador propio verify-only interno (in-process, sin HTTP). Usado en Arc.
- Arc `5042` en `SUPPORTED_CHAINS` (sin pool; quote 1:1). Path nativo: `mintWithAuthorizationNativeUSDC`. Falta pegar el forwarder desplegado.

`/api/mint` (settle después del mint) está comentado a propósito: no es atómico. No reactivar.

## Ahora (Arc)

1. Desplegar `N2MMintmasterX402Arc` en Arc (`./nfts2me-contracts/contracts/N2MMintmasterX402Arc.sol`).
2. Pegar la dirección en `FORWARDER_CONTRACT_ADDRESSES[5042]`.
3. Cargar la wallet de `PRIVATE_KEY` con USDC nativo (gas).
4. Probar `GET /x402mint/5042/<colección>/1` sin pago (`402`) y con pago (colección **nativa**, típica en Arc).

Hasta el paso 2 la ruta responde `400`. Soportado: nativo + protocol fee, o ERC-20 USDC con `protocolFee === 0`.

## Después

- **Arc extra:** ERC-20 USDC + protocol fee nativo (hoy `400`; el 99,9% de colecciones Arc son nativas).
- **Permit2** (tokens sin EIP-3009). Bloquea Robinhood (`4663`, USDG).
- **Robinhood:** Permit2 + forwarder + token USDG. No está en `SUPPORTED_CHAINS`.
- Tests de integración de `/x402mint`.
- UI `/mint` y `/premium`: demo/stub; no son el producto.

## Fuera de alcance (salvo que se reactive un path no atómico)

Reembolso si el cobro confirma y el mint revierte. En el flujo actual van en la misma TX: un revert no deja el USDC cobrado.
