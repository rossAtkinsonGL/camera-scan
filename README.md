# camera-scan

PoC React component that captures a photo of a document from the device camera, or from an uploaded file, and hands the image to the host app.

## Run the demo

```
npm install
npm run dev          # http://localhost:5173 (camera works on localhost)
npm run dev:https    # self-signed HTTPS on the LAN, for testing the camera from a phone
```

## Use as a library

```tsx
import { CameraCapture } from 'camera-scan';
import 'camera-scan/style.css';

<CameraCapture onComplete={(sheets) => sheets.forEach((s) => upload(s.blob, s.qr))} />
```

The user captures one or many sheets, then taps Done. Each result has `blob`, `width`, `height`, `mimeType`, `source`,
`qr` (text of the QR code, if read) and `quality` (advisory client-side checks; the server decides).

Props: `onComplete`, `onError?`, `maxCaptures?` (1 = single capture; default unlimited), `autoCapture?` (default true),
`expectSheet?` (default true), `qualityThresholds?`, `debug?`, `facingMode?`, `allowUpload?`, `className?`.
React is a peer dependency.

## Output: question and answer data

Each result has a `reading` (when the sheet outline and QR code were recognised). `toScorableResponse(result.reading)`
gives the plain data:

```json
{ "assessment": "MATH-U3", "form": "A", "student": "S001",
  "responses": [{ "question": 1, "answer": "B" }, { "question": 2, "answer": null }] }
```

`answer` is `null` for a blank, a double mark or an unclear mark; the fuller `reading` says which, with a confidence.
The reading code lives in `src/mock-backend/` because it stands in for a server step (see the README there).
The demo shows the table and JSON for each scan, and for the mock sheets checks them against the known answers.
Turn it off with `readAnswers={false}`.

## Answer sheet requirements (what the detector relies on)

- Four **L-shaped corner brackets**, one per page corner, all the same size, with the outer corner of each L pointing at
  the page corner (14mm arms, 3mm thick, 10mm in from the edge on the mock sheets). Thin arms blur away at a distance,
  so keep them at least 3mm thick.
- A **QR code** with a quiet zone (white margin).
- The brackets give an accurate page outline but **not the sheet's orientation** (a sheet turned 180 degrees looks the
  same). Orientation has to come from the QR code's position, or from making one bracket different.

Detection copes with the sheet turned by up to about 25 degrees; beyond that an L starts to look like a V.

Mock sheets: `npm run sheets` regenerates `demo/public/sheets/` (PDF, PNG, SVG; one is deliberately broken).
The demo links to them at `/sheets/`. The same sheets with no bubbles filled in are at `/empty-sheets/`, for printing
and marking by hand. Add `?debug` to the demo URL to see live measurements for tuning thresholds.

## Scripts

`npm run build` (library to `dist/`), `npm run build:demo` (demo site to `dist-demo/`), `npm test`, `npm run lint`, `npm run typecheck`.

## Scope

Capture only. Image processing and scoring are expected to be server-side, with the contract to be defined once the host app is known.

## Deploying to GitHub Pages

`.github/workflows/pages.yml` verifies every push and PR, and deploys the demo from `main`.

1. Push this repo to GitHub (public, unless your plan supports private Pages).
2. Repo **Settings > Pages > Source: GitHub Actions**.
3. Push to `main`. The site appears at `https://<owner>.github.io/<repo>/` (HTTPS, so the phone camera works).

The workflow sets `BASE_PATH` to `/<repo>/` automatically. Locally the base is `/`.

## Deploying to Azure (alternative)

The demo app is deployed as an Azure Static Web App (free tier) by `azure-pipelines.yml`.

1. Create the Static Web App (portal: Create a resource > Static Web App):
   - Plan type: **Free**.
   - Deployment source: **Other** (not GitHub), because the pipeline pushes the build.
   - Pick a resource group and region.
2. Open the resource > **Manage deployment token** and copy the token.
3. In Azure DevOps, put the code in a repo, then Pipelines > New pipeline > select the repo > "Existing Azure Pipelines YAML file" > `/azure-pipelines.yml`.
4. Edit the pipeline > Variables > add `SWA_DEPLOYMENT_TOKEN` with the copied token, tick **Keep this value secret**.
5. Run the pipeline. Pushes to `main` build, verify and deploy. PRs build and verify only.

The site is served over HTTPS, so the camera works from a phone at the Static Web App URL.
