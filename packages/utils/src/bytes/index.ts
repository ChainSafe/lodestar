import {
  fromHex as browserFromHex,
  fromHexInto as browserFromHexInto,
  toHex as browserToHex,
  toPubkeyHex as browserToPubkeyHex,
  toRootHex as browserToRootHex,
} from "./browser.js";
import {
  fromHex as nodeFromHex,
  fromHexInto as nodeFromHexInto,
  toHex as nodeToHex,
  toPubkeyHex as nodeToPubkeyHex,
  toRootHex as nodeToRootHex,
} from "./nodejs.js";

let toHex = browserToHex;
let toRootHex = browserToRootHex;
let toPubkeyHex = browserToPubkeyHex;
let fromHex = browserFromHex;
let fromHexInto = browserFromHexInto;

if (typeof Buffer !== "undefined") {
  toHex = nodeToHex;
  toRootHex = nodeToRootHex;
  toPubkeyHex = nodeToPubkeyHex;
  fromHex = nodeFromHex;
  fromHexInto = nodeFromHexInto;
}

export {toHex, toRootHex, toPubkeyHex, fromHex, fromHexInto};
