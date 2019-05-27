const wasm = require("./index.js");

const f = new wasm.Node(20, wasm.newString("boo"), null);
const slot = f.slot;
console.log(slot);
const root = wasm.getString(f.blockRoot);
console.log(root);
