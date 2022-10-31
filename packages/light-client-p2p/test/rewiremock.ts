// rewiremock.es6.js
import rewiremock, {overrideEntryPoint} from "rewiremock";
overrideEntryPoint(module); // this is important. This command is "transfering" this module parent to rewiremock
export {rewiremock};
