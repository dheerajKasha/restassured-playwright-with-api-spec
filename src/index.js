#!/usr/bin/env node

const path = require("path");
const { loadSpec, collectOperations } = require("./openapi");
const { buildTestCases } = require("./test-cases");
const { writeOutputs } = require("./writers");

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") {
      args.input = argv[index + 1];
      index += 1;
    } else if (token === "--output") {
      args.output = argv[index + 1];
      index += 1;
    }
  }

  if (!args.input) {
    throw new Error("Missing required --input argument.");
  }

  args.output = args.output || "generated";
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(process.cwd(), args.input);
  const outputPath = path.resolve(process.cwd(), args.output);
  const spec = loadSpec(inputPath);
  const operations = collectOperations(spec);
  const cases = operations.flatMap((operation) => buildTestCases(operation, spec));

  writeOutputs({
    operations,
    cases,
    outputPath,
    specTitle: spec.info && spec.info.title ? spec.info.title : "Generated API"
  });

  console.log(`Generated ${cases.length} test cases across ${operations.length} operations into ${outputPath}`);
  console.log(`Runnable scaffolds:`);
  console.log(`- ${path.join(outputPath, "restassured-project")}`);
  console.log(`- ${path.join(outputPath, "playwright-project")}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
