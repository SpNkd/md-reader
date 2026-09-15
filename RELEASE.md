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

Do not commit signing certificates, private keys, notarization credentials or other secrets. Signing can be added later through GitHub Actions secrets.
