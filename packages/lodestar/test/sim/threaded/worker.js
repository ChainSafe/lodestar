const path = require("node:path");
const {workerData} = require("worker_threads");

require("ts-node").register();
require(path.resolve(__dirname, workerData.path));
