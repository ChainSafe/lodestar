import {join} from "node:path";
import {requireNapiLibrary} from "@chainsafe/zapi";

const bindings = requireNapiLibrary(join(import.meta.dirname, ".."));

export default bindings;
