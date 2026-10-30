# Aula Insights

A free local tool for Danish parents who want to understand how often their children have substitute teachers. Connect to Aula and see lesson counts, substitute percentages, subject breakdowns, monthly trends, and substitute streaks.

This independent project is not an official Aula service. It uses unofficial internal APIs, which can change. There is no subscription, payment flow, analytics, or external AI integration. The source is available under GPL-3.0-only; see [License and attribution](#license-and-attribution).

## Run on your computer

Install [Node.js 24 LTS](https://nodejs.org/en/download) with npm. Download this repository using **Code → Download ZIP**, extract it, and open a terminal in the directory containing `package.json`. Alternatively, clone it with Git:

~~~sh
git clone https://github.com/skjoldan/aula_vikar.git
cd aula_vikar
~~~

~~~sh
npm ci
npm start
~~~

Open **http://localhost:3000**. Stop the server with **Ctrl+C**.

The server binds to `127.0.0.1` by default. No environment variables or `.env` file are required for direct Node execution. To choose a different port in PowerShell:

~~~powershell
$env:PORT = '3001'
npm start
~~~

Then open http://localhost:3001. `HOST` can override the listening address, but this app is intended for personal local use. Do not expose it as a public web service. Earlier project notes report Aula requests being blocked from cloud/datacenter IPs; remote hosting compatibility is unverified.

## Connect to Aula

You need a parent/guardian Aula account, access to its MitID or UniLogin sign-in, and an internet connection.

1. Choose **MitID** or **UniLogin**, then click **Open Aula Login**.
2. Sign in through Aula in the new tab. If no tab opens, check your browser's popup blocker.
3. After sign-in, Aula may show a page with a **Fortsæt login** button. Leave it open and copy the complete address from that tab. You do not need to click the button.
4. Return to this app, paste the address, and click **Complete Login**. The final `app-redirect.aula.dk` address with its encoded `returnUri` works, as does the earlier `app-private.aula.dk` address containing `code` and `state`. Base64 callbacks and nested `redirectTo` wrappers are also accepted.
5. Click **Sync now** to request the last six months of lessons available from Aula.
6. Select one child or **All children**.

The manual paste step is part of the current login flow. Keep callback URLs private. The final page stores `code` and `state` inside `returnUri`, so you do not need to catch the earlier three-second redirect. If the address has neither callback values nor an encoded wrapper, start a new login. Pending logins are cleaned up after roughly ten minutes. A completion attempt consumes its pending state even when it fails; a reload during login also requires starting again.

## Understanding the dashboard

- **Detection:** substitutes are identified by the `substituteTeacher` participant role, explicit substitute event flags, or `vikar`/`substitute` in the title. Teachers are not compared with a historical baseline. Results reflect the recorded schedule and detection rules, not independently verified attendance.
- **Selection:** explicitly non-lesson events are excluded; events with no type can be included. Invalid/missing dates, datetime values without a timezone, and durations of zero or less are skipped.
- **Attribution:** shared events count once per matching child. Unknown profiles are skipped; events with no identifiers are accepted only when there is one child. Repeated copies of the same event for the same child/date/start time are deduplicated.
- **Times:** converted to `Europe/Copenhagen`, including daylight saving time.
- **Percentages:** substitute lessons divided by included lessons, rounded to one decimal place. They measure lessons, not teaching minutes.
- **Streaks:** consecutive substitute lessons in chronological order. Gaps and weekends do not break a streak; an ordinary lesson does. **All children** combines their lesson streams and counts shared lessons once per child.

Sync is manual and replaces the session's lesson collection. There is no scheduled sync, persistent history, CSV export, or daily lesson table. Available history depends on Aula's response.

## Privacy and sessions

Sign-in happens through Aula. This app does not ask for or store your MitID/UniLogin password. Its server calls Aula directly and holds tokens, cookies, child details, and lessons in memory. The browser keeps its app session token in `sessionStorage` and displays fetched information in the page. There is no application database.

Reloading can restore a valid session. Restarting the server loses all sessions and lessons. Sessions expire with the token lifetime returned by Aula, with a one-hour fallback; automatic refresh is not implemented.

**Log out** immediately clears the child selector, dashboard, and browser token. The server session is deleted if its logout request succeeds; otherwise it can remain until expiry or restart. Logging out here does not sign you out of Aula in another tab.

The current source files and source ZIP exclude the old database. Repository branches were reset to a clean initial release during history cleanup. Older clones, forks, or GitHub cached/pull-request references may still retain removed history; do not merge old branches back into this repository. Never attach credentials, tokens, callback URLs, or unredacted school schedules to issues. Dependencies, local settings, verification artifacts, and environment files are excluded from new commits; `.env.example` contains defaults only.

## Docker

Install Docker with Compose, then create its required environment file.

PowerShell:

~~~powershell
Copy-Item .env.example .env
~~~

Linux/macOS:

~~~sh
cp .env.example .env
~~~

Start the Node 24 container:

~~~sh
docker compose up --build -d
~~~

Open http://localhost:3000. Compose publishes the port on `127.0.0.1` only. The server listens on `0.0.0.0` inside the container to allow that forwarding.

~~~sh
docker compose logs --tail=100 app
docker compose down
~~~

Changing the container's `PORT` also requires updating its port mapping. Restarts lose sessions and lessons. See [RELEASE.md](RELEASE.md) for operation and verification details.

## Troubleshooting

| Problem | Action |
| --- | --- |
| Port already in use | Stop the other app or set another `PORT`. |
| No login tab | Check popup blocking and start a new login. |
| Invalid callback or missing code/state | Start a fresh login and copy the full address, including the `returnUri` parameter, from the Fortsæt login page. |
| Invalid/expired session | Sign in and sync again; this is expected after a server restart. |
| Aula error during sync | Retry with a fresh login locally. If it persists, report a redacted error; API changes may require a code update. |
| Empty dashboard | Complete login, sync, and check the selected child. Aula may have returned no usable lessons. |
| Compose cannot find `.env` | Copy `.env.example` to `.env` first. |

## Development and validation

The app uses Node.js ES modules, Express 4, and vanilla browser JavaScript/CSS. There is no bundler, frontend framework, database, linter, or type checker.

| Path | Purpose |
| --- | --- |
| `server.js` | Routes and local session authentication |
| `src/oidc.js` | PKCE, login URL, callback parsing, token exchange |
| `src/aula_api.js` | API discovery, cookies/CSRF, profiles, calendar extraction |
| `src/store.js` | In-memory pending logins and sessions |
| `src/metrics.js` | Normalization and statistics |
| `public/` | Browser UI and styling |
| `tests/` | Node regression tests |

~~~sh
npm test
npm audit
~~~

Fresh npm installation, all fourteen regression tests, and HTTP smoke checks pass. The Node 24 Docker image builds, runs, and passes the same tests. The updated lockfile currently has zero npm audit findings; this is not a security guarantee, and findings can change. Browser-state tests use a small DOM adapter, not a real browser.

On 28 October 2026, the maintainer confirmed that login, lesson sync, switching children, reload, and logout worked with their real Aula account after the callback fix. This is a user-reported end-to-end check for one account, not independent verification across schools, browsers, or both sign-in methods. Automated browser inspection was unavailable during release preparation. Repeat the manual check after authentication/API changes; these results do not establish completeness of Aula data.

When reporting bugs, include OS, Node version, reproduction steps, and redacted errors. Use fictional data in fixtures and screenshots.

## License and attribution

Copyright (c) 2026 Jonas Skjoldan Eskildsen and contributors, for the original Aula Insights contributions. This project is licensed under **GNU GPL version 3 only** (`GPL-3.0-only`). See [LICENSE](LICENSE) for the complete terms. The program is provided without warranty.

Earlier development used the [scaarup/aula](https://github.com/scaarup/aula) integration under GPL-3.0. Upstream attribution and the integration's development provenance are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The old Python package and private data are not included in this copy. Installed dependencies retain their own licenses and notices.
