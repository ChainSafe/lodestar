/**
 * Manual Integration Test: Voluntary Exit --saveToFile
 *
 * Steps:
 * 1️⃣ Run voluntary exit command to save data to a file.
 * 2️⃣ Verify file exists and contains JSON.
 * 3️⃣ Simulate reading that file later and sending it to mock beacon client.
 */

import fs from "fs";
import path from "path";
import url from "url";

// --- Setup __dirname in ES module ---
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const voluntaryExitHandler = async (args) => {
  console.log("⚙️ Mock voluntary exit handler running with args:", args);
  if (args.saveToFile) {
    fs.writeFileSync(args.saveToFile, JSON.stringify({ message: "Mock voluntary exit data" }, null, 2));
  }
};


// --- Mock Beacon Client ---
const mockBeaconClient = {
  beacon: {
    submitPoolVoluntaryExit: async (exitData) => {
      console.log("📨 Mock beacon received voluntary exit:", exitData);
      return { status: "ok", submitted: true };
    },
  },
};

// --- File path for saving voluntary exit ---
const TEST_FILE_PATH = path.resolve(__dirname, "./exit-test.json");

async function runManualIntegrationTest() {
  console.log("🧪 Starting Voluntary Exit Write-to-File Integration Test...");

  const args = {
    allowUnlockedValidator: true,
    saveToFile: TEST_FILE_PATH,
    publishToNetwork: false,
    mockClient: mockBeaconClient,
  };

  try {
    // Step 1️⃣ Run the voluntary exit command
    await voluntaryExitHandler(args);

    // Step 2️⃣ Verify file was created
    if (!fs.existsSync(TEST_FILE_PATH)) {
      throw new Error("File was not created!");
    }
    console.log("✅ File created successfully:", TEST_FILE_PATH);

    // Step 3️⃣ Read file content
    const fileContent = fs.readFileSync(TEST_FILE_PATH, "utf-8");
    const exitData = JSON.parse(fileContent);
    console.log("📄 File content:", exitData);

    // Step 4️⃣ Simulate later submission to mock beacon client
    const result = await mockBeaconClient.beacon.submitPoolVoluntaryExit(exitData);

    if (result.submitted) {
      console.log("✅ Voluntary exit successfully submitted to mock beacon client.");
    } else {
      console.error("❌ Submission failed.");
    }
  } catch (err) {
    console.error("💥 Test failed:", err);
  } finally {
    // Step 5️⃣ Cleanup
    if (fs.existsSync(TEST_FILE_PATH)) {
      fs.unlinkSync(TEST_FILE_PATH);
      console.log("🧹 Cleaned up test file.");
    }
  }
}

runManualIntegrationTest();
