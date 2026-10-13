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

<CameraCapture onCapture={({ blob, width, height, mimeType, source }) => upload(blob)} />
```

Props: `onCapture`, `onError?`, `facingMode?` (`'environment'` default), `allowUpload?` (default `true`), `className?`.
React is a peer dependency.

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
