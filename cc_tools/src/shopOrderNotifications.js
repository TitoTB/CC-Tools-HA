import { sendTelegram } from './telegram.js';
import { CREALITY_SHOP_ORDERS_URL } from './shopOrders.js';

export async function notifyShippedShopOrders(config, orders = []) {
  if (!config.telegram?.enabled || config.telegram.notifyOnShopOrderShipped === false) return;
  for (const order of orders) {
    await sendTelegram(
      config,
      formatAvailableShopOrderTelegram(order),
      { parseMode: 'HTML' }
    ).catch((error) => console.error('[telegram]', error.message));
  }
}

export function formatAvailableShopOrderTelegram(order = {}) {
  const points = new Intl.NumberFormat('es-ES').format(Math.max(0, Number(order.points) || 0));
  const url = order.useUrl || CREALITY_SHOP_ORDERS_URL;
  const title = order.title || 'Producto de Creality Cloud';
  return `📦 CC Tools: Pedido disponible\n<a href="${escapeTelegramHtmlAttribute(url)}">${escapeTelegramHtml(title)}</a>\n${points} puntos`;
}

function escapeTelegramHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeTelegramHtmlAttribute(value) {
  return escapeTelegramHtml(value).replace(/"/g, '&quot;');
}
