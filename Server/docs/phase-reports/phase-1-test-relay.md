# Phase 1 report — Temporary test relay

```text
PHASE: 1 — Temporary Test Relay (for the app's M1 risk spike)
STATUS: Partial — runbook and config template delivered; VM provisioning and verification are operator steps
GATE: Not passed — evidence to be added below as each item is completed

IMPLEMENTED:
- infra/coturn/turnserver.spike.conf.example  (brief's config, placeholders only)
- infra/coturn/SPIKE_RELAY.md                 (provision / configure / verify / destroy runbook)
- docs/phase-reports/phase-1-test-relay.md    (this report)

FILES CREATED / MODIFIED:
- Server/infra/coturn/turnserver.spike.conf.example
- Server/infra/coturn/SPIKE_RELAY.md
- Server/docs/phase-reports/phase-1-test-relay.md

DEPENDENCIES ADDED:
- none (coturn is installed on the VM from the distribution package, not in this repo)

CONTRACT CHANGES:
- none

MIGRATIONS:
- none

COMMANDS EXECUTED:
- (none against infrastructure yet — AWS CLI is not installed on the dev machine; console steps are in the runbook)

TESTS:
- Not run (infrastructure phase; verification steps are in SPIKE_RELAY.md §4)

SECURITY IMPACT:
- New secrets (name only, where stored): spike TURN user/password — generated on the VM, handed over through a password manager, never in git.
- New endpoints / events and their protection: TURN on UDP/TCP 3478 + UDP 49160–49200, long-term credential, private ranges denied, quotas total=20 / user=4. SSH from the operator IP only.
- New stored data (table, retention): none. The VM is destroyed after the spike.
- Logging reviewed for leaks: yes — config logs to stdout/journal; runbook warns not to paste logs into tickets.
- Rate limits added: coturn quotas (total-quota=20, user-quota=4).

OPEN QUESTIONS / BLOCKERS:
- AWS account / region access for the operator.
- Ordering exception: Phase 1 is run alongside Phase 0 (the rules say phases run in order). Reason: the app's spike needs TURN now and its GO/NO-GO can change the architecture. Phase 1 shares no code with Phase 0.

NEXT PHASE:
- Phase 0 gate, then Phase 2.
```

## Evidence log (fill in; never paste credentials)

| Gate item | Status | Evidence | Date / who |
|---|---|---|---|
| App spike shows `relay` candidates over mobile data using this server | ☐ | | |
| Private-range relay attempt refused (10.0.0.1, 172.31.x, 169.254.169.254) | ☐ | | |
| No credential in git / tickets / chat (gitleaks clean) | ☐ | | |
| VM terminated | ☐ | | |
| Elastic IP released | ☐ | | |
| Security group deleted | ☐ | | |
| Destruction confirmed (no `mobiledesk-spike-turn` resources remain) | ☐ | | |
