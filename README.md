# AI Test Case Generator for APIs

This repo contains a generator that reads an OpenAPI / Swagger file and produces:

- REST Assured test stubs
- Playwright API test stubs
- runnable Maven and Playwright project scaffolds
- a local web/API UI for interactive generation
- heuristic and optional LLM-enhanced edge-case generation

## Quick start

1. Install dependencies:

```powershell
npm.cmd install
```

2. Generate tests and runnable scaffolds from the sample spec:

```powershell
npm.cmd run generate
```

3. Start the local web/API UI:

```powershell
npm.cmd run ui
```

Then open `http://127.0.0.1:3001`.

## Optional LLM mode

If you set `OPENAI_API_KEY`, the generator can ask an OpenAI model for additional high-value negative and edge cases.

```powershell
$env:OPENAI_API_KEY="your-key"
$env:OPENAI_MODEL="gpt-5"
node src/index.js --input examples/user-api.yaml --output generated --llm
```

The UI also includes a `Use LLM enhancements` toggle.

## Output

A generation run writes:

- `generated/restassured/GeneratedApiTest.java`
- `generated/playwright/generated-api.spec.js`
- `generated/restassured-project/`
- `generated/playwright-project/`

The UI writes preview runs into `.tmp/ui-runs/`.

## Run the generated projects

### REST Assured

```powershell
cd generated/restassured-project
$env:BASE_URL="https://api.example.com"
mvn test
```

### Playwright API tests

```powershell
cd generated/playwright-project
npm install
$env:BASE_URL="https://api.example.com"
npm test
```

## Notes

- YAML and JSON specs are supported.
- Without `OPENAI_API_KEY`, the generator falls back to heuristic-only mode.
- Runnable projects use environment-driven base URL configuration.
- The scaffold ships with current REST Assured, JUnit, Playwright, and OpenAI SDK dependency versions as of March 11, 2026.
