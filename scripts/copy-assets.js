const fs = require("fs");
const path = require("path");

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

const root = path.join(__dirname, "..");
copyRecursive(path.join(root, "assets"), path.join(root, "dist", "assets"));
copyRecursive(path.join(root, "src", "main", "ui"), path.join(root, "dist", "main", "ui"));

if (!fs.existsSync(path.join(root, "assets", "trayTemplate.png"))) {
  require("./generate-tray-icon.js");
  copyRecursive(path.join(root, "assets"), path.join(root, "dist", "assets"));
}

console.log("Assets and UI copied");
