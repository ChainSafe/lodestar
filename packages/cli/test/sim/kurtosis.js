import {KurtosisContext, StarlarkRunConfig} from "kurtosis-sdk";

const starlarkRunConfig = new StarlarkRunConfig(
  StarlarkRunConfig.WithDryRun(false)
)

const newKurtosisContextResult = await KurtosisContext.newKurtosisContextFromLocalEngine();
if (newKurtosisContextResult.isErr()) {
  throw newKurtosisContextResult.error;
}
const kurtosisContext = newKurtosisContextResult.value;
console.log("Got the context...");

const enclaveName = "my-enclave";
const createEnclaveResult = await kurtosisContext.createEnclave(enclaveName);
if (createEnclaveResult.isErr()) {
  throw createEnclaveResult.error;
}
const enclaveContext = createEnclaveResult.value;
console.log("Got the enclave...");

try {
  const packageId = "github.com/kurtosis-tech/basic-service-package";
  const runResult = await enclaveContext.runStarlarkRemotePackageBlocking(packageId, starlarkRunConfig);
  if (runResult.isErr()) {
    throw runResult.error;
  }
  console.log("Run:", runResult.value);

  const servicesResult = await enclaveContext.getServices();
  if (servicesResult.isErr()) {
    throw servicesResult.error;
  }
  const services = servicesResult.value;
  console.log("Services: ", services);

  for (const ser of services) {
    const serviceResult = await enclaveContext.getServiceContext(ser[0]);
    if (serviceResult.isErr()) {
      throw serviceResult.error;
    }
    const service = serviceResult.value;
    console.log("Public Ports:", service.getPublicPorts());
    console.log("Private Ports:", service.getPrivatePorts());
  }
} finally {
  console.log("Cleaning the enclave")
  await kurtosisContext.destroyEnclave(enclaveName);
}
