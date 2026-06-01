# NFTs2Me x402 Mint Gateway (WIP)

Proyecto Next.js para habilitar pagos x402 en el flujo de minteo de colecciones de NFTs2Me.

## Objetivo final

El objetivo final de este repositorio es permitir que cualquier colección de NFTs2Me pueda exponer un endpoint de minteo protegido por x402, donde:

1. El precio se obtiene dinámicamente del smart contract de la colección (`mintFee`).
2. El pago se valida en USDC en la red correspondiente (Base o Base Sepolia).
3. El minteo se ejecuta de forma segura tras validación del pago.
4. El paywall se personaliza automáticamente con metadatos de la colección (logo y nombre) obtenidos desde Supabase.
5. Existan dos modos operativos:
	- settlement estándar con `withX402`.
	- verify-only con `withX402VerifyOnly` para settlement atómico on-chain con `transferWithAuthorization`.

## Estado actual

Estado: **Work in Progress**.

Lo que ya está implementado:

1. Integración base de x402 en Next.js con `paymentProxy` y `x402ResourceServer`.
2. Endpoint dinámico de minteo con settlement estándar:
	- `GET /api/mint/[chainId]/[contractAddress]/[amount]`
3. Endpoint dinámico verify-only (sin settle automático):
	- `GET /api/mint02/[chainId]/[contractAddress]/[amount]`
4. Validaciones on-chain básicas:
	- `protocolFee === 0`
	- `erc20PaymentAddress` coincide con USDC de la red
5. Construcción dinámica del paywall según chainId y metadatos de Supabase.
6. Wrapper propio `withX402VerifyOnly` en `lib/withX402VerifyOnly.ts`.

Limitaciones y pendientes actuales:

1. La UI `app/mint/page.tsx` invoca `POST /api/mint`, pero el endpoint implementado es dinámico por ruta y con método `GET`. Esta página es demostrativa y no está alineada aún con la API real.
2. `app/premium/page.tsx` existe para demo del paywall, pero no representa todavía el flujo final de minteo en producción.
3. Metadata global (title/description) y home siguen en modo ejemplo.
4. Hay logging de depuración en rutas API que debe ajustarse antes de producción.

## Arquitectura (resumen)

1. `app/api/mint/.../route.ts` (`Protecting API Routes. Vía https://github.com/x402-foundation/x402/tree/main/typescript/packages/http/next#protecting-api-routes`)
	- Usa `withX402`.
	- Calcula precio dinámico leyendo `mintFee` del contrato.
	- Ejecuta aprobación (si aplica) y `mintTo` con wallet del servidor.
2. `app/api/mint02/.../route.ts`
	- Usa `withX402VerifyOnly`.
	- Verifica pago y devuelve autorización EIP-3009 para settle atómico on-chain.
3. `lib/supabase.ts`
	- Obtiene `ipfs_logo` y `name` de `MintingPages`.
	- Cachea respuesta 24h con `unstable_cache`.
4. `proxy.ts` (Para proteger Page routes. Vía https://github.com/coinbase/x402/tree/main/typescript/packages/http/next#x402next . Realmente es una prueba de concepto, pero no nos resulta útil para nosotros usar el 'paymentProxy', porque no queremos proteger una página). El pago puede que llegue en el mismo bloque por la preconfirmación, o en el siguiente. WARNING!!
	- Inicializa `x402ResourceServer` y esquema EVM exact.
	- Configura `paymentProxy` para rutas protegidas de ejemplo.


## Requisitos

1. Node.js 18+.
2. npm/pnpm/yarn.
3. Variables de entorno configuradas (wallet, claves x402/supabase, etc.).
4. Acceso RPC de la red objetivo.

## Variables de entorno

Variables esperadas por el proyecto (segun código actual):

1. `WALLET_ADDRESS`
2. `EVM_ADDRESS`
3. `PRIVATE_KEY`
4. `APP_NAME`
5. `APP_LOGO`
6. `NEXT_PUBLIC_SUPABASE_URL`
7. `SUPABASE_SERVICE_KEY`

Notas:

1. `lib/supabase.ts` lanza error al iniciar si faltan `NEXT_PUBLIC_SUPABASE_URL` o `SUPABASE_SERVICE_KEY`.
2. No se deben commitear secretos reales en el repositorio.

## Desarrollo local

Instalación:

```bash
pnpm install
```

Ejecución:

```bash
pnpm run dev
```

Lint:

```bash
pnpm run lint
```

## Endpoints disponibles

1. `GET /api/mint/[chainId]/[contractAddress]/[amount]`
	- Verifica y liquida pago x402 (flujo estándar).
	- Realiza mint vía `mintTo`.
2. `GET /api/mint02/[chainId]/[contractAddress]/[amount]`
	- Verifica pago x402 sin settle.
	- Devuelve autorización EIP-3009 para settle atómico on-chain.

### Endpoints ejemplo DEV

- http://localhost:3000/api/mint/84532/0xB2aeC85ba3A4ac509879AE4f7d9FFC5E297818D3/2
- http://localhost:3000/api/mint02/84532/0xB2aeC85ba3A4ac509879AE4f7d9FFC5E297818D3/2

## Redes soportadas (implementación actual)

1. Base mainnet (`chainId 8453`).
2. Base Sepolia (`chainId 84532`).

Si se envía un `chainId` no soportado, la API responde `400` y no aplica fallback automático a otra red.

La detección de testnet para el paywall se basa en:

1. `84532`
2. `11155111`
3. `80002`

## Checklist para producción

1. Alinear UI de minteo con endpoints reales (método y path).
2. Revisar seguridad de secretos y rotación de claves.
3. Eliminar logs sensibles/de depuración.
4. Definir estrategia final entre `withX402` y `withX402VerifyOnly` por caso de uso.
5. Añadir tests de integración para rutas `/api/mint` y `/api/mint02`.

## Política de mantenimiento del README

Regla obligatoria del proyecto:

**Cada cambio de funcionalidad, endpoint, flujo de pago, variable de entorno o comportamiento del sistema debe venir acompañado de una actualización del README en el mismo PR/commit.**

Si el README queda desactualizado, el cambio se considera incompleto.

## Estado del proyecto

Este repositorio está en fase activa de construcción y validación.

No debe considerarse todavía una integración final de producción, pero sí una base funcional para evolucionar al gateway oficial de minteo x402 de NFTs2Me.


## IMPORTANTE

Todo el código que genere texto que se pueda leer desde el exterior (logs, respuestas API, etc.) debe estar en inglés, para mantener consistencia y facilitar futuras integraciones internacionales.

Los comentarios y cosas internas se deben hacer en español.
