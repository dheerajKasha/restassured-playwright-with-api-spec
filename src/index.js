#!/usr/bin/env node

const path = require("path");
const { generateFromFile } = require("./generate");

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
    } else if (token === "--llm") {
      args.useLlm = true;
    }
  }

  if (!args.input) {
    throw new Error("Missing required --input argument.");
  }

  args.output = args.output || "generated";
  args.useLlm = Boolean(args.useLlm);
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(process.cwd(), args.input);
  const outputPath = path.resolve(process.cwd(), args.output);
  const result = await generateFromFile(inputPath, outputPath, { useLlm: args.useLlm });

  console.log(`Generated ${result.cases.length} test cases across ${result.operations.length} operations into ${outputPath}`);
  console.log(`Runnable scaffolds:`);
  console.log(`- ${result.outputs.restAssuredProjectDir}`);
  console.log(`- ${result.outputs.playwrightProjectDir}`);
  console.log(`LLM mode: ${result.llm.reason}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
