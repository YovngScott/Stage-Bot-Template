const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  fs.mkdirSync('qa/artifacts', { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:4175/qa/index.html');
    await page.getByText('Cuenta de prueba conectada').waitFor();
    await page.getByRole('button', { name: 'Crear respuesta' }).click();
    await page.getByLabel('Palabras clave, separadas por comas').fill('información, catálogo');
    await page.getByLabel('Respuesta que recibirá la persona').fill('Puedes consultar nuestros servicios en el catálogo de Stage. ¿Qué necesitas para tu negocio?');
    await page.getByRole('button', { name: 'Guardar respuestas' }).click();
    await page.getByText('Tus respuestas se guardaron.').waitFor();
    assert(await page.getByRole('button', { name: 'Guardar respuestas' }).isDisabled());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
    await page.getByLabel('Cuándo responder').focus();
    assert(await page.getByLabel('Cuándo responder').evaluate(el => el === document.activeElement));
    await page.screenshot({ path: `qa/artifacts/instagram-${name}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`${name}: save, labels, focus, overflow, runtime errors PASS`);
    await page.close();
  }
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
