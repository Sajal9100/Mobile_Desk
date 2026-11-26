# Phase 1 report — Temporary test relay

```text
PHASE: 1 — Temporary Test Relay (for the app's M1 risk spike)
STATUS: Blocked — there is no AWS account (owner, 2026-11-26), so no relay exists. The repository
        side is complete and was rehearsed locally against real coturn 4.6.1.
GATE: Not passed — all four gate items need the live relay (evidence log below).
```

## What the owner decided

No AWS account exists yet, so provisioning waits for one. Other hosts (Cloudflare TURN, Metered,
DigitalOcean) were offered and **declined**; the relay will be built from the runbook when an AWS
account exists. Until then the app's spike runs the tests that do not need a relay.

## IMPLEMENTED

- `infra/coturn/turnserver.spike.conf.example`: all 20 directives of the brief, verified identical
  and in the same order by a script. Only the comments changed (see Defects).
- `infra/coturn/SPIKE_RELAY.md`: provision / configure / verify / destroy runbook, corrected by the
  rehearsal.
- `infra/coturn/spike-verify.mjs`: verification client for the live relay (gate item 2 and the
  controls). Needs only Node. UDP and TCP, 21 checks each.
- This report.

## Defects found in the first version of the runbook and template (all fixed)

Each would only have shown up on the real VM. Defects 1 to 3 were reproduced locally first; 4 is a version pin.

1. **A comment on the `user=` line breaks the login.** The brief's example and the first template
   had `user=spike:<password>      # generated on the VM...`. coturn only skips lines that _start_
   with `#`, so the comment became part of the password. Reproduced: the correct password got
   `401`. The comment now has its own line.
2. **An unreadable config turns the relay into an open relay.** The first runbook created
   `/etc/turnserver.conf` as `root:root` with mode 640, but the service runs as `turnserver`.
   Reproduced: coturn **starts anyway, with no authentication and no denied ranges** (an
   unauthenticated Allocate succeeded; the log had 0 `Black listing` lines instead of 8). The file
   is now `root:turnserver` 640 (the same as Ubuntu's own packaged config), checked before start.
3. **The private-range check had no controls and a tool that cannot run it.** `turnutils_uclient`
   leaves its allocations alive after an error exit, and the brief's `user-quota=4` was used up by
   one or two runs (`486 Allocation Quota Reached`), so a battery of checks would fail for the wrong
   reason. Replaced by
   `spike-verify.mjs`: one allocation per transport, all peers checked on it, then released.
4. **Unpinned, deprecated gitleaks command** (`:latest`, `detect`). Now `ghcr.io/gitleaks/gitleaks:v8.30.1 git`,
   run once here: 9 commits, no leaks.

## TESTS (local rehearsal, 2026-11-26)

Setup: Ubuntu 24.04 container + the distribution's `coturn` package (4.6.1), started the way the
runbook starts it (config rendered from the template, `root:turnserver` 640, run as `turnserver`),
a throwaway password that never left the machine, torn down afterwards (containers, network, image).

| Test                                                                       | Result                                                                            |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `spike-verify.mjs` against the template-rendered relay, UDP and TCP        | **42 / 42** pass, exit 0                                                          |
| Three runs back to back (quota is released each time)                      | 42 / 42 each                                                                      |
| Same with `external-ip=<public>/<private>` (the form the EC2 runbook uses) | 42 / 42 (parsing only; the NAT itself is not testable here)                       |
| Server log after the runs contains the password                            | **0** occurrences                                                                 |
| Script output contains the password                                        | **0** occurrences; relay address not printed                                      |
| Negative: inline comment on `user=`                                        | caught: `correct credentials get an allocation` FAIL, error 401, exit 1           |
| Negative: no `denied-peer-ip` lines                                        | caught: private peers granted (`0x108`), CRITICAL FAIL (at least 8 shown), exit 1 |
| Negative: config unreadable by the service user                            | caught: unauthenticated Allocate succeeded, CRITICAL FAIL, exit 1                 |
| Nothing listening / no password supplied / no arguments                    | clean message, address masked, exit 1 / 2 / 2                                     |
| `eslint` on the script                                                     | pass                                                                              |
| Brief's 20 directives vs the template                                      | identical, same order                                                             |

What the 21 checks per transport cover: unauthenticated and wrong-password Allocate refused (`401`),
correct credentials allocate, 13 private/special peers refused with `403` (`0.0.0.0/8`, `10/8`,
`100.64/10`, loopback, `169.254.169.254`, `172.16/12` with its edges and `172.31.0.2`, `192.168/16`,
multicast), 4 public peers just outside those ranges granted, allocation released.

### Not verified (and why)

- **Anything on a real EC2 instance:** 1:1 NAT behaviour of `external-ip=<public>/<private>`, the
  security group, `systemd`/`journalctl` (the rehearsal read `docker logs`; the runbook's
  `Black listing` count of 8 comes from there), console labels such as IMDSv2.
- **The runbook's `curl` of the template from GitHub:** the file is not on `main` yet, so that
  exact URL cannot work until this PR is merged. The rendering itself (`sed`) was rehearsed with a
  bind-mounted copy, and `sudo tee` was not (the rehearsal used a plain redirect as root).
- **The hidden password prompt:** my environment has no terminal. Only the `TURN_PASSWORD` path was
  run. Try it once on your PC before the real run.
- **Gate item 1** (`relay` candidates from a phone over mobile data): needs the relay and the app.
- **IPv6 peers:** the deny list is IPv4 only; the runbook tells you not to enable IPv6.
- **How many allocations a phone opens:** typical libwebrtc behaviour is one per TURN URL; not
  measured. The `486` itself was observed, but with `turnutils_uclient`.

## FILES CREATED / MODIFIED

- `Server/infra/coturn/turnserver.spike.conf.example`
- `Server/infra/coturn/SPIKE_RELAY.md`
- `Server/infra/coturn/spike-verify.mjs`
- `Server/docs/phase-reports/phase-1-test-relay.md`

No file in `RemoteAccessApp/` was touched. The app needs no change: its spike screen takes the TURN
URLs, user name and credential at run time and keeps them in memory only.

## DEPENDENCIES ADDED

None. `spike-verify.mjs` uses Node's built-in modules only. coturn is installed on the VM from the
distribution package, not in this repository.

## CONTRACT CHANGES

None. No migrations.

## COMMANDS EXECUTED

`docker build` (Ubuntu 24.04 + coturn, scratch directory outside the repo), `docker run` of the
rehearsal servers, `node infra/coturn/spike-verify.mjs ...` (positive and negative runs),
`npx eslint` and `npx prettier` on the new files, `docker run ghcr.io/gitleaks/gitleaks:v8.30.1 git`.
Nothing was run against any cloud account or any host other than `127.0.0.1`.

## SECURITY IMPACT

- **New secrets (name only, where stored):** the spike TURN user/password. Generated on the VM,
  stored in the password manager, never in git, chat or this report. The rehearsal used a
  throwaway password that was deleted with its files.
- **New endpoints / events and their protection (when provisioned):** TURN on UDP/TCP 3478 and UDP
  49160-49200, long-term credential, IPv4 private/special ranges denied, quotas total=20 and
  user=4, SSH from the operator's IP only (or SSM), IMDSv2 required.
- **New stored data:** none. The VM is destroyed after the spike.
- **Logging reviewed for leaks:** yes. The server log never contained the password; it does contain
  client IP addresses, so logs must not be pasted into tickets.
- **Rate limits added:** coturn quotas only (`total-quota=20`, `user-quota=4`).
- **Public repository:** the relay's IP address must not be committed while the relay is live;
  `SPIKE_RELAY.md` says so and the checklist includes a `git grep` for it.

## OPEN QUESTIONS / BLOCKERS

1. **Blocker: an AWS account** (and an IAM user or role with MFA for the operator).
2. **Owner decision: `user-quota=4`.** The brief sets it, and the rehearsal showed what happens
   when it is reached (`486`, no relay candidate). Two phones sharing the user `spike`, each with a
   UDP and a TCP URL, would already use it up, and a network switch (matrix row 7) needs more while
   old allocations still live. The template keeps the brief's value. Recommendation: raise it to
   `12` for the spike (`total-quota=20` still bounds the relay), or run one URL per phone. Decide
   before provisioning; it is a one-line change in the template.
3. **Follow-up after PR #3 merges** (`docs/DECISIONS.md` and the new `CLAUDE.md` lines come with it):
   update `DECISIONS.md` section D (the relay is postponed; gate item 2 is now run by the owner with
   `spike-verify.mjs`, because it needs the password) and the Phase 1 status line in `CLAUDE.md`.
4. ~~Ordering exception~~: resolved. Phase 0's gate was accepted (PR #2 merged), so Phase 1 is no
   longer ahead of it.

## NEXT PHASE

Phase 2 (Accounts and Authentication) is not blocked by this; Phase 1 runs alongside it by earlier
decision. When an AWS account exists, follow `infra/coturn/SPIKE_RELAY.md`; the live steps are the
owner's, and the password never passes through the assistant.

## Evidence log (to fill in when the relay exists; never paste credentials or the relay address)

| Gate item                                                                                | Status | Evidence | Date / who |
| ---------------------------------------------------------------------------------------- | ------ | -------- | ---------- |
| App spike shows `relay` candidates over mobile data using this server                    | ☐      |          |            |
| Private-range relay attempt refused (`spike-verify.mjs`: 42 / 42, summary only)          | ☐      |          |            |
| No credential in git / tickets / chat (gitleaks clean, `git grep` for the address empty) | ☐      |          |            |
| Instance terminated                                                                      | ☐      |          |            |
| Elastic IP released                                                                      | ☐      |          |            |
| Security group deleted                                                                   | ☐      |          |            |
| Destruction confirmed (Tag Editor search finds nothing tagged `mobiledesk-spike-turn`)   | ☐      |          |            |
