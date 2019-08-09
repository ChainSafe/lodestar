/* eslint-disable */
// Move all documentation to project root

const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");

const pkgsDir = path.join(rootDir, "packages");
const docsDir = path.join(rootDir, "docs");

if (fs.existsSync(docsDir)) {
  fs.rmdirSync(docsDir);
}
fs.mkdirSync(docsDir);

for (const pkg of fs.readdirSync(pkgsDir)) {
  const oldPath = path.join(pkgsDir, pkg, "docs");
  const newPath = path.join(docsDir, pkg);
  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
  }
}
