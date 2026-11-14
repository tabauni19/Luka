// Genera los íconos y splash de Android a partir del diseño de public/icon.svg (requiere Playwright).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const RES = path.join(__dirname, '../android/app/src/main/res');
const BG = '#0E3B36';
const coin = (s) => `<circle cx="256" cy="256" r="150" fill="#F2B544"/><circle cx="256" cy="256" r="112" fill="none" stroke="${BG}" stroke-width="14" stroke-dasharray="4 18" stroke-linecap="round"/><path d="M214 176v160h92" fill="none" stroke="${BG}" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>`.replace(/\$\{s\}/g, s);
const full = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${BG}"/>${coin()}</svg>`;
const round = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="256" fill="${BG}"/>${coin()}</svg>`;
// Foreground adaptativo: lienzo 108dp con zona segura de 66dp → la moneda ocupa ~60% del lienzo.
const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-90 -90 692 692">${coin()}</svg>`;
const D = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
(async () => {
  const b = await chromium.launch();
  const shot = async (svg, size, out, w = size, h = size) => {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(`<html><body style="margin:0;background:transparent;display:grid;place-items:center;width:${w}px;height:${h}px">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await p.screenshot({ path: out, omitBackground: true });
    await p.close();
  };
  for (const [d, k] of Object.entries(D)) {
    await shot(full, 48 * k, `${RES}/mipmap-${d}/ic_launcher.png`);
    await shot(round, 48 * k, `${RES}/mipmap-${d}/ic_launcher_round.png`);
    await shot(fg, 108 * k, `${RES}/mipmap-${d}/ic_launcher_foreground.png`);
  }
  // Splash: fondo verde con la moneda al centro, en todos los tamaños existentes.
  for (const dir of fs.readdirSync(RES).filter((x) => x.startsWith('drawable'))) {
    const f = `${RES}/${dir}/splash.png`;
    if (!fs.existsSync(f)) continue;
    const buf = fs.readFileSync(f);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    const size = Math.round(Math.min(w, h) * 0.35);
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(`<html><body style="margin:0;background:${BG};display:grid;place-items:center;width:${w}px;height:${h}px"><svg width="${size}" height="${size}" viewBox="100 100 312 312" xmlns="http://www.w3.org/2000/svg">${coin()}</svg></body></html>`);
    await p.screenshot({ path: f });
    await p.close();
  }
  await b.close();
})();
