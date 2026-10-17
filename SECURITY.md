# Security Policy

## Supported Versions

Only the latest version of this repository receives security updates.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it **privately** and responsibly:

- Open a private Security Advisory: https://github.com/huanweide/novel-smith/security/advisories/new
- Or contact the maintainer directly.

Please **do not** open a public issue for security vulnerabilities until a fix has been released.

---

## Access control for self-hosted deployments

This app is **local-first with zero authentication by design** — no accounts, no passwords. The
database lives on your own machine and the AI keys are read from your own environment.

The trade-off is that the protection layer must be configured correctly if you ever expose it
beyond `localhost`. There is a network-level guard in front of every `/api/*` route
(`src/lib/net-guard.ts`), but it is **an IP allow-list, not authentication** — it protects against
accidentally exposing the app to a LAN or the public internet; it does not protect against other
people on the same network.

### Know what the server binds to

```bash
npm run dev          # binds to ALL interfaces by default (0.0.0.0)
npm run start        # binds to ALL interfaces by default (0.0.0.0)
```

**Next.js binds every interface unless told otherwise** — `npm run dev` is reachable from
anything that can route to your machine, including everyone on the same Wi-Fi. The access guard
lets LAN addresses through on purpose (so you can open the app on your phone at `192.168.x.x`),
which means "it is on my own network" is **not** the same as "it is private".

If you only ever use it from the same machine, bind to loopback explicitly:

```bash
# Windows (PowerShell)
$env:HOSTNAME="127.0.0.1"; npm run dev
# macOS / Linux
HOSTNAME=127.0.0.1 npm run dev
```

For remote access, prefer a tunnel that only forwards to `127.0.0.1` (for example Cloudflare
Tunnel) over binding to all interfaces.

### Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `TRUSTED_PROXY_MODE` | `trust-proxy-header` | Which source is trusted for the client IP. See below. |
| `ALLOW_UNKNOWN_SOURCE` | `false` | Set to `true` only as a temporary escape hatch when the address cannot be determined. |
| `ALLOW_PUBLIC` | `false` | Allow requests that are definitively **not** from localhost/LAN. |
| `ALLOW_PUBLIC_TOKEN` | *(unset)* | Optional hardening. When set together with `ALLOW_PUBLIC=true`, every request must carry a matching token or it is blocked. **Without it, `ALLOW_PUBLIC=true` alone opens access** (legacy behaviour, kept for backwards compatibility) — so set both, and treat the token as mandatory in practice. |

### Choosing `TRUSTED_PROXY_MODE`

Request headers such as `X-Forwarded-For` are written by the client and are therefore trivially
forged. Pick the mode that matches how traffic actually reaches the app:

- `trust-proxy-header` — there is a reverse proxy in front that is trusted to sanitize headers.
  **This is the default for backwards compatibility.** Without a genuine proxy in front, a forged
  header can still pass the guard.
- `trust-cf-only` — **recommended for public exposure.** Only `CF-Connecting-IP` is trusted; that
  header is written by Cloudflare's edge and overrides any client-supplied value.
- `direct` — no proxy at all; only the TCP peer address is used. If the framework does not expose
  that address, requests are treated as an unknown source and blocked.

If you run `trust-cf-only` and an attacker can still reach the port directly, a forged
`CF-Connecting-IP` will be trusted — the code cannot distinguish that case. Keep the process bound
to `127.0.0.1` and let the tunnel be the only entry point.

Unknown sources are **blocked by default**. "Allow when the IP cannot be determined" means "run
unprotected when the IP cannot be determined".
