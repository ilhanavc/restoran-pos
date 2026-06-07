# Code Signing Runbook

## Current state
Binaries are **unsigned**. Users see a SmartScreen warning on install ("Windows protected your PC"). This is safe to bypass but creates friction for end customers.

## Certificate types
| Type | SmartScreen | Cost | Recommendation |
|---|---|---|---|
| EV Code Signing (HSM) | Cleared immediately | ~$300–500/yr | Best for production |
| OV Code Signing | Clears after ~500 installs | ~$100–200/yr | OK for limited rollout |
| Self-signed | Never cleared | Free | Dev/internal only |

Recommended provider: DigiCert, Sectigo, or GlobalSign.

## How to enable signing in this project

### Step 1 — Obtain a PFX certificate
After purchasing and activating the certificate, export it as a `.pfx` file with a password. Store it securely (not in git).

### Step 2 — Set environment variables before building
```bat
set CSC_LINK=C:\path\to\certificate.pfx
set CSC_KEY_PASSWORD=your-pfx-password
```

Or in a `.env.signing` file (never commit):
```
CSC_LINK=C:\certs\pos-cert.pfx
CSC_KEY_PASSWORD=...
```

### Step 3 — Update `package.json` build config
In the `"win"` section, remove or set to `true`:
```json
"signAndEditExecutable": true,
"signDlls": false
```
(DLL signing is optional; executable signing is required for SmartScreen.)

### Step 4 — Remove `CSC_IDENTITY_AUTO_DISCOVERY=false` from dist scripts
In `package.json` scripts, remove `CSC_IDENTITY_AUTO_DISCOVERY=false` from:
- `dist`
- `dist:prepare`
- `dist:nsis`
- `dist:portable`

### Step 5 — Build and verify
```bat
npm run dist:win
```
After build, verify signature:
```bat
sigcheck.exe -a dist-electron\restoran-pos-setup.exe
```
Or right-click → Properties → Digital Signatures tab in Windows Explorer.

### Step 6 — Add `latest.yml` to GitHub Releases
electron-updater requires `latest.yml` alongside the installer in the GitHub Release. Ensure `dist:nsis` output includes it and upload both files when creating a release.

## EV Certificate + Hardware Token (HSM)
EV certificates require a hardware security module (USB token). The signing process uses:
```bat
set CSC_LINK=<token-slot-or-pfx-exported-from-hsm>
```
Some providers offer cloud HSM (DigiCert KeyLocker) — no physical token needed.

## Troubleshooting
- `CSC_IDENTITY_AUTO_DISCOVERY=false` — disables cert auto-discovery; remove this for signing
- `signAndEditExecutable: false` — must be removed/set true for signing
- SmartScreen still showing after signing → wait for reputation to build (OV), or use EV cert
- Timestamp server: electron-builder uses RFC 3161 timestamping automatically
