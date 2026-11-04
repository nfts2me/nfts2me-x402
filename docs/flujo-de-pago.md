# Flujo de pago y mint

Todo ocurre en `app/x402mint/[chainId]/[contractAddress]/[amount]/route.ts` y `lib/withX402VerifyOnly.ts`.

## La ruta

`GET /x402mint/{chainId}/{contractAddress}/{amount}` (también responde a `HEAD`).

- `chainId`: clave de `SUPPORTED_CHAINS` (`137`, `8453`, `84532`, `5042`). No hay red por defecto.
- `contractAddress`: cualquier dirección válida (`isAddress`). **No hay lista de colecciones permitidas**: vale cualquier contrato que responda como una colección NFTs2Me.
- `amount`: número de NFTs, `^[1-9][0-9]{0,5}$` (1–999999) tras `decodeURIComponent` y `trim`.

## Secuencia

```
1. Validación          chainId ∈ SUPPORTED_CHAINS, config completa (validateChainConfig),
                       dirección válida, amount válido                       → si no, 400
2. Datos del contrato  getCachedMintContractData ('use cache', revalida 60 s, expira 120 s):
                       multicall protocolFee · erc20PaymentAddress · mintFee(n) · mintPrice()
                       + quoteUSDCForNative(pool, 1e18) en el forwarder (no en Arc)
3. Reglas de Arc       token ≠ USDC y ≠ nativo → 400; USDC con protocolFee > 0 → 400
4. Supabase            name e ipfs_logo de MintingPages (deployAddress + network), caché 24 h
5. Facilitador         Arc → interno · testnet → TESTNET_FACILITATOR_URL | x402.org
                       · mainnet → FACILITATOR_URL | PayAI
6. withX402VerifyOnly  sin cabecera de pago → 402 (HTML del paywall o JSON)
                       con PAYMENT-SIGNATURE (o X-PAYMENT) → facilitador.verify
7. Handler             comprueba authorization.to == forwarder, elige función, writeContract
                       con PRIVATE_KEY, espera el recibo                     → 200 o 500
```

En cada petición se crean un `x402ResourceServer`, un paywall y un `x402HTTPResourceServer` nuevos, porque el precio y la metadata dependen de la colección. Esto implica una llamada a `GET /supported` del facilitador por petición (`initialize()`).

Nunca se llama a `/settle`. Tampoco se devuelve la cabecera `PAYMENT-RESPONSE` del estándar: la confirmación es el JSON de la respuesta.

## Precio

Notación:

- `n` = `amount`.
- `M` = `mintFee(n)` de la colección. Si la colección no lo tiene (contratos v1), `mintPrice() × n`. Está en unidades del token de la colección: USDC (6 decimales) o nativo (wei).
- `P` = `protocolFee() × n`, siempre en nativo (wei). Si `protocolFee()` revierte (v1), se toma 0.
- `Q` = USDC (6 decimales) por 1 nativo según el *spot* del pool Uniswap v3 (`slot0`), leído con `forwarder.quoteUSDCForNative(pool, 1e18)`. En Arc, `Q = 1e6` fijo.
- `+1 %` = margen de slippage (`SLIPPAGE_MULTIPLIER = 101`, redondeo hacia arriba).
- `C` = comisión: `COMMISSION_AMOUNT` (por defecto `10000` = 0,01 USDC) si `COMMISSION_ENABLED` no es falso.

| Token de la colección | Cadena | `P` | Precio x402 (USDC) | Función del forwarder |
| --- | --- | --- | --- | --- |
| USDC | cualquiera | 0 | `M + C` | `mintWithAuthorization` |
| USDC | Base, Polygon | > 0 | `M + (P·Q/1e18)·1,01 + C` | `mintWithAuthorizationUSDCWithNativeProtocolFee` |
| USDC | Arc | > 0 | — (400) | — |
| Nativo (`address(0)`) | Base, Polygon | cualquiera | `((M+P)·Q/1e18)·1,01 + C` | `mintWithAuthorizationNative` |
| Nativo | Arc | cualquiera | `⌈(M+P)/1e12⌉ + C` | `mintWithAuthorizationNativeUSDC` |
| Otro ERC-20 | cualquiera | — | — (500 con mensaje `Unsupported payment token`) | — |

En Base y Polygon el precio se devuelve como cadena decimal (`formatUnits(precio, COMMISSION_DECIMALS)`) y x402 lo interpreta como dólares en el USDC de la red. En Arc se devuelve `{ amount, asset, extra: { name: "USDC", version: "2" } }` (`USDC_EIP712`), porque x402 no conoce el USDC de Arc.

`COMMISSION_DECIMALS` se usa para dar formato a todo el precio, no solo a la comisión. Tiene que valer 6, los decimales de USDC.

`payTo` es siempre la dirección del forwarder.

## Qué hace el forwarder y adónde va el dinero

Contratos: `nfts2me-contracts/contracts/N2MMintmasterX402.sol` (2204) y `N2MMintmasterX402Arc.sol` (2205). Solo aceptan llamadas de relayers autorizados (`isRelayer`). El relayer es la wallet de `PRIVATE_KEY`.

| Función | Pasos en el contrato |
| --- | --- |
| `mintWithAuthorization` | `transferWithAuthorization` (USDC pagador → forwarder) · `approve(colección, todo)` · `colección.mintTo(pagador, n)` (la colección cobra `M`) · el USDC sobrante va a la tesorería. |
| `mintWithAuthorizationUSDCWithNativeProtocolFee` | Cobra el USDC · `approve(colección, M)` · cambia el resto de USDC a nativo en el pool · `mintTo{value: P}` · el sobrante (nativo y USDC) va a la tesorería. |
| `mintWithAuthorizationNative` | Cobra el USDC · cambia **todo** a nativo en el pool · `mintTo{value: M+P}` · el sobrante va a la tesorería. |
| `mintWithAuthorizationNativeUSDC` (Arc) | Cobra el USDC ERC-20, que es el mismo saldo que el nativo · comprueba `M+P ≤ value·1e12` · `mintTo{value: M+P}` · el sobrante va a la tesorería. |

La tesorería es la constante `PROTOCOL_FEE_RECIPIENT = 0x6db16927DbC38AA39F0Ee2cB545e15EFd813FB99` del contrato. **La comisión `C` y lo que sobre del margen del 1 % acaban ahí**, no en una wallet del gateway.

El NFT siempre va al pagador (`to = authorization.from`). Si el mint revierte, revierte también el cobro: van en la misma TX.

El gateway envía la firma partida en `v`, `r` y `s`, y supone que es ECDSA de 65 bytes (una EOA). Una wallet con firma de contrato (EIP-1271/6492) podría pasar el verify, pero el forwarder no la puede ejecutar.

## Respuestas

| Caso | Estado | Cuerpo |
| --- | --- | --- |
| Cadena no soportada | 400 | `{ error, supportedChainIds }` |
| Configuración de la cadena incompleta | 400 | `{ error: "Invalid chain configuration: …" }` |
| Dirección inválida | 400 | `{ error }` |
| `amount` inválido | 400 | `{ error }` + cabecera `x-x402-error` |
| Arc con token no admitido o USDC con protocol fee | 400 | `{ error }` |
| Sin pago | 402 | HTML del paywall (navegador) o JSON x402, con la cabecera `PAYMENT-REQUIRED` |
| Pago inválido | 402 | Lo que devuelve x402 |
| Payload sin `authorization` o sin `signature` | 400 | `{ error }` |
| Mint correcto | 200 | `{ success, message, mintParams: { chainId, contractAddress, amount, usdcAddress }, mintTxHash, etherscanTxUrl }`. En development añade `authorization` y los importes desglosados en `mintParams`. |
| Error al leer datos, en el verify o en la TX | 500 | `{ error, details }` + `x-x402-error` + `statusText`. El mensaje es el error real, con el correo `x402support@nfts2me.com`. Si es falta de gas, se muestra un texto fijo. |

`etherscanTxUrl` usa el explorador por defecto de la `Chain` de viem (en Arc, `arc.etherscan.io`, sobrescrito en `lib/networks.ts`).

### HEAD

Chrome (por COOP) y algunos *crawlers* envían `HEAD`. El envoltorio lo trata como `GET` para emparejar la ruta x402, devuelve solo las cabeceras, no envía alertas y **nunca mintea**, aunque lleve firma.

## Paywall

`@x402/paywall` con `evmPaywall`. Usa el nombre y el logo de la colección: `ipfs://` se convierte a `https://ipfs.io/ipfs/`. Si faltan, toma `APP_NAME` y `APP_LOGO`, y si tampoco están, `"NFTs2Me x402 Service"` y `/x402-icon-blue.png`. Este último fichero **no existe** en `public/`. `testnet` sale de `isTestnet`.

### Parches del paywall

`injectPaywallErrorFetchPatch` (`lib/rpc.ts`) modifica el HTML del 402 antes de enviarlo:

1. **Saldo ilegible.** Si falla `balanceOf`, el paywall original lo toma como `0n` y bloquea el pago con «Insufficient balance». El parche devuelve `null` y no actualiza el saldo, así que el botón *Pay now* sigue funcionando.
2. **Cadenas que faltan.** El bundle trae su propia copia de `viem/chains`, sin Arc mainnet (`5042`). Se añade `window.__x402ExtraChains` con `SUPPORTED_CHAINS` y se concatena en la búsqueda (`Object.values(ay).find(`). Sin esto, la página se queda en blanco con `Unsupported chain ID`.
3. **Mensajes de error.** HTTP/2 no transmite `statusText` y el paywall solo lee el `statusText`. Un `fetch` envuelto lo reconstruye con la cabecera `x-x402-error` o con el JSON (`details`/`error`/`message`).
4. **Overlay de fallo.** Si aun así salta `Unsupported chain ID`, se muestra un mensaje con el correo de soporte en lugar de la página en blanco.

Los parches 1 y 2 son sustituciones de texto sobre código minificado (`iJ`, `$ze`, `y1`, `ay`…). Están comprobadas con `@x402/paywall` 2.26.0. Con otra versión dejan de aplicarse sin dar error. Al actualizar el paquete, comprueba que las cadenas siguen apareciendo en `node_modules/@x402/paywall/dist`.

## Bazaar

Cada colección se declara como un recurso propio. Usa el patrón `GET /x402mint/{chainId}/{dirección en minúsculas}/:amount`, con solo `amount` variable, para que el catálogo tenga una entrada por colección y no una global. La metadata incluye:

- `serviceName`: el nombre de la colección en ASCII, con 32 caracteres como máximo.
- `tags`: `nft`, `mint`, `erc721`, `nfts2me` y la de la cadena.
- `iconUrl`: el logo de la colección o el de NFTs2Me.
- Una descripción.
- El esquema de `amount` y un ejemplo y esquema de la respuesta.

No está comprobado que los facilitadores cataloguen recursos que solo pasan por `/verify` y no por `/settle`.

## Alertas de mint

`alertMintFailure` envía un mensaje a Telegram con la cadena, la colección, la página de mint, el forwarder, la función, los argumentos de la llamada y la autorización. Así se puede reproducir con `eth_call`. Contextos:

| Contexto | Cuándo |
| --- | --- |
| `x402mint GET` | Excepción antes del envoltorio (lectura del contrato, Supabase, configuración). |
| `x402mint payment-error` | x402 devuelve un estado ≥ 500. |
| `x402mint no-payment-required` | La ruta no casa con la configuración x402 (error de configuración). |
| `x402mint verify wrapper` | Excepción durante el verify. |
| `x402mint settlement` | Falla la TX al forwarder o revierte. |

Dos errores tienen título y mensaje propios:

- **Falta de gas.**
- **`UnauthorizedRelayer()`**: la wallet de `PRIVATE_KEY` no es relayer del forwarder y hay que llamar a `setRelayer` desde el owner.

`extractOnchainErrorMessage` devuelve los *custom errors* como `Nombre(args)` si están en el ABI que se pasa a viem. Del forwarder, hoy solo está `UnauthorizedRelayer`. Los errores iguales (cadena, contexto, error normalizado, función, colección) no se repiten durante `MINT_ERROR_ALERT_SUPPRESS_MS` (15 min). Esa memoria es de cada instancia (`globalThis`), así que en Vercel puede llegar alguna alerta repetida.
