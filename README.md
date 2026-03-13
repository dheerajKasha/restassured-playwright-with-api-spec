# AI Test Case Generator for APIs

<img width="1337" height="947" alt="image" src="https://github.com/user-attachments/assets/634a4c51-cd75-4626-9980-a934d6cb4656" />

This project turns an OpenAPI or Swagger spec into executable API test assets.

It currently supports:

- REST Assured test generation
- Playwright API test generation
- runnable Maven and Playwright scaffold projects
- a local browser UI and HTTP API for interactive generation
- heuristic negative and edge-case generation
- optional OpenAI-powered case enrichment
- YAML and JSON editor memory in the UI
- auto-expanding editor behavior before scrollbars appear
- line-aware validation errors for pasted YAML and JSON

## What the app does

Given an OpenAPI spec, the app can generate:

- raw REST Assured test files
- raw Playwright API test files
- a runnable Maven project for REST Assured
- a runnable Playwright project
- happy-path cases
- negative cases
- edge-oriented cases
- optional extra LLM-suggested cases

## Local setup

Install dependencies:

```powershell
npm.cmd install
```

## Run the browser UI

Start the local UI server:

```powershell
npm.cmd run ui
```

Open:

```text
http://127.0.0.1:3001
```

### UI features

The browser app includes:

- a YAML/JSON format switcher with separate editor state per format
- an editor that grows to use available space before internal scrolling begins
- inline validation feedback for invalid YAML or JSON
- validation messages with exact line and column references
- a toggle for optional LLM-based enrichment
- generated REST Assured and Playwright output previews
- generated scaffold output paths

## Run the CLI generator

Generate from the sample spec:

```powershell
npm.cmd run generate
```

Generate from your own spec:

```powershell
node src/index.js --input path\to\openapi.yaml --output generated
```

Generate with optional LLM enrichment:

```powershell
$env:OPENAI_API_KEY="your-key"
$env:OPENAI_MODEL="gpt-5"
node src/index.js --input path\to\openapi.yaml --output generated --llm
```

## Generated output

A run writes these outputs:

- `generated/restassured/GeneratedApiTest.java`
- `generated/playwright/generated-api.spec.js`
- `generated/restassured-project/`
- `generated/playwright-project/`

The browser UI stores preview runs under:

- `.tmp/ui-runs/`

## Run the generated scaffold projects

### REST Assured Maven project

```powershell
cd generated/restassured-project
$env:BASE_URL="https://api.example.com"
mvn test
```

You can also override the base URL with:

```powershell
mvn test -DbaseUrl=https://api.example.com
```

### Playwright API project

```powershell
cd generated/playwright-project
npm install
$env:BASE_URL="https://api.example.com"
npm test
```

## Validation behavior

When invalid YAML or JSON is pasted into the UI, the app now:

- blocks generation
- validates the pasted content on the server
- returns structured validation errors
- shows the exact line and column when parsing fails
- surfaces missing top-level OpenAPI fields such as `openapi`/`swagger` and `paths`

## LLM mode

If `OPENAI_API_KEY` is set, the app can ask an OpenAI model for additional high-value negative and edge scenarios.

If no API key is set, the app falls back to heuristic-only generation automatically.

## Notes

- Supported input formats: YAML and JSON
- The local UI is served by `src/api-server.js`
- The CLI entry point is `src/index.js`
- Current dependencies include `js-yaml` and `openai`
