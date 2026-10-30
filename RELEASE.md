# Local operation guide

This guide describes the current single-container Node.js implementation. The previous cloud deployment, Python sidecar, encryption-key, and persistent-storage instructions are obsolete.

## Direct Node.js

Use Node.js 24 LTS and npm:

```sh
npm ci
npm test
npm start
```

Open http://localhost:3000. To use a different port in PowerShell:

```powershell
$env:PORT = '3001'
npm start
```

No `.env` is loaded by direct Node execution. The default bind address is 127.0.0.1; HOST can override it.

## Docker Compose

From the repository root, create `.env`:

```powershell
Copy-Item .env.example .env
```

Linux/macOS equivalent: `cp .env.example .env`.

```sh
docker compose up --build -d
docker compose logs --tail=100 app
```

Open http://localhost:3000. Compose runs only `app`, with no database or sidecar. The image uses Node 24 and HOST=0.0.0.0 inside the container; Compose forwards 127.0.0.1:3000 on the host. If changing the container's PORT, also update the port mapping. Do not expose this personal app as a public web service.

## Updating and stopping

After updating the source:

```sh
npm test
docker compose up --build -d
```

To stop:

```sh
docker compose down
```

Rebuilds, restarts, and container replacement lose all sessions and synced lessons. Sign in and sync again afterward. There is no active persistent database or historical backup workflow. The current source tree and source ZIP exclude legacy data. Repository branches were reset to a clean initial release; old clones, forks and GitHub caches/pull-request references may still retain earlier history. Re-clone after the rewrite and do not merge old history back in. GitHub Support is required to purge retained server-side references and cached sensitive data.

## Verification

On 28 October 2026, the maintainer reported successful login, sync, child selection, reload, and logout with their real Aula account after the callback fix. This confirms that account's manual flow; broader browser, school, and sign-in-method coverage remains unverified.

Check that the page loads, both login options are available, and signed-out requests fail safely. With a real account, complete Aula login, sync, switch children, reload, and log out. Confirm that logout clears all child and dashboard information.

The app uses a manual callback paste and unofficial Aula endpoints. Live login and API behavior must be checked separately. Cloud/datacenter requests were reported blocked in earlier project notes, so remote hosting is not a verified deployment target.
