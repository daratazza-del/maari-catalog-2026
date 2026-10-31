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

const output = path.join(__dirname, "..", "www");

fs.mkdirSync(output, { recursive: true });

for (const file of files) {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(output, file));
    console.log("Copied:", file);
