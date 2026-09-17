# Facilitadores x402 y nuevas redes

Este documento explica cómo usa este proyecto los facilitadores x402, qué cobertura hay hoy, dónde comprobarla y qué hace falta para añadir una cadena.

Índice oficial de x402: [docs.x402.org](https://docs.x402.org). Catálogo de facilitadores de producción: [Facilitators](https://docs.x402.org/dev-tools/facilitators.md). Redes y tokens: [Networks & Token Support](https://docs.x402.org/core-concepts/network-and-token-support.md).

## Cómo lo usamos nosotros

El flujo de producción (`GET /x402mint/...`) llama al facilitador **solo para `/verify`**.

1. El cliente recibe `402 Payment Required` con requisitos (`exact`, red CAIP-2 `eip155:<chainId>`, USDC, `payTo` = forwarder).
2. Firma una autorización EIP-3009 (`transferWithAuthorization`).
3. El servidor verifica esa firma con el facilitador (`POST /verify`).
4. **No** llama a `/settle`. El servidor envía la transacción al forwarder (`mintWithAuthorization*`), que cobra el USDC y mintea en la misma TX.

Implicaciones:

- El facilitador no necesita pagar gas ni ejecutar la TX de mint. Nosotros sí (wallet de `PRIVATE_KEY`).
- Lo que importa es que el facilitador **verifique** el scheme `exact` EIP-3009 en esa red.
- Un facilitador que cobre solo por `/settle` puede ser gratis para nosotros (si `/verify` no está metered).
- Un facilitador de *batch/Gateway* (Circle nanopayments) **no sirve** para este flujo: el cliente firmaría contra otro contrato y el cobro no llegaría al forwarder.

## URLs que usa el código hoy

En `app/x402mint/[chainId]/[contractAddress]/[amount]/route.ts`:

| Entorno | Variable | Default |
| --- | --- | --- |
| Testnet (`isTestnet`) | `TESTNET_FACILITATOR_URL` | `https://x402.org/facilitator` |
| Mainnet | `FACILITATOR_URL` | `https://facilitator.payai.network` |

`proxy.ts` (demo `/premium`) usa `FACILITATOR_URL` o, si falta, `https://x402.org/facilitator`. Ese default **no sirve en mainnet**.

## Dónde comprobar si un facilitador soporta una red

La fuente de verdad es el endpoint vivo, no la web de marketing:

```bash
curl -sS https://facilitator.payai.network/supported
curl -sS https://x402.dexter.cash/supported
curl -sS https://x402.primer.systems/supported
curl -sS https://api.solvador.com/supported
```

Busca el identificador **v2 CAIP-2** (`eip155:8453`, `eip155:137`, …) y el scheme `exact`. En v1 a veces sale el nombre corto (`base`, `polygon`).

También:

- [PayAI — supported networks](https://docs.payai.network/x402/supported-networks)
- [x402 facilitators](https://docs.x402.org/dev-tools/facilitators.md)
- [CDP Facilitator (Coinbase)](https://docs.cdp.coinbase.com/x402/seller/facilitator) — requiere API keys CDP

## Facilitadores relevantes para este repo

### PayAI (producción actual en mainnet)

- URL: `https://facilitator.payai.network`
- Sin alta en el free tier. `/verify` y `/settle` públicos.
- Redes (comprobado en `/supported`): Base, Polygon, Arbitrum, Avalanche, Sei, SKALE Base, X Layer, Solana (+ testnets). **No** Arc (`5042`). **No** Robinhood (`4663`).
- Precios: [docs.payai.network/x402/facilitators/pricing](https://docs.payai.network/x402/facilitators/pricing). El free tier cubre créditos de settlement; nosotros no settleamos con ellos, pero el límite puede aplicar según su política de `/verify`.

### x402.org (solo testnet)

- URL: `https://x402.org/facilitator`
- Sin setup. Pensado para desarrollo. **No usar en mainnet.**
- Incluye Base Sepolia (`eip155:84532`) y otros testnets (Solana Devnet, etc.).

### Dexter (alternativa pública, sin cuenta)

- URL: `https://x402.dexter.cash`
- Sin cuenta ni comisión de facilitador.
- Cubre Base, Polygon y **Robinhood** (`eip155:4663`), entre otras. **No** Arc.
- En Robinhood el `exact` va por **Permit2**, no EIP-3009.

### Primer (público, sin cuenta)

- URL: `https://x402.primer.systems`
- Base, SKALE Base y Robinhood (mainnet + testnet). **No** Arc.

### Solvador (alta, `/verify` gratis)

- URL: `https://api.solvador.com`
- Hace falta API key (`X-API-Key`). [Docs](https://docs.solvador.com/).
- `POST /verify` es **gratis y sin cuota**. Cobran `/settle`. Encaja con nuestro modelo si se acepta el registro.
- Incluye Robinhood (USDG + Permit2). **No** Arc.

### Coinbase CDP

- Requiere `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`.
- Base, Polygon, Arbitrum, World, Solana. **No** Arc ni Robinhood.
- Hay código comentado en la ruta `/x402mint` por si se quiere activar.

### Circle Gateway / nanopayments

- `https://gateway-api.circle.com` (y testnet).
- Scheme distinto (`GatewayWalletBatched`). Liquidación en batch, no `transferWithAuthorization` al forwarder.
- **No compatible** con el mint atómico actual. Sí cubre Arc a nivel Gateway, pero no es un drop-in de PayAI.

### Verificar en local (self-facilitate)

x402 permite registrar `eip155:*` y verificar EIP-3009 contra RPC propio, sin facilitador hosted. Encaja si no hay facilitador para esa red y nosotros ya enviamos la TX. Hay que implementar/conectar un `FacilitatorClient` local; hoy el código solo usa `HTTPFacilitatorClient`.

## Qué necesita una red nueva (checklist)

Activar una cadena no es solo añadirla a `lib/networks.ts`. `validateChainConfig` en `/x402mint` exige configuración completa; si falta algo, responde `400`.

### 1. Protocolo de pago (el que usamos hoy)

- Token de cobro con **EIP-3009** `transferWithAuthorization` (USDC Circle en Base/Polygon/Arc).
- Scheme x402 `exact`.
- El cliente firma off-chain; el forwarder ejecuta on-chain.

Si el token **no** tiene EIP-3009 (USDG en Robinhood), hace falta otro path (Permit2). Eso aún no está implementado. Ver `PENDIENTES.MD`.

### 2. Facilitador

- Que anuncie `eip155:<chainId>` + `exact` en `GET /supported`.
- Preferible: sin alta, o al menos `/verify` gratis.
- Si no existe: self-verify local, no Circle Gateway (salvo que se cambie el modelo de cobro).

Opcional más adelante: mapa `chainId → FACILITATOR_URL`. Hoy hay una URL de mainnet y otra de testnet para **todas** las cadenas.

### 3. Contratos y datos en `lib/networks.ts`

| Dato | Dónde | Obligatorio para `/x402mint` |
| --- | --- | --- |
| Objeto `Chain` de viem | `SUPPORTED_CHAINS` | Sí (si no, `400 Unsupported chainId`) |
| Forwarder NFTs2Me | `FORWARDER_CONTRACT_ADDRESSES` | Sí |
| USDC (EIP-3009) | `USDC_ADDRESSES` | Sí (el mint actual asume USDC) |
| Pool Uniswap V3 WETH/USDC | `WETH_USDC_POOLS` | Sí (quote de nativo↔USDC y protocol fee) |
| Multicall3 | `MULTICALL3_ADDRESSES` | Sí (lecturas del contrato) |
| RPCs extra | `RPC_URLS` | Recomendado (fallback; el primario es el de viem) |
| Testnet | `TESTNET_CHAIN_IDS` | Si es testnet (elige el facilitador de testnet y el paywall) |
| CoinGecko nativo | `NATIVE_COINGECKO_ID_BY_CHAIN` en `lib/nativeFundsGuard.ts` | Para la alerta diaria de gas |

Cómo localizar el pool: comentarios en `lib/networks.ts` (factory Uniswap V3 `getPool(WETH, USDC, fee)`). En Arc el gas **es** USDC (nativo 18 decimales vs ERC-20 6); el quote WETH/USDC no aplica igual.

### 4. Operación

- Wallet de `PRIVATE_KEY` con **gas nativo** en esa cadena (ETH, POL, USDC nativo en Arc, …).
- Alertas Telegram y cron `/api/cron/native-balance` cubren las claves de `SUPPORTED_CHAINS`.
- Página de mint en NFTs2Me / fila en Supabase `MintingPages` (`deployAddress` + `network`) para logo y nombre del paywall.

### 5. Encender la red

1. Rellenar tablas de `lib/networks.ts`.
2. Confirmar facilitador (`GET /supported`).
3. Descomentar / añadir el `chainId` en `SUPPORTED_CHAINS`.
4. Probar `GET /x402mint/<chainId>/<collection>/<amount>` sin pago (`402`) y con pago de prueba.

## Estado por red (septiembre 2026)

| Chain ID | Red | En `SUPPORTED_CHAINS` | Facilitador PayAI | Token de pago x402 | Notas |
| --- | --- | --- | --- | --- | --- |
| 8453 | Base | Sí | Sí (`eip155:8453`) | USDC EIP-3009 | Producción |
| 137 | Polygon | Sí | Sí (`eip155:137`) | USDC EIP-3009 | Producción |
| 84532 | Base Sepolia | Sí | N/A (testnet → x402.org) | USDC testnet | Desarrollo |
| 5042 | Arc | No (preparada) | **No** | USDC nativo EIP-3009 (`0x3600…0000`) | Falta forwarder, pool/quote y facilitador `exact` hosted. Opción: verify local. Circle Gateway no encaja. |
| 4663 | Robinhood Chain | No (preparada) | **No** | **USDG**, sin EIP-3009 | Dexter/Primer/Solvador sí la listan, vía **Permit2**. Falta forwarder y path Permit2 en el mint. No hay USDC Circle. |

Direcciones ya anotadas (sin activar el mint):

- Arc USDC ERC-20: `0x3600000000000000000000000000000000000000`
- Robinhood USDG: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (`USDG_ADDRESSES`)
- Multicall3 canónico en ambas: `0xcA11bde05977b3631167028862bE2a173976CA11`
- RPCs: ver `RPC_URLS`

## Cambiar de facilitador

1. Confirmar la red en `GET <url>/supported`.
2. Mainnet: `FACILITATOR_URL`. Testnet: `TESTNET_FACILITATOR_URL`.
3. Si pide auth (Solvador, CDP), hay que pasar headers en `HTTPFacilitatorClient` (`createAuthHeaders`). PayAI y Dexter no lo necesitan en el free/public path.
4. No mezclar un facilitador de testnet en una ruta mainnet.

No hace falta un facilitador distinto por cadena mientras todas las mainnets activas estén en PayAI. El día que se active Arc o Robinhood, o bien se verifica en local (Arc), o se enruta esa chainId a Dexter/Solvador **y** se implementa Permit2 (Robinhood).
