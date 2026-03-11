# AI Test Case Generator for APIs

This repo contains a small generator that reads an OpenAPI / Swagger file and produces:

- REST Assured test stubs
- Playwright API test stubs
- happy-path, negative, and edge-oriented scenarios

## Quick start

1. Install dependencies:

```powershell
npm.cmd install
```

2. Generate tests from the sample spec:

```powershell
npm.cmd run generate
```

3. Generated files will be written to:

- `generated/restassured/GeneratedApiTest.java`
- `generated/playwright/generated-api.spec.js`

## Run against your own spec

```powershell
node src/index.js --input path\to\openapi.yaml --output generated
```

## Notes

- YAML and JSON specs are supported.
- The generator is intentionally heuristic-based for the MVP.
- Generated tests assume base URL / authentication will be configured in your framework setup.
