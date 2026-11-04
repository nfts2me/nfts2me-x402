# Pendientes

Estado a 2026-11-04. La ruta de producción es `GET /x402mint/...`, con verify-only y mint atómico en el forwarder.

## Urgente

- **Probar tras el despliegue los forwarders 2204/2205** en las cuatro redes (402 sin pago y un mint real con pago). `FORWARDER_CONTRACT_ADDRESSES` ya apunta a ellos; los antiguos (vulnerables) no se deben volver a usar.

## Por decidir

- **Mints con precio 0.** La comisión está desactivada en producción, así que las colecciones gratuitas salen a 0 USDC y el gas lo paga nuestra wallet sin límite. Hay tres opciones: activar la comisión, poner un precio mínimo que cubra el gas o rechazar las colecciones gratuitas. Ver [docs/seguridad.md](docs/seguridad.md).

## Errores y fragilidad

- `pnpm lint` falla: `eslint-plugin-react` 7.37.5 no funciona con ESLint 10.
- El logo por defecto `/x402-icon-blue.png` no existe en `public/`.
- `COMMISSION_DECIMALS` da formato a todo el precio. Si deja de valer 6, el cobro sale mal. Habría que usar 6 (decimales de USDC) para el precio y dejar la variable solo para la comisión, o quitarla.
- Los parches del paywall dependen del texto minificado de `@x402/paywall` 2.26.0, pero `package.json` admite `^2.26.0`. Conviene fijar la versión exacta o comprobar al arrancar que los parches se aplican.
- El cron queda abierto si no hay `CRON_SECRET` (en producción sí está definido).
- Los deploys de Preview no tienen variables de entorno y `/x402mint` falla en ellos.
- Solo `UnauthorizedRelayer` del forwarder está en el ABI. Los demás errores (`TransferFailed`, `SwapFailed`, `SwapNoOutput`, `InvalidPool`, `AddressZero`, `NotSupportedOnArc`, `UnsupportedPaymentToken`) llegan a la alerta sin nombre.
- `matic-network` en CoinGecko: comprobar que sigue dando precio para POL (si no, el cron avisa con «could not fetch USD price»).

## Mejoras

- No crear servidor x402, paywall y `initialize()` (`GET /supported` al facilitador) en cada petición. Por ejemplo, cachear el `x402ResourceServer` por facilitador.
- Deduplicar las alertas de Telegram entre instancias (hoy la memoria es por instancia).
- Firmas de smart wallets (EIP-1271/6492): el forwarder solo acepta `v,r,s`.
- Comprobar si PayAI cataloga en Bazaar recursos que solo pasan por `/verify`.
- Tests de integración de `/x402mint` (402, pago válido, errores) en Base Sepolia.

## Funcionalidad

- **Arc:** colecciones en ERC-20 USDC con protocol fee nativo (hoy devuelven 400; casi todas las de Arc son nativas).
- **Permit2** para tokens sin EIP-3009. Es lo que bloquea Robinhood (`4663`, USDG), que además necesita forwarder y facilitador.

## Limpieza

- Código muerto: `app/api/mint/…` y `app/mint/page.tsx` (comentados), `readMintContractDataWithOptimisticAllowance`, `validateMintPaymentConfiguration`, `ERC20_ALLOWANCE_ABI`, el `server` exportado por `proxy.ts`, el paquete `@coinbase/x402` y los imports sin usar de `app/page.tsx`.
- `package.json` se llama `"example"`.
- Variable `NEXT_PUBLIC_SUPABASE_ANON_KEY` sin usar en `.env.local`.
- `maybeSendDailyNativeBalanceAlert` no envía nada; solo clasifica. El nombre confunde.
- El `console.log` de `readMintContractDataWithMulticall` sale también en producción.
- Demo `/premium` (`proxy.ts`): decidir si se mantiene.

## Fuera de alcance

- Reembolsos si se cobra y el mint revierte: en el flujo atómico van en la misma TX. El único caso es que se ejecute la autorización fuera del gateway, y se resuelve a mano (ver [docs/seguridad.md](docs/seguridad.md)).
- No reactivar `/api/mint` (settle después del mint, no atómico).
