const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const assetsDir = path.join(__dirname, "..", "assets");
fs.mkdirSync(assetsDir, { recursive: true });

const size = 32;
const png = new PNG({ width: size, height: size });

for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const idx = (size * y + x) << 2;
    const cx = x - size / 2 + 0.5;
    const cy = y - size / 2 + 0.5;
    const r = Math.sqrt(cx * cx + cy * cy);
    const ring = Math.abs(r - 10) < 2.2 || r < 3.5;
    const alpha = ring ? 255 : 0;
    png.data[idx] = 0;
    png.data[idx + 1] = 0;
    png.data[idx + 2] = 0;
    png.data[idx + 3] = alpha;
  }
}

fs.writeFileSync(path.join(assetsDir, "trayTemplate.png"), PNG.sync.write(png));
console.log("Generated assets/trayTemplate.png");
