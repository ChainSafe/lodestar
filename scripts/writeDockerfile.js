const fs = require("fs");
const path = require("path");

// Use this script to write the pre-build step in the Dockerfile

const packagesDir = "packages";

console.log(fs.readdirSync(packagesDir)
  .map(pkg =>
    `COPY ${path.join(packagesDir, pkg, "package.json")} ${path.join(packagesDir, pkg)}/`
  ).join("\n")
);