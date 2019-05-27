const fs = require("fs");
const loader = require("assemblyscript/lib/loader");
const compiled = new WebAssembly.Module(fs.readFileSync(__dirname + "/assembly-build/optimized.wasm"));
const imports = {};
Object.defineProperty(module, "exports", {
  get: () => loader.instantiate(compiled, imports)
});

