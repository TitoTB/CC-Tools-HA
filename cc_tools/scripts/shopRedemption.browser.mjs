import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { confirmShopRedemption } from '../src/shopGoal.js';

const product = { id: 'petg-3473', name: 'Hyper PETG DTC discount code', points: 3473, type: 1 };
const scenarios = [
  { name: 'confirma el cupón en el tercer paso y espera la respuesta', delay: 2700 },
  { name: 'confirma un producto físico con dirección guardada', physical: true },
  { name: 'espera a que se cargue la dirección guardada', physical: true, delayedAddress: true },
  { name: 'espera a que se cargue la ficha antes de validar el precio', delayedDetail: true },
  { name: 'detecta dirección ausente sin gastar puntos', physical: true, noAddress: true, error: 'SHOP_ADDRESS_REQUIRED', sends: 0 },
  { name: 'detecta precio distinto sin gastar puntos', price: 5000, error: 'SHOP_GOAL_CHANGED', sends: 0 },
  { name: 'detecta otro producto sin gastar puntos', title: 'Otro producto', error: 'SHOP_GOAL_CHANGED', sends: 0 },
  { name: 'detecta una cantidad distinta de una unidad', quantity: 2, error: 'SHOP_GOAL_CHANGED', sends: 0 },
  { name: 'detecta botón deshabilitado', disabled: true, error: 'SHOP_REDEEM_UNAVAILABLE', sends: 0 },
  { name: 'muestra el rechazo real de la API', response: { code: 123, msg: 'Límite de canje alcanzado' }, error: 'SHOP_REDEEM_REJECTED' },
  { name: 'no interpreta un texto de éxito como pedido confirmado', response: { code: 0, result: {} }, error: 'SHOP_REDEEM_UNVERIFIED' },
  { name: 'no repite un envío con respuesta perdida', lost: true, error: 'SHOP_REDEEM_UNVERIFIED' },
  { name: 'ignora la respuesta de otro producto', wrongId: true, error: 'SHOP_REDEEM_UNVERIFIED' },
];

test('canje en navegador aislado; todas las peticiones se interceptan localmente', async (t) => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
  try {
    for (const scenario of scenarios) await t.test(scenario.name, async () => {
      const context = await browser.newContext();
      let sends = 0;
      const page = await context.newPage();
      await context.route('**/*', async (route) => {
        if (route.request().method() === 'POST') {
          sends++;
          const body = route.request().postDataJSON();
          assert.equal(body.buyNum, 1);
          if (scenario.lost) return route.abort();
          if (scenario.delay) await new Promise(resolve => setTimeout(resolve, scenario.delay));
          return route.fulfill({ json: scenario.response || { code: 0, result: { orderNo: 'TEST-ORDER-1' } } });
        }
        return route.fulfill({ contentType: 'text/html', body: fixture(scenario) });
      });
      try {
        await page.goto('https://shop.test/');
        const operation = confirmShopRedemption(page, { ...product, type: scenario.physical ? 2 : 1 }, { timeoutMs: 1000, responseTimeoutMs: scenario.delay ? 5000 : 1000 });
        if (scenario.error) {
          await assert.rejects(operation, error => error.code === scenario.error && (!scenario.response?.msg || error.message.includes(scenario.response.msg)));
        } else assert.equal(await operation, 'TEST-ORDER-1');
        assert.equal(sends, scenario.sends ?? 1);
        assert.equal(await page.evaluate(() => window.decoyClicks), 0);
        assert.equal(await page.evaluate(() => window.finalClicks), scenario.sends === 0 ? 0 : 1);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});

function fixture(scenario) {
  return `<button onclick="window.decoyClicks++">Canjear</button>
    <div class="el-dialog"><div class="goods-detail-content">
      <div class="goods-name">${scenario.delayedDetail ? '' : scenario.title || product.name}</div>
      <input role="spinbutton" value="${scenario.quantity || 1}">
    </div><div class="submit-box"><span class="pay-num">${scenario.price || '3.473'}</span>
      <button class="el-button--primary" ${scenario.disabled ? 'disabled' : ''} onclick="document.querySelector('#confirmation').style.display='block'">Canjear</button>
    </div></div>
    <div id="confirmation" class="${scenario.physical ? 'el-dialog' : 'el-message-box'}" style="display:none">
      ${scenario.physical ? `<div class="top-address"><div class="${scenario.noAddress || scenario.delayedAddress ? 'no-address' : 'address'}">Dirección</div></div>` : '<p>Confirmar gasto de 3.473 puntos</p>'}
      <div class="${scenario.physical ? 'submit-box' : 'el-message-box__btns'}"><button class="el-button--primary" onclick="submitOrder()">Confirmar pago</button></div>
    </div><p>Canjeado con éxito (texto antiguo que no valida el canje)</p>
    <button onclick="window.decoyClicks++">Canjear</button>
    <script>window.decoyClicks=0;window.finalClicks=0;
      ${scenario.delayedAddress ? "setTimeout(()=>document.querySelector('.no-address').className='address',700);" : ''}
      ${scenario.delayedDetail ? `setTimeout(()=>document.querySelector('.goods-name').textContent='${product.name}',700);` : ''}
      async function submitOrder(){window.finalClicks++; await fetch('${scenario.physical ? '/api/cxy/v2/goods/buy' : '/api/rest/lottery/goods/buy'}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'${scenario.wrongId ? 'another-product' : product.id}',buyNum:1})}).catch(()=>{});}
    </script>`;
}
