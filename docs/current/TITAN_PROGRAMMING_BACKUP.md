# Titan programming backup — 2026-08-23

Titan's current reconstruction programming was backed up to the existing private Google Drive **Athere Mesh** folder on 2026-08-23.

## Verified backup

- Folder: [Titan Programming Backup 2026-08-23](https://drive.google.com/drive/folders/1tndsSXC2BjZVcsF5GLZi-oKdUzaUV45_)
- Archive: [Titan-Programming-2026-08-23.tgz](https://drive.google.com/file/d/17u1FlBl7AzVJCektSo586HpJGJvz0KPF/view?usp=drivesdk)
- Size: `757809` bytes
- SHA-256: `7161c4f58ceeeb2b532fb472b61f09425fbac16c2a7e059f752bfa9129f41645`
- Source revision: GitHub commit `8e75ca7` on `master`
- Drive visibility at verification: private, owner-only
- Automated verification before packaging: `57/57` tests passed
- Dependency audit before packaging: no known vulnerabilities
- Credential-pattern scan before upload: clean
- Drive metadata readback: file name, MIME type, size, parent folder, ownership, and private visibility matched the intended upload

## Included

- `package.json` and pinned `pnpm-lock.yaml`
- Titan source packages
- Contract, integration, and performance tests
- Runtime and deployment scripts
- Athere Mesh Titan documentation
- Existing proof/evidence artifacts
- Exact Ubuntu Ollama loopback-hardening script

The archive intentionally excludes this manifest file so its SHA-256 does not depend on a file that contains that same SHA-256. The manifest remains preserved in GitHub and as the separate private Drive backup record.

## Excluded

- `.env` files and credentials
- `node_modules`
- Git internals

## Status boundary

This record proves that the programming backup exists and was verified. It does **not** claim that Titan as a whole is complete or that Ubuntu Ollama loopback hardening has been applied. At backup time, Titan's live agent path was operational, while the privileged Ollama bind change remained pending.
