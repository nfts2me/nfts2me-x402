# NFTs2Me x402 Mint Gateway

Gateway Next.js (`x402.nfts2me.com`) para mintear colecciones de [NFTs2Me](https://nfts2me.com) pagando con [x402](https://www.x402.org).

El cliente firma una autorización EIP-3009 en USDC. El gateway la verifica con un facilitador y envía él mismo la TX a un contrato *forwarder*, que cobra el USDC y mintea en la misma transacción. Si el mint falla, no se cobra.

```
GET /x402mint/{chainId}/{colección}/{n}
  sin pago   → 402 + paywall con el nombre y logo de la colección
  con pago   → facilitador /verify → forwarder.mintWithAuthorization*(…) → 200 { mintTxHash, … }
```

Cadenas activas: Polygon `137`, Base `8453`, Base Sepolia `84532` y Arc `5042`.

## Documentación

| Documento | Contenido |
| --- | --- |
| [docs/arquitectura.md](docs/arquitectura.md) | Piezas, relación con el monorepo y los contratos, mapa del código, stack. |
| [docs/flujo-de-pago.md](docs/flujo-de-pago.md) | Secuencia de la petición, cálculo del precio, funciones del forwarder y adónde va el dinero, respuestas, paywall y sus parches, Bazaar, alertas. |
| [docs/redes-y-facilitadores.md](docs/redes-y-facilitadores.md) | Estado por red, qué facilitador usa cada una, facilitador interno, cómo añadir una red. |
| [docs/operacion.md](docs/operacion.md) | Desarrollo local, variables de entorno, despliegue, cron de gas, alertas, procedimientos (rotar clave, cambiar forwarder…). |
| [docs/seguridad.md](docs/seguridad.md) | Modelo de confianza y riesgos conocidos. |
| [PENDIENTES.MD](PENDIENTES.MD) | Trabajo abierto y deuda técnica. |

Repos relacionados: `../monorepo-n2m` (botón x402 en las minting pages, `apps/nfts2.me/utils/x402.ts`) y `../nfts2me-contracts` (forwarders `N2MMintmasterX402*`).

## Arranque rápido

```bash
pnpm install
pnpm dev        # http://localhost:3000/x402mint/84532/<colección>/1
```

Hace falta `.env.local` con al menos `PRIVATE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_KEY`. Detalle en [docs/operacion.md](docs/operacion.md).

## Convenciones

- Lo que ve el usuario (respuestas de la API, paywall, Telegram) va en **inglés**. Los comentarios y la documentación interna, en **español**.
- Cualquier cambio de flujo, endpoint, variable de entorno, red o forwarder actualiza `docs/` en el mismo commit.
