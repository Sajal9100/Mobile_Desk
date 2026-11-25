# Server Phase 6 — Production Hardening and Launch

**Read first:** `00_SERVER_AGENT_RULES.md`
**Effort:** about 2 weeks
**Unlocks:** app Milestone 8 and the v1 public launch (view-only)
**Goal:** a production environment that is reproducible, observable, backed up, load-tested, privacy-compliant and externally penetration-tested.

> This is the first phase allowed to deploy to production. Every production change needs a human approval step.

---

## 1. Infrastructure as code

Terraform (or AWS CDK) in `infra/` for `ap-south-1`:

| Resource | Setting |
|---|---|
| VPC | Public subnets (load balancer, coturn) and private subnets (app, databases) across 2 availability zones |
| Load balancer | HTTPS only (HTTP → HTTPS redirect), TLS 1.2+ policy, ACM certificate for `api.` and `rt.`; WebSocket idle timeout ≥ 60 s |
| WAF | Managed common rule set + IP rate rule (e.g. 2,000 requests / 5 min / IP) |
| Containers | ECS Fargate (or equivalent): `api` ×2, `realtime` ×2, `worker` ×1, min/max autoscaling on CPU and connections |
| PostgreSQL | Managed (RDS), Multi-AZ, encrypted at rest, private only, automated backups 14 days + point-in-time recovery, deletion protection |
| Redis | Managed (ElastiCache), encrypted in transit and at rest, AUTH token, private only |
| coturn | From Phase 5, managed by the same IaC |
| Secrets | Secrets Manager: DB URL, Redis auth, JWT keys, TURN secret, FCM + Play Integrity service accounts, IP hash key, Sentry DSN |
| DNS | `api.`, `rt.`, `turn.` records; CAA record |
| IAM | Least privilege per service; no long-lived access keys; CI deploys via OIDC role |

## 2. Deployment pipeline

1. Merge to `main` → build image once (tagged with git SHA) → push to registry → scan image (e.g. Trivy; fail on critical).
2. Deploy to **staging** → run migrations → smoke tests (health, register, login, device register, ticket, session request/accept with test accounts).
3. **Production** → manual approval → migrations (backward-compatible only: expand → migrate → contract) → rolling deploy → smoke test → automatic rollback on failed health checks.

## 3. Observability

- **Logs:** JSON to CloudWatch (or equivalent), 30-day retention for app logs; redaction verified (§6).
- **Metrics:** request rate, error rate, p95 latency per route; active sockets; sessions by status; integrity failures; rate-limit hits; push failures; TURN bandwidth and allocations; DB connections; Redis memory.
- **Alerts** (to on-call email/phone): 5xx > 2% for 5 min; p95 > 1 s; `/ready` failing; DB CPU > 80%; Redis memory > 75%; TURN bandwidth > 70%; spike in `refresh_reuse_detected` or integrity failures; certificate expiry < 14 days.
- **Sentry** with `beforeSend` scrubbing the same keys as the logger.

## 4. Data protection and privacy (DPDP Act 2023)

- Retention jobs (worker, daily): `session_events` > 180 days deleted; closed `reports` > 1 year; expired refresh tokens; hard-delete soft-deleted accounts after 30 days (cascade devices, tokens, settings; anonymise session rows).
- `GET /api/account/export` — the user's own data as JSON (profile, devices, session history). Rate limit 1 per day.
- Privacy notice and data inventory in `docs/PRIVACY.md` (what is stored, why, how long, where).
- Confirm account deletion meets Google Play's account-deletion requirement (in-app + web link).

## 5. Operations readiness

- `docs/RUNBOOKS.md`: rotate JWT signing key (add new `kid`, switch active, remove old after 15 min); rotate TURN secret (dual secrets); suspend a user (status + disconnect + revoke); restore DB to a point in time; scale TURN; incident response including CERT-In reporting within 6 hours for reportable incidents.
- **Restore test:** restore last night's backup to a new instance, run a data sanity script, record the time taken.
- Admin access: no admin API in v1. Moderation (reports, suspension) via audited scripts run by named operators.

## 6. Verification

1. **Load test** (k6 or Artillery) on staging: 1,000 concurrent sockets with heartbeats; 100 session request→accept→signal→end flows per minute; login burst. Record p95 latency, error rate and resource use; size autoscaling and TURN from the results.
2. **Security self-check** against OWASP ASVS L2 (API) and the architecture doc's security table. Record pass/fail per item.
3. **Log leak test:** run the full smoke flow, grep all logs for test passwords, tokens, tickets, SDP fragments and TURN credentials — zero hits.
4. **External penetration test** (API, realtime, TURN, and the app together). Fix all critical and high findings; retest.
5. **Dependency and image scan** clean of critical issues.

## 7. Gate (v1 launch)

- [ ] Production built from IaC; no manual console changes outstanding.
- [ ] Alerts fire in a drill (stop a container; trip a fake 5xx).
- [ ] Restore test passed and timed.
- [ ] Load test results recorded and capacity set.
- [ ] Pen test: no open critical or high findings.
- [ ] Privacy notice, export and deletion live; retention jobs running.
- [ ] App v1 release gate met (app plan §20).
- [ ] Phase report submitted and launch approved by a human.
