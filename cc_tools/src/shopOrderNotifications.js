import { sendTelegram } from './telegram.js';
import { CREALITY_SHOP_ORDERS_URL } from './shopOrders.js';

export async function notifyShippedShopOrders(config, orders = []) {
  if (!config.telegram?.enabled || config.telegram.notifyOnShopOrderShipped === false) return;
  for (const order of orders) {
    const points = new Intl.NumberFormat('es-ES').format(Math.max(0, Number(order.points) || 0));
    await sendTelegram(
      config,
      `📦 CC Tools: Pedido enviado\n${order.title}\n${points} puntos\n${CREALITY_SHOP_ORDERS_URL}`
    ).catch((error) => console.error('[telegram]', error.message));
  }
}
