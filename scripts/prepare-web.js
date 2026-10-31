const fs = require("fs");
const path = require("path");

const files = [
  "index.html",
  "cloud-config.js",
  "cloud-sync.js",
  "manifest.webmanifest",
  "sw.js",
  "icon-192.png",
  "icon-512.png",
  "logo.jpg",
  "brand-cover.jpg"
];

const root = path.join(__dirname, "..");
const output = path.join(root, "www");

fs.mkdirSync(output, { recursive: true });

for (const file of files) {
  const source = path.join(root, file);

  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(output, file));
    console.log("Copied:", file);
  } else {
    console.log("Not found:", file);
  }
}

console.log("Website preparation completed.");
