# recruit-updates

Update and download endpoint for [Jobbox](../). The app's repository is private, so the
desktop client cannot read its GitHub releases directly — that would mean shipping a
GitHub token inside the app bundle. This service holds the token server-side and
re-publishes release assets over public URLs.

It stores nothing. Binary downloads are answered with a 302 to GitHub's short-lived signed
URL, so release bytes never pass through this process.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /healthz` | Liveness check |
| `GET /api/latest` | Version, notes, and asset list — backs the download landing page and the in-app update check |
| `GET /download/latest?arch=arm64\|x64` | Permanent download link; 302s to the current DMG |
| `GET /updates/darwin/latest-mac.yml` | electron-updater feed manifest |
| `GET /updates/darwin/{file}` | Release asset by name |

## Configuration

| Variable | Required | Notes |
|---|---|---|
| `GITHUB_TOKEN` | yes | Fine-grained token, read-only Contents scope on the Jobbox repo |
| `GITHUB_REPO` | yes | `owner/name` |
| `PUBLIC_BASE_URL` | no | Absolute base used when building asset URLs; inferred from the request otherwise |
| `PORT` | no | Defaults to 8080 |

## Deploy

```bash
fly launch --no-deploy          # first time only
fly secrets set GITHUB_TOKEN=github_pat_...
fly deploy
```

## Run locally

```bash
GITHUB_REPO=owner/recruit GITHUB_TOKEN=github_pat_... go run .
curl localhost:8080/api/latest | jq
```
