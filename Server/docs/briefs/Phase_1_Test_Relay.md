# Server Phase 1 — Temporary Test Relay (for the app's M1 risk spike)

**Read first:** `00_SERVER_AGENT_RULES.md`
**Effort:** 2–3 days
**Unlocks:** app Milestone 1 (risk spike, see `MobileDesk_M1_Risk_Spike_Brief.md`)
**Goal:** give the app team a working TURN relay so they can test screen streaming over mobile data, then destroy it.

> This relay is **throwaway**. It uses long-term static credentials for simplicity, which is acceptable only because it lives for days, is used by the team only, and is destroyed afterwards. Production TURN (Phase 5) uses short-lived HMAC credentials.

---

## 1. Tasks

1. **Provision** the smallest VM in `ap-south-1` with a static public IP (e.g. a t3.small or equivalent). Tag it `mobiledesk-spike-turn`, with an auto-delete reminder date.
2. **Firewall** (security group):
   - UDP and TCP 3478 (TURN)
   - UDP relay range 49160–49200 (keep it narrow)
   - SSH 22 only from the operator's IP
   - Nothing else.
3. **Install coturn** (distribution package or the `coturn/coturn` container).
4. **Configure** `/etc/turnserver.conf` from `infra/coturn/turnserver.spike.conf.example` (commit the example **without** credentials):
   ```text
   listening-port=3478
   external-ip=<PUBLIC_IP>
   min-port=49160
   max-port=49200
   realm=spike.mobiledesk.invalid
   lt-cred-mech
   user=spike:<LONG_RANDOM_PASSWORD>      # generated on the VM, never committed
   fingerprint
   no-cli
   no-multicast-peers
   denied-peer-ip=0.0.0.0-0.255.255.255
   denied-peer-ip=10.0.0.0-10.255.255.255
   denied-peer-ip=100.64.0.0-100.127.255.255
   denied-peer-ip=127.0.0.0-127.255.255.255
   denied-peer-ip=169.254.0.0-169.254.255.255
   denied-peer-ip=172.16.0.0-172.31.255.255
   denied-peer-ip=192.168.0.0-192.168.255.255
   total-quota=20
   user-quota=4
   log-file=stdout
   ```
   Generate the password on the VM (e.g. `openssl rand -base64 32`).
5. **Hand over** the TURN URL, username and password to the app team through a password manager or other secure channel. Never by chat, email, git or ticket text.
6. **Verify** with a public ICE tester (e.g. the WebRTC "Trickle ICE" sample page) that `relay` candidates are gathered.
7. **Verify the relay cannot reach private networks:** from a test client, attempt to allocate and send to a private IP (e.g. `10.0.0.1`); it must be refused. Record the result.
8. **After the app spike report is accepted:** terminate the VM, release the static IP, delete the security group, and confirm in the report.

## 2. Gate

- [ ] App spike shows `relay` candidates over mobile data using this server.
- [ ] Private-range relay attempt is refused (evidence recorded).
- [ ] No credential appears in git, tickets or chat (gitleaks clean).
- [ ] VM, IP and security group destroyed after the spike; destruction confirmed in the report.
