const fs = require("fs");
const path = require("path");
const { loadSpec, parseSpecContent, collectOperations } = require("./openapi");
const { buildTestCases } = require("./test-cases");
const { writeOutputs } = require("./writers");

function buildArtifacts(spec, outputPath) {
  const operations = collectOperations(spec);
  const cases = operations.flatMap((operation) => buildTestCases(operation, spec));
  const specTitle = spec.info && spec.info.title ? spec.info.title : "Generated API";
  const outputs = writeOutputs({ operations, cases, outputPath, specTitle });

  return {
    specTitle,
    operations,
    cases,
    outputs
  };
}

function generateFromFile(inputPath, outputPath) {
  const spec = loadSpec(inputPath);
  return buildArtifacts(spec, outputPath);
}

function generateFromText(specText, fileType, outputPath) {
  const extension = fileType === "json" ? ".json" : ".yaml";
  const spec = parseSpecContent(specText, extension);
  return buildArtifacts(spec, outputPath);
}

function readOutputFiles(outputs) {
  return {
    restAssured: fs.readFileSync(outputs.restAssuredFile, "utf8"),
    playwright: fs.readFileSync(outputs.playwrightFile, "utf8")
  };
}

module.exports = {
  generateFromFile,
  generateFromText,
  readOutputFiles
};
