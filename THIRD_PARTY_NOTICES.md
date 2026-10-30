# Third-party notices and provenance

## Aula integration

Earlier versions of Aula Insights vendored and used the Aula integration maintained at https://github.com/scaarup/aula, including its Aula login client and calendar handling. Credit belongs to scaarup and the upstream contributors for that work. The upstream repository was distributed under the GNU General Public License, version 3; its full GPL v3 license text is retained in this project's LICENSE.

The current JavaScript integration follows protocol and calendar conventions used during that development, including Aula profile/institution identifiers, calendar endpoints, participant roles, CSRF cookies, and OIDC client configuration. Removing the old Python package does not erase that development provenance. This project is distributed under GPL-3.0-only rather than asserting a permissive relicensing of that work. Upstream authors retain their rights in their contributions.

The release candidate replaces the Python sidecar with Node.js OIDC/API calls and an in-memory store. Later changes include attribution for shared child profiles, Copenhagen date/time conversion, invalid-date handling, logout/session response guards, updated dependencies, Node 24 Docker packaging, and local-only host bindings.

The old Python vendor package, Home Assistant integration, its fixtures, and historical private data are not included in this source distribution. The source references above are attribution, not an endorsement by upstream or by Aula.

## npm dependencies

Express and its transitive dependencies are installed from package-lock.json using npm. They remain under their respective licenses. Their copyright and license files are retained in the installed packages and in the Docker image's node_modules directory. The project GPL notice does not replace those dependency notices.

## Project contributions

Copyright (c) 2026 Jonas Skjoldan Eskildsen and contributors for original Aula Insights contributions. See LICENSE for GPL-3.0-only distribution terms and the warranty disclaimer.
