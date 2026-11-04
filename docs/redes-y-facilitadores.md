# Redes y facilitadores

Qué cadenas están activas, qué facilitador verifica cada una y qué hace falta para añadir una nueva.

Referencias de x402: [docs.x402.org](https://docs.x402.org), [facilitadores](https://docs.x402.org/dev-tools/facilitators.md), [redes y tokens](https://docs.x402.org/core-concepts/network-and-token-support.md).

## Estado por red

| Chain ID | Red | En `SUPPORTED_CHAINS` | Facilitador | Token x402 | Forwarder | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| 8453 | Base | Sí | PayAI | USDC `0x8335…2913` | `N2MMintmasterX402` | Producción. |
| 137 | Polygon | Sí | PayAI | USDC `0x3c49…3359` | `N2MMintmasterX402` | Producción. |
| 84532 | Base Sepolia | Sí | x402.org | USDC `0x036C…CF7e` | `N2MMintmasterX402` | Testnet. |
| 5042 | Arc | Sí | Interno | USDC ERC-20 `0x3600…0000` (6 dec., EIP-3009) | `N2MMintmasterX402Arc` | El gas nativo es USDC (18 dec.). Sin pool. |
| 4663 | Robinhood | No | — | USDG (sin EIP-3009) | — | Preparada en `lib/networks.ts`. Necesita Permit2. |

Las direcciones de los forwarders están en `FORWARDER_CONTRACT_ADDRESSES` (`lib/networks.ts`). La tabla de forwarders antiguos (vulnerables, 2200/2202) y nuevos (2204/2205) está en `nfts2me-contracts/docs/seguridad.md`. **No se deben usar los antiguos.**

`isTestnet` usa `TESTNET_CHAIN_IDS` (`84532`, `11155111`, `80002`). Las dos últimas no están activas.

## Cómo usamos el facilitador

Solo para **verificar** (`/verify`). El gateway nunca llama a `/settle`: la TX al forwarder la envía la wallet de `PRIVATE_KEY`, que paga el gas.

Esto implica que:

- Al facilitador solo se le pide que verifique el scheme `exact` con EIP-3009 en esa red.
- Un facilitador que solo cobra por `/settle` nos sale gratis.
- Uno de tipo *batch* (Circle Gateway / nanopayments) **no sirve**: el cliente firmaría contra otro contrato y el USDC no llegaría al forwarder.
- Un facilitador que ejecutara la autorización gastaría su nonce antes del mint y el mint fallaría.

## Qué facilitador usa cada red

En `app/x402mint/…/route.ts`:

```ts
usesSelfFacilitator(chainId)  → getVerifyOnlyFacilitatorClient()          // SELF_FACILITATOR_CHAINS (Arc)
isTestnet(chainId)            → TESTNET_FACILITATOR_URL || https://x402.org/facilitator
resto                         → FACILITATOR_URL         || https://facilitator.payai.network
```

`proxy.ts` (la demo de `/premium`) usa `FACILITATOR_URL || https://x402.org/facilitator`. Si se define `FACILITATOR_URL` para mainnet, la demo, que es de testnet, lo usará también.

### Facilitador interno (verify-only)

Está en `lib/facilitator/verifyOnlyFacilitator.ts`. Es un `x402Facilitator` de `@x402/core` con `ExactEvmScheme` registrado para cada cadena de `SELF_FACILITATOR_CHAINS`, que verifica contra nuestros propios RPC.

- Corre en el mismo proceso y **no tiene rutas HTTP** (a propósito: no es un servicio público).
- El signer es de solo lectura, con la dirección ficticia `0x…01`. `writeContract`, `sendTransaction` y `waitForTransactionReceipt` lanzan error. No usa `PRIVATE_KEY`.
- El settle está bloqueado con `onBeforeSettle → abort`.
- Rechaza los payloads que no son EIP-3009 (`unsupported_payload`), por ejemplo Permit2.

Para añadir una red: debe estar en `lib/networks.ts` con su RPC y Multicall3, y se añade a `SELF_FACILITATOR_CHAINS`.

## Facilitadores conocidos

Comprobar siempre en el endpoint vivo; las webs de marketing no siempre están al día:

```bash
curl -sS https://facilitator.payai.network/supported
curl -sS https://x402.dexter.cash/supported
curl -sS https://x402.primer.systems/supported
curl -sS https://api.solvador.com/supported
```

Busca `eip155:<chainId>` (CAIP-2, v2) con el scheme `exact`.

Revisado en septiembre de 2026:

| Facilitador | Alta | Redes relevantes | Notas |
| --- | --- | --- | --- |
| PayAI `facilitator.payai.network` | No | Base, Polygon (y Arbitrum, Avalanche, Sei, SKALE Base, X Layer, Solana) | El que usamos en mainnet. No cubre Arc ni Robinhood. [Precios](https://docs.payai.network/x402/facilitators/pricing). |
| x402.org `x402.org/facilitator` | No | Testnets (Base Sepolia…) | Solo para desarrollo. |
| Dexter `x402.dexter.cash` | No | Base, Polygon, Robinhood (Permit2) | No cubre Arc. |
| Primer `x402.primer.systems` | No | Base, SKALE Base, Robinhood | No cubre Arc. |
| Solvador `api.solvador.com` | Sí (`X-API-Key`) | Robinhood (USDG + Permit2), otras | `/verify` gratis y sin cuota. |
| Coinbase CDP | Sí (`CDP_API_KEY_ID/SECRET`) | Base, Polygon, Arbitrum, World, Solana | No cubre Arc ni Robinhood. Hay código comentado en la ruta. |
| Circle Gateway | Sí | Arc, entre otras | Scheme por lotes. **No compatible.** |

### Cambiar de facilitador

1. Confirma que la red aparece en `GET <url>/supported`.
2. Cambia `FACILITATOR_URL` (mainnet) o `TESTNET_FACILITATOR_URL` (testnet).
3. Si pide autenticación (Solvador, CDP), hay que pasar las cabeceras con `createAuthHeaders` en `HTTPFacilitatorClient`. Eso es un cambio de código.
4. No uses nunca un facilitador de testnet en mainnet.

## Añadir una red

`validateChainConfig` devuelve 400 si falta algo obligatorio.

### 1. Requisitos de protocolo

- El token de cobro tiene que implementar **EIP-3009** `transferWithAuthorization` (como el USDC de Circle).
- Si no lo implementa (USDG en Robinhood), hace falta un camino Permit2 que todavía no existe.

### 2. Datos en `lib/networks.ts`

| Dato | Dónde | ¿Obligatorio? |
| --- | --- | --- |
| `Chain` de viem | `SUPPORTED_CHAINS` | Sí |
| Forwarder | `FORWARDER_CONTRACT_ADDRESSES` | Sí |
| USDC | `USDC_ADDRESSES` | Sí |
| Pool Uniswap v3 WETH/USDC | `WETH_USDC_POOLS` | Sí, salvo si el nativo es USDC (`NATIVE_USDC_CHAIN_IDS`) |
| Multicall3 | `MULTICALL3_ADDRESSES` | Sí |
| RPC extra | `RPC_URLS` | Recomendado (el principal es el de viem) |
| Testnet | `TESTNET_CHAIN_IDS` | Si es testnet |
| Dominio EIP-712 del USDC | `USDC_EIP712` | Si x402 no conoce el USDC de esa red (como Arc) |
| Facilitador interno | `SELF_FACILITATOR_CHAINS` | Si ningún facilitador externo la cubre |
| Id de CoinGecko del nativo | `NATIVE_COINGECKO_ID_BY_CHAIN` en `lib/nativeFundsGuard.ts` | Para el cron de gas (no hace falta si el nativo es USDC) |
| Etiqueta Bazaar | `chainTag` en `route.ts` | Opcional (si no, `evm`) |

Para localizar el pool, consulta los comentarios de `WETH_USDC_POOLS`: se usa `getPool(WETH, USDC, fee)` de la factory Uniswap v3.

### 3. Contrato

- Despliega el forwarder con `nfts2me-contracts/scripts/manual-n2mmintmasterx402-deploy.ts`. En redes normales es `N2MMintmasterX402(owner, WETH9, relayer)`, y en Arc, `N2MMintmasterX402Arc(owner, relayer)`.
- El relayer es la dirección de la wallet de `PRIVATE_KEY` (constante `X402_RELAYER_ADDRESS` del script). Sin él, todos los mints revierten con `UnauthorizedRelayer()`.

### 4. Paywall y monorepo

- Si la red no viene en el `viem/chains` del bundle de `@x402/paywall`, el parche de cadenas extra la añade sola, porque usa `SUPPORTED_CHAINS`. Compruébalo cargando el 402 en el navegador.
- Añade la red a `X402_SUPPORTED_CHAINS` y `X402_USDC_ADDRESSES` en `monorepo-n2m/apps/nfts2.me/utils/x402.ts`, para que salga el botón.

### 5. Operación y prueba

- Carga gas nativo en la wallet de `PRIVATE_KEY`. El cron la vigila en todas las cadenas de `SUPPORTED_CHAINS`.
- Prueba `GET /x402mint/<chainId>/<colección>/1`: primero sin pago (402 y paywall visible) y luego con un pago real.

## Arc en detalle

- El gas nativo es USDC con 18 decimales. El ERC-20 `0x3600…0000` es el mismo saldo con 6 decimales y admite EIP-3009 (dominio `USDC`, versión `2`).
- No hay pool ni swap. El quote es 1:1 (`NATIVE_USDC_QUOTE_FOR_ONE = 1e6`) y la conversión de 18 a 6 decimales redondea hacia arriba (`nativeUsdcToErc20Amount`).
- Lo normal es una colección con precio en nativo, que va por `mintWithAuthorizationNativeUSDC`. Una colección en USDC sin protocol fee va por `mintWithAuthorization`. Una en USDC con protocol fee devuelve 400.
- El explorador es `arc.etherscan.io` (viem trae otro).
- Los RPC de reserva son Blockdaemon, dRPC y QuickNode.

## Robinhood (preparada, no activa)

- Hay USDG `0x5fc5…d1168` (`USDG_ADDRESSES`), RPC y Multicall3. La `Chain` viene de `viem/chains`.
- Faltan el camino Permit2, un forwarder compatible y un facilitador (Dexter, Primer o Solvador la cubren por Permit2).
