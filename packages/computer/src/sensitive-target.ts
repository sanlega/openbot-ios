/**
 * Broker "ask" rules for sensitive computer targets: only what spends money or destroys data.
 * Sending, connecting, confirming or submitting what the request asked for is not risky, and the
 * words must stand alone ("Payment" and "Pay now" match, "Paypal login" and "Sender" do not).
 */
export const SENSITIVE_TARGET_PATTERN = new RegExp(
  String.raw`(^|[^\p{L}])(pay( now)?|payment|buy( now)?|purchase|checkout|place (your |my )?order|submit order|transfer( funds| money)?|wire|donate|delete( (my )?(account|forever|permanently|all))?|remove (my )?account|close (my )?account|deactivate|erase|pagar|pago|comprar|compra|eliminar( cuenta)?|borrar|transferir|donar|supprimer|acheter|payer|löschen|kaufen|bezahlen)([^\p{L}]|$)`,
  "iu",
);

export function isSensitiveLabel(label: string): boolean {
  return SENSITIVE_TARGET_PATTERN.test(label);
}
