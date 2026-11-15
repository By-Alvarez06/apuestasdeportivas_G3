/**
 * Cálculo exacto de cuotas y pagos (research R3). Vive en @apuestas/shared para que la web muestre
 * el mismo pago estimado que calcula la API; la API recalcula siempre al aceptar y liquidar.
 * Cuotas en centésimas (2.10 → 210), montos en centavos, productos con BigInt y pagos redondeados
 * hacia abajo: la casa nunca paga de más por redondeo.
 */
export {
  applyBoost,
  displayTotalOdds,
  potentialPayout,
  totalOddsX,
  VOID_ODDS,
} from '@apuestas/shared';
