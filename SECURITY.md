# Security policy

MD Reader is a local desktop application, but Markdown files are untrusted input. The renderer must continue to escape raw HTML, allow-list external URL schemes and avoid turning document content into commands or arbitrary filesystem operations.

Please report security issues privately through a GitHub Security Advisory once the repository is published. Do not open a public issue for an unpatched vulnerability.

Reports involving XSS, path traversal, arbitrary file access, command execution, unsafe URL handling or bypasses of the file-extension checks are especially important. Include the affected version, operating system, reproduction steps and a minimal safe test document when possible.
