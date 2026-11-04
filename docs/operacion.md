# Operación

## Desarrollo local

```bash
pnpm install
pnpm dev                 # Turbopack
pnpm dev:webpack         # si Turbopack da problemas
pnpm dev:polling         # discos o volúmenes donde no llegan los eventos del sistema de ficheros
pnpm exec tsc --noEmit   # tipos (pasa)
pnpm build
```

`pnpm lint` está roto: ESLint 10 no es compatible con `eslint-plugin-react` 7.37.5, que trae `eslint-config-next`.

Hace falta Node ≥ 20.9 y un `.env.local`. Para un mint real en Base Sepolia necesitas USDC de testnet en la wallet que paga y ETH de Base Sepolia en la de `PRIVATE_KEY`. Además, esa wallet tiene que ser relayer del forwarder de Base Sepolia.

Ejemplo: `http://localhost:3000/x402mint/84532/<colección>/1`.

## Variables de entorno

Nunca subas valores al repo. Van en `.env.local` y en Vercel.

| Variable | Obligatoria | Uso | Por defecto |
| --- | --- | --- | --- |
| `PRIVATE_KEY` | Sí | Wallet que envía la TX al forwarder y paga el gas. Tiene que ser **relayer** de cada forwarder. | — |
| `NEXT_PUBLIC_SUPABASE_URL` | Sí | Supabase. Si falta, `lib/supabase.ts` lanza al importarse y `/x402mint` deja de funcionar. | — |
| `SUPABASE_SERVICE_KEY` | Sí | Lectura de `MintingPages`. | — |
| `FACILITATOR_URL` | No | Facilitador de mainnet (excepto Arc). También lo usa la demo `/premium`. | PayAI |
| `TESTNET_FACILITATOR_URL` | No | Facilitador de testnet. | x402.org |
| `COMMISSION_ENABLED` | No | Si es `false`, `0` o `no`, desactiva la comisión. | activada |
| `COMMISSION_AMOUNT` | No | Comisión en unidades de USDC (6 decimales). | `10000` (0,01) |
| `COMMISSION_DECIMALS` | No | Decimales con los que se da formato a **todo** el precio. Déjalo en 6. | `6` |
| `APP_NAME`, `APP_LOGO` | No | Nombre y logo del paywall si la colección no los tiene. | `NFTs2Me x402 Service`, `/x402-icon-blue.png` (no existe) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | No | Alertas. Si faltan, solo se escribe un aviso en el log. | — |
| `TELEGRAM_THREAD_ID` | No | Topic del grupo. | — |
| `CRON_SECRET` | Recomendada | Protege el cron. **Si no se define, el cron queda abierto en producción.** | — |
| `NATIVE_BALANCE_DAILY_THRESHOLD_USD` | No | Umbral del aviso de gas. | `1` |
| `MINT_ERROR_ALERT_SUPPRESS_MS` | No | Ventana en la que no se repiten alertas iguales. | 15 min |
| `PAY_TO_EVM_ADDRESS` | No | `payTo` de la demo `/premium`. Las alertas la usan como dirección si no hay `PRIVATE_KEY`. | — |

`.env.local` también tiene `NEXT_PUBLIC_SUPABASE_ANON_KEY`, pero el código no la usa. `CDP_API_KEY_ID` y `CDP_API_KEY_SECRET` solo harían falta si se activara el facilitador de Coinbase (está comentado).

## Despliegue

| | |
| --- | --- |
| Cuenta / equipo | `soccerarenadev` / `soccerarenadevs-projects` |
| Proyecto | `x402` (`prj_ZqYgMipNNUSMQUGIW6DTjL8DhoDa`) |
| Dominios | `x402.nfts2me.com` y `x402-pi.vercel.app` |
| Git | `github.com/nfts2me/nfts2me-x402`, rama de producción `main` |
| Runtime | Node 24.x, Fluid Compute, región `iad1` |
| Build | `pnpm install --force` y `pnpm run build` |

**Cada push a `main` despliega a producción automáticamente.** No hagas push a `main` sin querer desplegar.

Las variables de entorno solo están definidas para **Production**. Un deploy de Preview (push a otra rama) arranca sin `NEXT_PUBLIC_SUPABASE_URL`, y `/x402mint` falla. Las variables marcadas como *sensitive* (`PRIVATE_KEY`, `SUPABASE_SERVICE_KEY`, `TELEGRAM_BOT_TOKEN`, `CRON_SECRET`) no se pueden leer desde la API ni desde el panel.

En producción no hay `FACILITATOR_URL` ni `TESTNET_FACILITATOR_URL`, así que se usan PayAI y x402.org.

En producción la **comisión está desactivada** (`COMMISSION_ENABLED`; comprobado el 2026-11-04 con una colección gratuita de Base, que da un 402 de 0 USDC). En `.env.local` también. El precio x402 es solo el coste del mint, más el margen del 1 % cuando hay swap.

El directorio local no está enlazado con `vercel link`. Para consultar el proyecto desde la terminal, el token `VERCEL_TOKEN_SOCCERARENA` está en `.env.deploy.local` (ignorado por git), y se puede usar con la API REST o con `vercel --token`. `vercel.json` solo define los crons.

## Colecciones de prueba

Son colecciones baratas con el mint abierto a fecha 2026-11-04, para probar tras cada despliegue. Primero, sin pago: tiene que salir el 402 con el forwarder correcto como `payTo`. Después, un mint real desde el navegador.

| Red | Precio | Camino del forwarder | URL |
| --- | --- | --- | --- |
| Polygon | ~0,058 USDC | nativo, con swap (`mintWithAuthorizationNative`) | `https://x402.nfts2me.com/x402mint/137/0x9999a3fB60FE2340f24244676dcA9A48120B9cBC/1` |
| Arc | ~0,10 USDC | `mintWithAuthorizationNativeUSDC` | `https://x402.nfts2me.com/x402mint/5042/0x5C3f650120aba32D2c0F2bE6Dbeb048210C98564/1` |
| Base Sepolia | 0,01 USDC | USDC (`mintWithAuthorization`) | `https://x402.nfts2me.com/x402mint/84532/0xB2aeC85ba3A4ac509879AE4f7d9FFC5E297818D3/1` |
| Base Sepolia | ~0,19 USDC | nativo, con swap | `https://x402.nfts2me.com/x402mint/84532/0x2FD835d067Be70A4FE25D2A41E45121eae924989/1` |

Base mainnet no tiene colección de prueba fija: la más barata cobraba ~0,24 USDC y recorre el mismo camino que Polygon.

Para ver el 402 sin navegador (decodifica la cabecera `PAYMENT-REQUIRED`):

```bash
curl -sS -D - -o /dev/null -H "Accept: application/json" "https://x402.nfts2me.com/x402mint/137/0x9999a3fB60FE2340f24244676dcA9A48120B9cBC/1" \
  | grep -i '^payment-required:' | cut -d' ' -f2- | tr -d '\r' | base64 -d
```

Si alguna deja de servir (mint cerrado o agotado), busca otra entre las filas recientes de `MintingPages` para esa red. Comprueba el precio con el multicall de `lib/mintContractReads.ts` y simula `mintTo(to, 1)` desde el forwarder con `eth_call`.

## Cron de saldo de gas

`GET /api/cron/native-balance` (`maxDuration` de 60 s).

- Vercel lo llama a las 06:00 y a las 07:00 UTC. El handler solo actúa si en Europe/Madrid son las 8:00, así que se ejecuta una vez al día tanto en horario de verano como de invierno. Con `?force=1` se salta esa comprobación. Las llamadas sin el *user agent* `vercel-cron` no comprueban la hora.
- Autenticación: `Authorization: Bearer $CRON_SECRET`. En development no se exige, y tampoco si no hay `CRON_SECRET`.
- Para cada cadena de `SUPPORTED_CHAINS`, lee el saldo nativo de la wallet de `PRIVATE_KEY` y lo pasa a dólares:
  - Base y Base Sepolia: precio de `ethereum` en CoinGecko.
  - Polygon: precio de `matic-network` en CoinGecko.
  - Arc: 1 dólar.
  - El precio se guarda en caché 1 h por instancia.
- Envía **un** mensaje de Telegram si alguna cadena está por debajo del umbral o si alguna lectura falla. Si todo va bien, no envía nada.
- Responde con `{ ok, alerted, results }`.

Ejecución manual en producción:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://x402.nfts2me.com/api/cron/native-balance?force=1"
```

## Alertas de Telegram

Hay dos tipos:

- Mint fallido: ver [flujo-de-pago.md](flujo-de-pago.md#alertas-de-mint).
- Resumen diario de gas: el del cron.

Todas usan `sendTelegramMessage`, que nunca lanza y devuelve `false` si falla. Los mensajes van en inglés.

## Procedimientos

### Falta gas en una cadena

Síntomas: un 500 con «server wallet has insufficient native tokens…» y una alerta «low native gas».

Envía gas nativo a la wallet de `PRIVATE_KEY` en esa cadena: ETH en Base, POL en Polygon, USDC en Arc.

### Rotar `PRIVATE_KEY`

1. En cada forwarder, desde su owner, ejecuta `setRelayer(nueva, true)`.
2. Cambia `PRIVATE_KEY` en Vercel y redespliega.
3. Pasa el gas sobrante de la wallet vieja a la nueva.
4. Ejecuta `setRelayer(vieja, false)` en cada forwarder.
5. Actualiza `X402_RELAYER_ADDRESS` en `nfts2me-contracts/scripts/manual-n2mmintmasterx402-deploy.ts`.

Si la wallet nueva no es relayer, todos los mints revierten con `UnauthorizedRelayer()`.

### Sustituir un forwarder

1. Despliégalo desde `nfts2me-contracts`, con la wallet del gateway como relayer.
2. Comprueba on-chain `n2mVersion()` e `isRelayer(wallet) == true`.
3. Cambia `FORWARDER_CONTRACT_ADDRESSES` en `lib/networks.ts` y despliega.
4. Anota el cambio en `nfts2me-contracts/docs/seguridad.md` si sustituye a uno vulnerable.

El forwarder es el `payTo` y el `to` de la autorización. Si un cliente firmó contra el forwarder viejo y envía la firma después del despliegue, el gateway la rechaza con «Payment recipient does not match the forwarder».

### Pago cobrado sin mint

Con el flujo atómico no debería ocurrir. La excepción es que un tercero ejecute la autorización directamente en el USDC (ver [seguridad.md](seguridad.md)). En ese caso el USDC acaba en el forwarder, y en el siguiente mint se envía a la tesorería. Hay que devolverlo a mano al pagador.

### Actualizar `@x402/*`

Comprueba que los parches del paywall siguen encontrando su texto: busca las cadenas de `injectPaywallErrorFetchPatch` en `node_modules/@x402/paywall/dist`. Después carga un 402 de Arc en el navegador. Ver [flujo-de-pago.md](flujo-de-pago.md#parches-del-paywall).
