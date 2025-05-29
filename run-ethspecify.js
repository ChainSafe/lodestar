/**
 * Wrapper script for ethspecify
 * 
 * This script:
 * 1. Reads the centralized spec references from spec-references.ts
 * 2. Generates a temporary HTML file containing all the spec tags
 * 3. Runs ethspecify on this HTML file
 * 4. Processes and displays the results
 * 5. Cleans up the temporary file
 */

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Import the spec references
// Note: Need to transpile TypeScript to JS first or use a runtime like ts-node
// For simplicity, we'll read the file and extract the data
const specReferencesPath = path.join(__dirname, 'spec-references.ts');
const specReferencesContent = fs.readFileSync(specReferencesPath, 'utf8');

// Extract the SpecReferences array using regex
const specReferencesMatch = specReferencesContent.match(/export const SpecReferences = \[([\s\S]*?)\];/);
if (!specReferencesMatch) {
  console.error('Could not find SpecReferences in the spec-references.ts file');
  process.exit(1);
}

// Create a temporary directory for ethspecify to process
const tempDir = path.join(__dirname, 'temp-ethspecify');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

// Create a temporary HTML file with all the spec tags
const tempHtmlPath = path.join(tempDir, 'spec-references.html');
let htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <title>Lodestar Spec References</title>
</head>
<body>
  <h1>Ethereum Specification References for Lodestar</h1>
`;

// Parse the SpecReferences array content using regex to extract each entry
const specRefContent = specReferencesMatch[1];
const specRefEntries = [];
const entryRegex = /{\s*component:\s*"([^"]+)",\s*filePath:\s*"([^"]+)",\s*specTag:\s*`([^`]+)`\s*}/g;
let match;

while ((match = entryRegex.exec(specRefContent)) !== null) {
  specRefEntries.push({
    component: match[1],
    filePath: match[2],
    specTag: match[3]
  });
}

// Add validation for @SPEC tags
const missingSpecTags = [];
specRefEntries.forEach(ref => {
  if (!specReferencesContent.includes(`@SPEC ${ref.component}`)) {
    missingSpecTags.push(ref.component);
  }
});

if (missingSpecTags.length > 0) {
  console.log('\nWarning: Missing @SPEC tags for:');
  missingSpecTags.forEach(component => console.log(`- ${component}`));
}

// Add each spec reference to the HTML content
specRefEntries.forEach(ref => {
  htmlContent += `
  <div class="spec-reference">
    <h3>${ref.component}</h3>
    <p>File: ${ref.filePath}</p>
    <pre>
      /**
       * ${ref.specTag}
       */
    </pre>
  </div>
  `;
});

htmlContent += `
</body>
</html>
`;

// Write the HTML content to the temporary file
fs.writeFileSync(tempHtmlPath, htmlContent);
console.log(`Created temporary HTML file with ${specRefEntries.length} spec references`);

// Run ethspecify on the temporary file
try {
  console.log('Running ethspecify...');
  // Make sure the virtual environment is activated if needed
  const ethspecifyCommand = `source ethspecify_env/bin/activate && ethspecify process --path "${tempDir}"`;
  const stdout = execSync(ethspecifyCommand, { stdio: 'inherit' });

  // Read the updated HTML file to extract updated spec tags
  const updatedHtml = fs.readFileSync(tempHtmlPath, 'utf8');

  // Extract updated spec tags using regex
  const updatedTags = [];
  const tagRegex = /<spec[^>]*>/g;
  let tagMatch;

  while ((tagMatch = tagRegex.exec(updatedHtml)) !== null) {
    updatedTags.push(tagMatch[0]);
  }

  console.log('\nUpdated spec tags:');
  updatedTags.forEach(tag => {
    console.log(tag);
  });

  // Generate a report of changes
  console.log('\nSpec Reference Report:');
  console.log('======================');
  console.log(`Total references: ${specRefEntries.length}`);
  console.log(`Updated tags: ${updatedTags.length}`);

  // @SPEC Tag Validation
  console.log('\n@SPEC Tag Validation:');
  console.log('=====================');
  if (missingSpecTags.length === 0) {
    console.log('All components have @SPEC tags');
  } else {
    console.log(`Missing @SPEC tags for ${missingSpecTags.length} components`);
  }


} catch (error) {
  console.error(`Error running ethspecify: ${error}`);
} finally {
  // Clean up
  fs.unlinkSync(tempHtmlPath);
  fs.rmdirSync(tempDir);
  console.log('Cleaned up temporary files');
}