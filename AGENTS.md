# AGENTS.md — nfts2me-x402

Instrucciones para agentes de IA en este repo.

## Antes de empezar

Lee el [README](README.md) y el documento de `docs/` que toque el cambio. El código de negocio está casi todo en `app/x402mint/[chainId]/[contractAddress]/[amount]/route.ts` y `lib/`.

## Reglas

1. **Documentación en el mismo cambio.** Si cambian el flujo, las respuestas, las variables de entorno, las redes, los facilitadores o los forwarders, actualiza `docs/` y [PENDIENTES.MD](PENDIENTES.MD). Documenta el estado real, no el deseado.
2. **On-chain.** No cambies direcciones (forwarders, USDC, pools), ABIs del forwarder ni cómo se parte la firma sin que se pida. Son contratos desplegados (`../nfts2me-contracts`).
3. **Atomicidad.** El cobro tiene que ir siempre en la misma TX que el mint. No llames a `/settle` ni reactives `/api/mint`.
4. **Facilitador interno.** Solo verifica. No le des un signer con clave ni rutas HTTP.
5. **Parches del paywall** (`lib/rpc.ts`). Dependen del texto minificado de `@x402/paywall` 2.26.0. Si actualizas `@x402/*`, comprueba que las cadenas siguen en `node_modules/@x402/paywall/dist`.
6. **Redes.** Si añades o quitas una cadena, cambia también `apps/nfts2.me/utils/x402.ts` en `../monorepo-n2m`. Sigue el checklist de [docs/redes-y-facilitadores.md](docs/redes-y-facilitadores.md).
7. **Secretos.** Nunca escribas claves en el código ni en la documentación.
8. **Código comentado.** No borres código comentado sin preguntar. A veces se deja a propósito.
9. **Idioma.** Lo que ve el usuario va en inglés. Los comentarios y la documentación, en español. Los identificadores, en inglés.

## Verificación

No hay tests automatizados.

- `pnpm exec tsc --noEmit` tiene que pasar.
- `pnpm lint` está roto (ver PENDIENTES).
- Para cambios en el flujo, prueba en local contra Base Sepolia (`/x402mint/84532/…`): el 402 en el navegador y, si es posible, un pago real.

## Deploy

Vercel, proyecto `x402` del equipo `soccerarenadevs-projects` (ver [docs/operacion.md](docs/operacion.md#despliegue)). **Cada push a `main` despliega a producción**: no hagas push a `main` sin que el usuario lo pida de forma explícita en ese momento. Nunca imprimas ni subas `VERCEL_TOKEN_SOCCERARENA` (`.env.deploy.local`).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
