const fs = require("fs");
const { loadSpec, parseSpecContent, collectOperations } = require("./openapi");
const { buildTestCases } = require("./test-cases");
const { generateLlmCases } = require("./llm-generator");
const { writeOutputs } = require("./writers");

function mergeCases(heuristicCases, llmCases) {
  return [...heuristicCases, ...llmCases];
}

async function buildArtifacts(spec, outputPath, options = {}) {
  const operations = collectOperations(spec);
  const heuristicCases = operations.flatMap((operation) => buildTestCases(operation, spec));
  const llm = await generateLlmCases({
    spec,
    operations,
    heuristicCases,
    useLlm: Boolean(options.useLlm)
  });
  const cases = mergeCases(heuristicCases, llm.cases);
  const specTitle = spec.info && spec.info.title ? spec.info.title : "Generated API";
  const outputs = writeOutputs({ operations, cases, outputPath, specTitle });

  return {
    specTitle,
    operations,
    cases,
    outputs,
    llm
  };
}

async function generateFromFile(inputPath, outputPath, options) {
  const spec = loadSpec(inputPath);
  return buildArtifacts(spec, outputPath, options);
}

async function generateFromText(specText, fileType, outputPath, options) {
  const extension = fileType === "json" ? ".json" : ".yaml";
  const spec = parseSpecContent(specText, extension);
  return buildArtifacts(spec, outputPath, options);
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
