import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

console.log('Abriendo browser para login en Facebook...');
console.log('1. Hacé login manualmente en la ventana');
console.log('2. Cuando termines, cerrá el browser\n');

const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto('https://www.facebook.com/login');

page.on('close', async () => {
  try {
    const state = await context.storageState();
    writeFileSync('fb-state.json', JSON.stringify(state));

    const b64 = Buffer.from(JSON.stringify(state)).toString('base64');
    console.log('\n✓ Cookies guardadas en fb-state.json');
    console.log('\nPara EasyPanel, agregar esta variable de entorno:');
    console.log(`\nFB_STORAGE_STATE=${b64}\n`);
  } catch (e) {
    console.error('Error guardando estado:', e.message);
  } finally {
    await browser.close().catch(() => {});
    process.exit(0);
  }
});
