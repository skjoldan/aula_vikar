# Aula Insights (MVP)

This is a minimal MVP implementation based on the PRD. It includes:

- MitID login (via sidecar)
- Aula account connection
- 6-month sync into a file-backed store
- Dashboard metrics for substitute lessons

## Run

```bash
npm install
npm run start
```

Set an encryption key for stored Aula credentials:

```bash
set AULA_ENC_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

Open `http://localhost:3000`.

## Docker (app + sidecar, host nginx)

Create a `.env` with your secrets:

```
AULA_ENC_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
AULA_AUTH_METHOD=APP
```

Then run:

```bash
docker compose -f docker-compose.yml -f docker-compose.host-nginx.yml up --build
```

This exposes:
- `http://localhost:3000` (Node app for host nginx proxy)

## Run the Python sidecar (real Aula data)

The Node app calls a Python sidecar that wraps the `scaarup/aula` client.

```bash
cd sidecar
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
set AULA_SIDECAR_PORT=5042
python app.py
```

Then set in the main app:

```bash
set AULA_SIDECAR_URL=http://localhost:5042
set AULA_AUTH_METHOD=APP
```

When you connect Aula, the UI will show the MitID QR/OTP status and you must approve in the MitID app before syncing.

If you want to use the stub (no real Aula calls):

```bash
set AULA_USE_STUB=1
```
