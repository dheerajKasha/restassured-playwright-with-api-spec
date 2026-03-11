const OpenAI = require("openai");
const { toPascalCase, makeMethodName } = require("./test-cases");

function stripCodeFence(text) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function buildOperationSummary(operations) {
  return operations.map((operation) => ({
    operationId: operation.operationId,
    method: operation.method,
    path: operation.path,
    parameters: operation.parameters.map((parameter) => ({
      name: parameter.name,
      in: parameter.in,
      required: parameter.required,
      schema: parameter.schema || null
    })),
    requestBody: operation.requestBody ? operation.requestBody.schema : null,
    responses: operation.responses
  }));
}

function buildCaseName(operationId, description, index) {
  const suffix = toPascalCase(description).slice(0, 60) || `LlmCase${index + 1}`;
  return makeMethodName("should", operationId, suffix);
}

function normalizeCase(caseCandidate, index) {
  const request = caseCandidate.request || {};

  return {
    source: "llm",
    operationId: caseCandidate.operationId,
    name: caseCandidate.name || buildCaseName(caseCandidate.operationId, caseCandidate.description || "LLM generated scenario", index),
    description: caseCandidate.description || `LLM-generated scenario ${index + 1}`,
    expectedStatus: Number(caseCandidate.expectedStatus || 400),
    request: {
      pathParams: request.pathParams || {},
      queryParams: request.queryParams || {},
      body: request.body === undefined ? null : request.body
    }
  };
}

function dedupeCases(existingCases, newCases) {
  const seen = new Set(existingCases.map((testCase) => `${testCase.operationId}:${testCase.description}`));
  return newCases.filter((testCase) => {
    const key = `${testCase.operationId}:${testCase.description}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function generateLlmCases({ spec, operations, heuristicCases, useLlm }) {
  if (!useLlm) {
    return { used: false, reason: "disabled", cases: [] };
  }

  if (!process.env.OPENAI_API_KEY) {
    return { used: false, reason: "missing_api_key", cases: [] };
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-5";
  const prompt = {
    specInfo: spec.info || {},
    operations: buildOperationSummary(operations),
    existingCases: heuristicCases.map((testCase) => ({
      operationId: testCase.operationId,
      description: testCase.description,
      expectedStatus: testCase.expectedStatus
    }))
  };

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "You generate high-value API negative and edge test cases from OpenAPI data. Return JSON only with shape {\"testCases\":[...]} and no markdown. Focus on cases not already covered, keep the request payload realistic, and include operationId, description, expectedStatus, and request with pathParams, queryParams, and body. Return at most 8 cases."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(prompt)
          }
        ]
      }
    ]
  });

  const outputText = stripCodeFence(response.output_text || "{}");
  const parsed = JSON.parse(outputText);
  const normalized = Array.isArray(parsed.testCases)
    ? parsed.testCases
        .filter((testCase) => testCase && testCase.operationId)
        .map((testCase, index) => normalizeCase(testCase, index))
    : [];

  return {
    used: true,
    reason: "success",
    cases: dedupeCases(heuristicCases, normalized)
  };
}

module.exports = {
  generateLlmCases
};
