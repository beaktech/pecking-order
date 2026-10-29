# Security policy

## Report a vulnerability privately

Email **hello@beaktech.org**, with “Pecking Order security” in the subject. Include the affected version or commit, operating system, Node/FFmpeg versions, expected impact and minimal reproduction steps using synthetic data. Do not include live secrets, private recordings or precise station coordinates.

Please avoid publishing exploit details in a public issue while a fix is being prepared. If a credential has been exposed, revoke or rotate it with its provider; deleting a file or commit does not invalidate the credential.

## Supported versions and boundaries

Pecking Order is currently a pre-release project. Security fixes target the latest source revision and, once available, the latest published release. Separate maintenance of older releases is not promised.

The application binds to loopback and is intended for a single user on one computer. Keep it behind that boundary: public hosting, reverse proxies and remote multi-user access are not supported. Browser requests are checked against the local Host and Origin, request bodies are limited, and source databases are opened read-only. These controls do not protect against another untrusted program already running as your operating-system user.

Use a currently maintained Node.js LTS release with its latest security updates, and a maintained FFmpeg build from your operating system or a trusted distributor. Node 22.13 is a compatibility minimum, not a recommended patch level. There are no npm runtime or development dependencies; Node, its bundled SQLite, FFmpeg and GitHub Actions still require maintenance.

Saved state and exports contain recording metadata and may contain precise coordinates and original file paths. Review them before sharing. Use one running Pecking Order process per review folder; multiple browser tabs on that process are supported, but an exclusive workspace lock prevents separate processes from using the same review folder. Locks owned by a stopped process on this computer are recovered automatically; unverifiable owners require manual recovery after confirming the folder is not in use. Use separate review folders for separate processes or stations.
