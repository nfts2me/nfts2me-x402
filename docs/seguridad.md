# Seguridad y riesgos conocidos

Estado real del repo. Si un cambio abre o cierra un riesgo, actualiza este documento.

## Modelo de confianza

- **Pagador.** Firma una autorización EIP-3009 por un importe, con `to` = forwarder. La firma **no** cubre la colección, el receptor del NFT, la cantidad ni el pool.
- **Gateway (este repo).** Es de confianza: decide la colección, el pool y el receptor. Su wallet (`PRIVATE_KEY`) es el único relayer autorizado en los forwarders. Si esa clave se filtra, se puede usar cualquier autorización que llegue al gateway con una colección o un pool maliciosos. Hay que rotarla con `setRelayer` (ver [operacion.md](operacion.md#rotar-private_key)).
- **Forwarder.** Solo acepta llamadas de relayers (desde las versiones 2204 y 2205). Lo que sobra va a la tesorería fija.
- **Facilitador.** Solo verifica. No mueve fondos.

## Riesgos

1. **Forwarders vulnerables.** Las versiones 2200 y 2202 dejaban mintear a cualquiera, así que un tercero podía copiar una autorización pendiente y desviar el USDC. Se sustituyeron el 2026-11-04 (detalle en `nfts2me-contracts/docs/seguridad.md`). `FORWARDER_CONTRACT_ADDRESSES` apunta a los nuevos. Se comprobó on-chain que tienen la versión 2204/2205, que `isRelayer(0x4F82…BaaCd) == true` en las cuatro redes y que una llamada de otra dirección revierte con `UnauthorizedRelayer`. Las direcciones antiguas quedan comentadas en `lib/networks.ts` para que nadie las reutilice. Está en producción desde el 2026-11-04 y se ha probado con mints reales.
2. **La autorización se puede ejecutar fuera del gateway.** Cualquiera puede llamar a `USDC.transferWithAuthorization` con la firma (`to` = forwarder). El pagador pierde el USDC sin recibir el mint, aunque el atacante no gana nada. Hay que devolverlo a mano. Para evitarlo haría falta `receiveWithAuthorization`, que el cliente x402 estándar no firma.
3. **Las TX van por mempool pública.** El gateway no usa RPC privado. Con relayers ya no se puede robar, pero el riesgo 2 sigue existiendo.
4. **Swap sin mínimo de salida.** `_swapExactInputToWETH` usa el límite de precio extremo, así que se le puede hacer un *sandwich*. El único mínimo efectivo es `mintingFeeAmount` / `protocolFeeAmount`. El 1 % de margen puede perderse entero y, si el precio se mueve más, el mint revierte.
5. **Precio cacheado 60 s.** El precio que muestra el 402 y el `mintFee` que usa el handler salen de la misma caché. Si la colección sube el precio dentro de esa ventana, el mint revierte y no se cobra nada.
6. **No hay lista de colecciones permitidas.** Se acepta cualquier contrato. Uno que no sea de NFTs2Me puede mostrar un precio arbitrario. El pagador ve el importe antes de firmar y el nombre solo sale de Supabase, pero el gateway gasta gas en ese mint.
7. **Una misma autorización enviada dos veces a la vez.** El verify de `@x402/evm` simula `transferWithAuthorization` y rechaza un nonce ya usado. Pero si llegan dos peticiones con la misma firma antes de que se mine la primera TX, las dos pasan el verify. La segunda revierte: el gateway pierde el gas y salta una alerta.
8. **Los errores llegan al usuario.** Desde el commit `9253012` el mensaje de error real se devuelve también en producción (en `x-x402-error` y en el JSON). Puede incluir detalles del RPC.
9. **Mints gratis a costa de nuestro gas.** Con la comisión desactivada (como está en producción), una colección gratuita da un 402 de 0 USDC. Cualquiera puede firmar autorizaciones de 0 y hacer que la wallet del gateway pague el gas de cada mint, sin límite. No hay precio mínimo ni límite de peticiones.
10. **Cron abierto** si no se define `CRON_SECRET`. Solo lee saldos y envía a Telegram, pero cualquiera podría provocar mensajes.
11. **Parches sobre código minificado** del paywall. Una actualización de `@x402/paywall` puede desactivarlos sin avisar: la página se queda en blanco en Arc y vuelve el bloqueo por «Insufficient balance».

## Datos sensibles

- `PRIVATE_KEY` y `SUPABASE_SERVICE_KEY` solo se usan en el servidor.
- Las alertas de Telegram incluyen la autorización completa (firma incluida) y los argumentos de la llamada. La autorización ya es pública en la cadena cuando se ejecuta, pero el grupo de Telegram debe ser privado.
- Los logs de desarrollo (`logDev`) imprimen la autorización. `readMintContractDataWithMulticall` escribe en el log siempre, también en producción (sin datos sensibles).
