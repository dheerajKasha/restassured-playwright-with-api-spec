# AI Test Case Generator for APIs

This repo contains a generator that reads an OpenAPI / Swagger file and produces:

- REST Assured test stubs
- Playwright API test stubs
- runnable Maven and Playwright project scaffolds
- a local web/API UI for interactive generation
- happy-path, negative, and edge-oriented scenarios

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

## Output

A generation run writes:

- `generated/restassured/GeneratedApiTest.java`
- `generated/playwright/generated-api.spec.js`
- `generated/restassured-project/`
- `generated/playwright-project/`

The UI writes preview runs into `.tmp/ui-runs/`.

## Run against your own spec

```powershell
node src/index.js --input path\to\openapi.yaml --output generated
```

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
- The generator is intentionally heuristic-based for the MVP.
- Runnable projects use environment-driven base URL configuration.
- The scaffold ships with current REST Assured, JUnit, and Playwright dependency versions as of March 11, 2026.
