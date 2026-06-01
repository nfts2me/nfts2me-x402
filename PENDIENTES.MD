Ahora mismo el API "mint" está funcionando. Vía https://github.com/coinbase/x402/tree/main/typescript/packages/http/next#withx402
El API de la ruta 'mint' el problema es que hace el settle después del mint, y el pago puede que llegue en el mismo bloque por la preconfirmación, o en el siguiente. WARNING!!

Una opción es que si la cantidad es mayor que xx, se fuerce a hacer el settlement antes del mint. Para no jugárnosla.

Ahora tengo que ver el API "mint2" en qué se diferenciaba.
Luego ver cuál me interesa más.
Por último, comenzar a hacer lo del permit2 si no es el "mint2".

Además, también tengo ver el tema de qué pasa en caso de un revert, porque habrá que devolver el dinero. Y si no lo tengo, no puedo devolverlo.

1.- permitir with permit2 o similar
2.- Permitir con protocolFee !== 0
3.- hacer el plan.md
4.- Añadir metadata para bazaar
