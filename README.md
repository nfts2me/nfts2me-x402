# NFTs2Me x402 Mint Gateway

Gateway Next.js para mintear colecciones de [NFTs2Me](https://nfts2me.com) cobrando con [x402](https://www.x402.org): el cliente paga en USDC (autorización EIP-3009) y el servidor mintea on-chain de forma atómica.

Documentación relacionada:

- [Facilitadores x402 y nuevas redes](docs/facilitators.md) — cobertura actual, cómo comprobarla y checklist para añadir una cadena.
- [PENDIENTES.MD](PENDIENTES.MD) — trabajo abierto (Permit2, reembolsos, etc.).

## Estado actual

El camino de producción es **`GET /x402mint/[chainId]/[contractAddress]/[amount]`**.

Qué hace hoy:

1. Precio dinámico desde el contrato (`mintFee` / `mintPrice` v1, `protocolFee`, token de pago).
2. Paywall x402 personalizado con nombre y logo de la colección (Supabase `MintingPages`).
3. Verificación del pago con un facilitador (`POST /verify` **sin** `/settle`).
4. Mint atómico en el **forwarder** (`mintWithAuthorization*`: cobra USDC con `transferWithAuthorization` y mintea en la misma TX).
5. Metadata [Bazaar](https://docs.x402.org/extensions/bazaar.md) por colección (no un único endpoint global).
6. Alertas Telegram si falla el mint o si el gas nativo de la wallet de settlement está bajo (cron diario).

Redes **activas** (`SUPPORTED_CHAINS`): Polygon `137`, Base `8453`, Base Sepolia `84532`, Arc `5042`.

Redes **preparadas pero no activas**: Robinhood Chain `4663` (USDG + Permit2, no implementado). Detalle en [docs/facilitators.md](docs/facilitators.md).

Esto **no** es todavía el gateway final de producción (reembolsos, Permit2, tests de integración, UI propia). El endpoint de mint sí se usa.

## Flujo de pago (producción)

```
Cliente GET /x402mint/<chain>/<collection>/<amount>
        │
        ├─ sin PAYMENT-SIGNATURE → 402 + paywall / requisitos x402
        │
        └─ con firma EIP-3009
              → facilitador POST /verify
              → forwarder.mintWithAuthorization*(…)  ← nosotros enviamos la TX
              → 200 { mintTxHash, etherscanTxUrl, … }
```

El `payTo` de x402 es la dirección del **forwarder**, no una EOA de cobro suelta. Así el USDC y el mint van juntos y, si el mint revierte, el cobro también.

Casos on-chain que implementa el handler:

| Token de la colección | Protocol fee | Función del forwarder |
| --- | --- | --- |
| USDC | 0 | `mintWithAuthorization` (también en Arc) |
| USDC | > 0 | `mintWithAuthorizationUSDCWithNativeProtocolFee` (pool WETH/USDC; **no** en Arc) |
| Nativo (`address(0)`) | 0 o > 0 | Base/Polygon: `mintWithAuthorizationNative` (swap vía pool). **Arc:** `mintWithAuthorizationNativeUSDC` (sin swap) |

En Arc el gas nativo **es** USDC (18 decimales) y el cobro x402 usa el ERC-20 USDC (`0x3600…0000`, 6 decimales, EIP-3009). El `payTo` sigue siendo el forwarder (`N2MMintmasterX402Arc`). Tras el pull EIP-3009 el forwarder ya tiene USDC nativo (mismo saldo) y llama `mintTo` con `msg.value` = mint + protocol fee (18 decimales). Quote 1:1, sin slippage de DEX (`nativeUsdcToErc20Amount`, techo 18→6). Colecciones ERC-20 USDC con `protocolFee > 0` en Arc → `400`.

Otros ERC-20 → `400`. Permit2 no está implementado.

Comisión extra opcional sobre el precio x402: `COMMISSION_ENABLED` (default on), `COMMISSION_AMOUNT` (default `10000` = 0.01 USDC a 6 decimales).

## Endpoints

### `GET /x402mint/[chainId]/[contractAddress]/[amount]`

Ruta viva. `amount` = entero 1–999999 (número de NFTs).

- Sin pago: `402` + paywall HTML / headers x402.
- Pago válido: verifica, mintea, `200` JSON (`success`, `mintParams`, `mintTxHash`, `etherscanTxUrl`). En development también devuelve `authorization`.
- `chainId` no soportado: `400` con `supportedChainIds`.

Ejemplos locales:

- http://localhost:3000/x402mint/84532/0xB2aeC85ba3A4ac509879AE4f7d9FFC5E297818D3/2
- `http://localhost:3000/x402mint/8453/<collection>/1`
- `http://localhost:3000/x402mint/5042/<collection>/1` (402 si hay forwarder configurado; si no, `400`)

### `GET /api/mint/[chainId]/[contractAddress]/[amount]`

**No está activo** (código comentado). Era el flujo `withX402` clásico: mint primero (`mintTo`) y `/settle` después. El cobro puede confirmar en el mismo bloque o en el siguiente; no es atómico. No usar.

### `GET /api/cron/native-balance`

Comprueba el saldo nativo de la wallet de settlement en cada red de `SUPPORTED_CHAINS` y avisa por Telegram si está por debajo de `NATIVE_BALANCE_DAILY_THRESHOLD_USD` (default `$1`). En Vercel corre a las 06:00 y 07:00 UTC; el handler solo actúa a las 08:00 Europe/Madrid (salvo `?force=1`). Auth: `Authorization: Bearer $CRON_SECRET` (en development no se exige).

### Páginas

| Ruta | Rol |
| --- | --- |
| `/` | Home mínima. |
| `/premium` | Demo del `paymentProxy` (paywall de página, Base Sepolia $0.01). No es el flujo de mint. |
| `/mint` | Stub vacío; la UI antigua está comentada y apuntaba a un `POST /api/mint` que no existe. |

## Arquitectura

| Pieza | Qué hace |
| --- | --- |
| `app/x402mint/.../route.ts` | Gateway: precio, paywall, verify, mint en el forwarder. |
| `lib/facilitator/verifyOnlyFacilitator.ts` | Facilitador verify-only **interno** (in-process, sin HTTP). Usado en Arc y en `SELF_FACILITATOR_CHAINS`. |
| `lib/withX402VerifyOnly.ts` | Wrapper propio: verifica x402 y **no** llama `/settle`; pasa la autorización EIP-3009 al handler. |
| `lib/networks.ts` | Cadenas, USDC/USDG, forwarder, pools, RPC, Multicall3, `SELF_FACILITATOR_CHAINS`. |
| `lib/mintContractReads.ts` | Multicall: `protocolFee`, `erc20PaymentAddress`, `mintFee`/`mintPrice`, quote USDC por 1 nativo. |
| `lib/rpc.ts` | Transporte con fallback de RPCs; errores on-chain → mensaje de usuario + header `x-x402-error` (el paywall no lee el body JSON). |
| `lib/supabase.ts` | `ipfs_logo` y `name` de `MintingPages` (cache ~24 h). Falla el boot si faltan las env de Supabase. |
| `lib/nativeFundsGuard.ts` + `lib/telegram.ts` | Alertas de mint fallido (dedup) y saldo nativo bajo. |
| `proxy.ts` | PoC `paymentProxy` para `/premium`. **No** protege el mint. Facilitador default de testnet si no hay `FACILITATOR_URL`. |

Stack: Next.js 16 App Router, `@x402/*` v2, viem, pnpm.

## Facilitadores (resumen)

Detalle, `/supported`, alternativas y checklist de redes nuevas: **[docs/facilitators.md](docs/facilitators.md)**.

| | Testnet | Mainnet (PayAI) | Arc / `SELF_FACILITATOR_CHAINS` |
| --- | --- | --- | --- |
| Env | `TESTNET_FACILITATOR_URL` | `FACILITATOR_URL` | in-process (`getVerifyOnlyFacilitatorClient`) |
| Default | `https://x402.org/facilitator` | `https://facilitator.payai.network` | interno; no hay URL |

PayAI cubre Base y Polygon. Arc usa el facilitador propio interno (PayAI no lista `eip155:5042`). El facilitador **solo verifica**; la TX la enviamos nosotros.

## Redes

| Chain ID | Red | Mint | Facilitador default | Token x402 |
| --- | --- | --- | --- | --- |
| 8453 | Base | Activo | PayAI | USDC `0x833589fC…` |
| 137 | Polygon | Activo | PayAI | USDC `0x3c499c54…` |
| 84532 | Base Sepolia | Activo | x402.org | USDC testnet `0x036CbD53…` |
| 5042 | Arc | Activo | Facilitador propio | USDC ERC-20 `0x3600…0000` (EIP-3009, 6 dec.) |
| 4663 | Robinhood | No | Dexter/Primer/Solvador vía Permit2 | USDG (no USDC, no EIP-3009) |

`isTestnet` mira `84532`, `11155111`, `80002`. Un `chainId` desconocido no hace fallback a otra red.

Forwarders activos: Polygon `0x52f17BEd…`, Base `0x5F5a6890…`, Base Sepolia `0xDD164E8A…`, Arc `0x5F982E55…` (`N2MMintmasterX402Arc`).

## Variables de entorno

No commitear secretos.

**Obligatorias para mint**

| Variable | Uso |
| --- | --- |
| `PRIVATE_KEY` | Wallet que paga gas y llama al forwarder. |
| `NEXT_PUBLIC_SUPABASE_URL` | Cliente Supabase. |
| `SUPABASE_SERVICE_KEY` | Lectura de `MintingPages`. |

**Facilitador**

| Variable | Uso |
| --- | --- |
| `FACILITATOR_URL` | Mainnet (no Arc). Default PayAI. |
| `TESTNET_FACILITATOR_URL` | Testnet. Default x402.org. |

**Paywall / branding**

| Variable | Uso |
| --- | --- |
| `APP_NAME` | Fallback si no hay nombre de colección. |
| `APP_LOGO` | Fallback de logo. |

**Comisión x402**

| Variable | Default |
| --- | --- |
| `COMMISSION_ENABLED` | `true` |
| `COMMISSION_AMOUNT` | `10000` (0.01 USDC) |
| `COMMISSION_DECIMALS` | `6` |

**Alertas y cron**

| Variable | Uso |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot. Si falta, se omite el aviso. |
| `TELEGRAM_CHAT_ID` | Chat/canal. |
| `TELEGRAM_THREAD_ID` | Hilo opcional. |
| `PAY_TO_EVM_ADDRESS` | Fallback de dirección de settlement si no hay `PRIVATE_KEY` (alertas de saldo). |
| `NATIVE_BALANCE_DAILY_THRESHOLD_USD` | Umbral de alerta de gas (default `1`). |
| `MINT_ERROR_ALERT_SUPPRESS_MS` | Dedup de errores iguales (default 15 min). |
| `CRON_SECRET` | Bearer del cron en producción. |

**Demo `/premium` (proxy)**

| Variable | Uso |
| --- | --- |
| `PAY_TO_EVM_ADDRESS` | `payTo` del paywall de página. |

CDP (comentado, no activo): `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`.

## Desarrollo local

Node.js 18+, pnpm 12.

```bash
pnpm install
pnpm run dev
pnpm run lint
```

Hace falta `.env.local` con al menos `PRIVATE_KEY` y las claves de Supabase, más USDC de testnet / gas en Base Sepolia para un mint real.

## Limitaciones y pendientes

1. **Permit2** (y tokens sin EIP-3009, p.ej. USDG en Robinhood): no implementado.
2. **Reembolso si el mint revierte después de un cobro**: en el flujo actual el cobro va en la misma TX que el mint, así que un revert no deja el USDC cobrado. Sigue siendo un riesgo si se reactivara `/api/mint` (`settle` después del mint) o un path no atómico.
3. **`/api/mint`** comentado; no alineado con el gateway.
4. **UI** `/mint` y `/premium` son demo o stub; el producto es el endpoint + paywall x402.
5. **Arc:** activo con `N2MMintmasterX402Arc`. Caso principal: nativo (`address(0)`), con o sin protocol fee → `mintWithAuthorizationNativeUSDC`. ERC-20 USDC + `protocolFee === 0` sigue con `mintWithAuthorization`. ERC-20 USDC + protocol fee nativo no está soportado. Gas de la wallet = USDC nativo. El bundle de `@x402/paywall` no incluye Arc mainnet (`5042`, sí testnet `5042002`); el HTML 402 inyecta `SUPPORTED_CHAINS` para que el paywall no reviente en blanco.
6. **Robinhood** no está en `SUPPORTED_CHAINS` (Permit2 + USDG).
7. Sin tests de integración automatizados de `/x402mint`.
8. `proxy.ts` no debe tomarse como configuración de producción del mint.

## Convenciones

- Texto visible fuera (API, paywall, logs de usuario, Telegram): **inglés**.
- Comentarios y docs internas (este README, `docs/`): **español**.
- Cada cambio de flujo, endpoint, env o comportamiento debe actualizar este README (y [docs/facilitators.md](docs/facilitators.md) si toca redes o facilitadores) en el mismo PR.
