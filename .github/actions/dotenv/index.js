const fs = require("fs");
const core = require("@actions/core");
const dotEnv = require("dotenv");
const envFile = ".env.test";

if (!fs.existsSync(envFile)) {
  core.setFailed("File .env not found");
}

const result = dotEnv.config({path: envFile});
if (result.error) {
  core.setFailed(result.error.message);
} else {
  core.setOutput("env", result.parsed);
  core.info("Env file loaded");
  core.info("Populating env variables...");

  for (const key in result.parsed) {
    const value = result.parsed[key];
    core.info(`${key}=${value}`);

    // Export variable
    core.exportVariable(key, value);

    // Set to output so it can be used in as the input for the next job/step
    core.setOutput(key, value);
    
  }
}
