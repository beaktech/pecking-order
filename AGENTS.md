# Agent instructions

Read [README.md](README.md) for supported sources and setup. During release preparation, follow the local `PLAN.md` when present and stop at its phase review boundaries. Local planning notes are not part of the public source distribution.

- Work only in this repository. Leave other repositories and user archives untouched.
- Keep the application dependency-free using Node's standard library. Ask before adding dependencies or runtime prerequisites.
- Open source databases read-only. Never modify original recordings or upload to Xeno-canto.
- Test with temporary synthetic databases and generated audio; never use a real station archive.
- Use British spelling in messages and documentation.
- Run the tests relevant to each change (`npm test` runs the full suite).
- Preserve user changes. Do not rewrite Git history or publish without explicit authorisation.
