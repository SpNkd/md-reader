# Release checklist

MD Reader uses semantic versions shared by `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.

1. Update the version in all three files and run `npm install` so lockfiles stay consistent.
2. Run the local checks:

   ```bash
   npm run check
   npm run build
   cargo check --manifest-path src-tauri/Cargo.toml
   npm run tauri build -- --no-bundle
   ```

3. Commit the version change on `main`.
4. Create and push a version tag:

   ```bash
   git tag v0.1.0
   git push origin main
   git push origin v0.1.0
   ```

5. GitHub Actions runs `.github/workflows/release.yml`, builds all platform bundles, waits for the matrix, creates the GitHub Release and uploads the installers.

## macOS signing and notarization

The release workflow already passes the standard Tauri signing variables to macOS builds. To remove Gatekeeper warnings, add these repository Actions secrets before creating the next release:

- `APPLE_CERTIFICATE`: base64-encoded `.p12` Developer ID Application certificate.
- `APPLE_CERTIFICATE_PASSWORD`: password for that certificate.
- `KEYCHAIN_PASSWORD`: password used by the temporary CI keychain.
- `APPLE_SIGNING_IDENTITY`: the full `Developer ID Application: ...` identity.
- `APPLE_ID`: Apple ID used for notarization.
- `APPLE_PASSWORD`: an app-specific Apple ID password.
- `APPLE_TEAM_ID`: Apple Developer team ID.

Do not commit signing certificates, private keys, notarization credentials or other secrets. After adding the secrets, create and push a new semantic-version tag; the macOS jobs will sign and notarize the bundles automatically.
