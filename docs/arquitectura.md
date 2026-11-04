# Arquitectura

Gateway Next.js que vende mints de colecciones NFTs2Me por [x402](https://www.x402.org). El cliente paga en USDC firmando una autorización EIP-3009. El gateway la verifica y envía él mismo una transacción a un contrato *forwarder*, que cobra el USDC y mintea en la misma transacción.

Se despliega en Vercel como `x402.nfts2me.com`.

## Piezas y repos

```
 Minting page (monorepo-n2m, apps/nfts2.me)
   botón "Mint with x402"  ──►  GET https://x402.nfts2me.com/x402mint/{chainId}/{colección}/{n}
                                         │
                                         ▼
                         ┌──────── este repo (nfts2me-x402) ────────┐
                         │ 1. lee precio del contrato (multicall)   │
                         │ 2. nombre/logo de Supabase MintingPages  │
                         │ 3. 402 + paywall  /  verify del pago     │──► facilitador (/verify)
                         │ 4. envía TX al forwarder con PRIVATE_KEY │      PayAI · x402.org · interno (Arc)
                         └──────────────────────────────────────────┘
                                         │ mintWithAuthorization*(…)
                                         ▼
                 Forwarder N2MMintmasterX402 / X402Arc (repo nfts2me-contracts)
                   transferWithAuthorization (USDC del pagador → forwarder)
                   [swap Uniswap v3 USDC→nativo si hace falta]
                   colección.mintTo(pagador, n)
                   sobrante → tesorería (PROTOCOL_FEE_RECIPIENT)
```

| Repo | Qué aporta |
| --- | --- |
| `nfts2me-x402` (este) | Endpoint `/x402mint`, paywall, verificación, envío de la TX, alertas. |
| `monorepo-n2m` | Enlace al gateway en las minting pages: `apps/nfts2.me/utils/x402.ts` (cadenas y USDC admitidos, `SHOW_X402_BUTTON`), `components/collection/X402MintShowcase.tsx` (botón y popup) y el `<link>` de descubrimiento en `app/[network]/[hostname]/…/page.tsx` (`NEXT_PUBLIC_X402_GATEWAY_URL`, por defecto `https://x402.nfts2me.com`). La tabla `MintingPages` de Supabase es la misma que usa el monorepo. |
| `nfts2me-contracts` | Forwarders `N2MMintmasterX402.sol` (2204) y `N2MMintmasterX402Arc.sol` (2205), script de despliegue `scripts/manual-n2mmintmasterx402-deploy.ts` y su `docs/seguridad.md` (tabla de forwarders antiguos y nuevos). Las direcciones desplegadas **no** se registran allí: viven en `lib/networks.ts` de este repo. |

Las listas de cadenas están duplicadas: `SUPPORTED_CHAINS` aquí y `X402_SUPPORTED_CHAINS` en el monorepo. Si cambias una, cambia la otra.

## Mapa del código

| Fichero | Rol |
| --- | --- |
| `app/x402mint/[chainId]/[contractAddress]/[amount]/route.ts` | **El producto.** Valida la ruta, lee el contrato, calcula el precio, monta el paywall y la metadata Bazaar, elige facilitador y, tras verificar, envía la TX al forwarder. Ver [flujo-de-pago.md](flujo-de-pago.md). |
| `lib/withX402VerifyOnly.ts` | Envoltorio propio sobre `x402HTTPResourceServer`: hace el 402 y el verify, **no** el settle, y pasa la autorización EIP-3009 al handler. Trata `HEAD` como `GET` sin mintear. |
| `lib/facilitator/verifyOnlyFacilitator.ts` | Facilitador interno (en el mismo proceso, sin HTTP) que solo verifica. Se usa en las cadenas de `SELF_FACILITATOR_CHAINS` (hoy Arc). |
| `lib/networks.ts` | Toda la configuración por cadena: `SUPPORTED_CHAINS`, USDC, forwarders, pools Uniswap, RPC extra, Multicall3, testnets, Arc (USDC nativo). |
| `lib/mintContractReads.ts` | Multicall a la colección (`protocolFee`, `erc20PaymentAddress`, `mintFee(n)` o `mintPrice()` v1) y quote USDC por 1 nativo (`forwarder.quoteUSDCForNative`). |
| `lib/rpc.ts` | Transporte viem con RPC de reserva, extracción de mensajes de error, cabecera `x-x402-error` y los parches que se inyectan en el HTML del paywall. |
| `lib/supabase.ts` | `name` e `ipfs_logo` de `MintingPages` con `'use cache'` (revalida cada 24 h). **Lanza al importar** si faltan sus variables de entorno. |
| `lib/nativeFundsGuard.ts` | Alertas de mint fallido y comprobación diaria del gas nativo de la wallet. |
| `lib/telegram.ts` | `sendTelegramMessage`. Nunca lanza. |
| `app/api/cron/native-balance/route.ts` | Cron diario del saldo de gas. Ver [operacion.md](operacion.md#cron-de-saldo-de-gas). |
| `proxy.ts` | Demo de `paymentProxy` sobre `/premium` (Base Sepolia, $0.01). Es el *proxy* (antes *middleware*) de Next 16 y se ejecuta en todas las peticiones, pero solo actúa sobre `/premium`. **No** protege el mint. |
| `app/premium/page.tsx` | Página de la demo anterior. |
| `app/page.tsx`, `app/layout.tsx` | Home mínima. |
| `app/api/mint/…/route.ts`, `app/mint/page.tsx` | **Código muerto.** El flujo antiguo (`withX402`: mint primero, settle después, no atómico) está comentado. Solo exportan stubs para que compile. No reactivar. |

## Stack

- Next.js 16 (App Router, `cacheComponents: true` en `next.config.ts`, así que `'use cache'` está activo). React 19. Tailwind 4 (solo en las páginas demo).
- `@x402/core`, `@x402/evm`, `@x402/next`, `@x402/paywall`, `@x402/extensions` en 2.26.0. Los parches del paywall dependen de esa versión exacta: ver [flujo-de-pago.md](flujo-de-pago.md#parches-del-paywall).
- viem 2.x para lecturas y escritura on-chain.
- `@supabase/supabase-js` con la clave de servicio.
- `@coinbase/x402` está instalado pero no se usa (el import está comentado).
- pnpm 12 (`packageManager`). `pnpm-workspace.yaml` solo fija `allowBuilds` y dos excepciones de `minimumReleaseAgeExclude` (viem 2.56.7, ox 0.14.45).
- Node: Next 16 exige ≥ 20.9. En Vercel se usa Node 24.x; en local se ha usado Node 22.

## Estado

- La única ruta que hace negocio es `GET /x402mint/...`.
- Cadenas activas: Polygon `137`, Base `8453`, Base Sepolia `84532`, Arc `5042`. Robinhood `4663` está preparada en `lib/networks.ts` pero no activa (necesita Permit2 y USDG). Ver [redes-y-facilitadores.md](redes-y-facilitadores.md).
- No hay tests. `tsc --noEmit` pasa. `pnpm run lint` falla al cargar `eslint-plugin-react` con ESLint 10 (ver [PENDIENTES.MD](../PENDIENTES.MD)).
