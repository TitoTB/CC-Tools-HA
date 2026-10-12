import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { confirmShopRedemption } from '../src/shopGoal.js';

const product = { id: 'petg-3473', name: 'Hyper PETG DTC discount code', points: 3473, type: 1 };

test('solo confirma el canje cuando la API devuelve el pedido esperado', async (t) => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32' ? { channel: 'chrome' } : {})
  });
  try {
    const cases = [
      { name: 'pedido confirmado', orderNo: 'TEST-ORDER-1' },
      { name: 'respuesta sin pedido', error: 'SHOP_REDEEM_UNVERIFIED' },
      { name: 'rechazo funcional', response: { code: 4, msg: 'Invalid Token' }, error: 'SHOP_REDEEM_REJECTED' },
      { name: 'producto distinto', title: 'Otro producto', error: 'SHOP_GOAL_CHANGED', sends: 0 },
      { name: 'cantidad distinta', quantity: 2, error: 'SHOP_GOAL_CHANGED', sends: 0 }
    ];
    for (const scenario of cases) await t.test(scenario.name, async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      let sends = 0;
      await context.route('**/*', async (route) => {
        if (route.request().method() === 'POST') {
          sends += 1;
          return route.fulfill({
            json: scenario.response || { code: 0, result: scenario.orderNo ? { orderNo: scenario.orderNo } : {} }
          });
        }
        return route.fulfill({ contentType: 'text/html', body: fixture(scenario) });
      });
      try {
        await page.goto('https://shop.test/');
        const operation = confirmShopRedemption(page, product, { timeoutMs: 500, responseTimeoutMs: 500 });
        if (scenario.error) await assert.rejects(operation, (error) => error.code === scenario.error);
        else assert.equal(await operation, scenario.orderNo);
        assert.equal(sends, scenario.sends ?? 1);
      } finally {
        await context.close();
      }
    });
  } finally {
    await browser.close();
  }
});

function fixture(scenario) {
  return `<div class="el-dialog"><div class="goods-detail-content">
      <div class="goods-name">${scenario.title || product.name}</div>
      <input role="spinbutton" value="${scenario.quantity || 1}">
    </div><div class="submit-box"><span class="pay-num">3.473</span>
      <button class="el-button--primary" onclick="document.querySelector('#confirmation').style.display='block'">Canjear</button>
    </div></div>
    <div id="confirmation" class="el-message-box" style="display:none">
      <div class="el-message-box__btns"><button class="el-button--primary" onclick="submitOrder()">Confirmar pago</button></div>
    </div><script>
      async function submitOrder(){await fetch('/api/rest/lottery/goods/buy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'${product.id}',buyNum:1})});}
    </script>`;
}
