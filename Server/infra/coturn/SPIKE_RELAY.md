# Spike TURN relay: runbook (Server Phase 1)

> **Status 2026-11-26: postponed.** There is no AWS account yet, so no relay exists. Everything in
> this file that can be tested without a cloud account **was** rehearsed locally (Ubuntu 24.04 +
> coturn 4.6.1 in Docker, the same package and service user as the VM): the config template, the
> file ownership, the verification script and every failure it must catch. What a local run cannot
> show is listed in `docs/phase-reports/phase-1-test-relay.md`. Provision only when the app's M1
> spike is ready for its relay tests: the relay should live days, never more than 10.

**Throwaway.** One small VM running coturn so the app's Milestone 1 spike can test screen
streaming over mobile data. It is destroyed when the app's spike report is accepted.

Rules that apply to everything below (`00_SERVER_AGENT_RULES.md`, rule 5): **no credential in
git, chat, email or tickets.** The username/password go from a password manager straight into
the spike screen's input fields, at runtime. This repository is **public**: the relay's IP
address does not go into git either while the relay is live.

Files: [`turnserver.spike.conf.example`](turnserver.spike.conf.example) (config template) and
[`spike-verify.mjs`](spike-verify.mjs) (verification, run from your PC).

---

## 0. Before you start

- [ ] Create an **AWS Budget alert** (for example 5 USD) in the account.
- [ ] Pick the `delete-by` date (at most 10 days out) and put it in your calendar now.
- [ ] Use an IAM user or role with MFA, not the root user. EC2 permissions are enough
      (instances, security groups, addresses, key pairs, tags). To avoid port 22 entirely, use SSM
      Session Manager instead of SSH (needs an instance profile with `AmazonSSMManagedInstanceCore`).
- [ ] Merge the pull request that contains this runbook, and note the commit SHA of `main` (used in
      section 2 to fetch the config template pinned to that exact version).

## 1. Provision (AWS console, region `ap-south-1` Mumbai)

| Setting   | Value                                                                           |
| --------- | ------------------------------------------------------------------------------- |
| AMI       | Ubuntu Server **24.04 LTS** (the version the rehearsal used: coturn 4.6.1)      |
| Type      | `t3.small` (`t3.micro` also works for two phones)                               |
| Storage   | 8 GB gp3                                                                        |
| Key pair  | A new key pair, or SSM Session Manager instead of SSH                           |
| Metadata  | **IMDSv2 required** (Advanced details, Metadata version "V2 only")              |
| IPv6      | **Do not enable.** The deny list below is IPv4 only.                            |
| Tags      | `Name = mobiledesk-spike-turn`, `delete-by = <date>`, `purpose = m1-risk-spike` |
| Public IP | Allocate an **Elastic IP** and associate it (give it the same tags).            |

**Security group** `mobiledesk-spike-turn-sg` (tag it too), inbound only:

| Protocol | Port(s)     | Source                                            |
| -------- | ----------- | ------------------------------------------------- |
| UDP      | 3478        | 0.0.0.0/0                                         |
| TCP      | 3478        | 0.0.0.0/0                                         |
| UDP      | 49160-49200 | 0.0.0.0/0                                         |
| TCP      | 22          | **your public IP /32 only** (skip if you use SSM) |

Nothing else. No TLS/5349 for the spike (production adds it in Phase 5).

## 2. Install and configure coturn (on the VM)

Ubuntu's service runs as the user `turnserver` and reads `/etc/turnserver.conf`.

> **The file must be readable by that user.** Rehearsed: if coturn cannot read its config it does
> **not** refuse to start. It starts with defaults: **no authentication and none of the denied
> ranges**, an open relay. That is why the file below is owned `root:turnserver`, mode 640, and why
> step 3 checks it.

```bash
sudo apt-get update && sudo apt-get install -y coturn
sudo systemctl stop coturn

# 1. The template, pinned to a commit of this repo (use the SHA from section 0).
curl -fsSL "https://raw.githubusercontent.com/Sajal9100/Mobile_Desk/<COMMIT_SHA>/Server/infra/coturn/turnserver.spike.conf.example" -o /tmp/turnserver.tpl

# 2. Render the real config. EC2 uses 1:1 NAT, so external-ip is "<elastic ip>/<private ip>".
#    The password is generated here and goes into the file only. It is not printed.
ELASTIC_IP=<paste the Elastic IP>
PRIVATE_IP=$(hostname -I | awk '{print $1}')
PW=$(openssl rand -hex 24)
sudo install -o root -g turnserver -m 640 /dev/null /etc/turnserver.conf
sed -e "s|<PUBLIC_IP>|${ELASTIC_IP}/${PRIVATE_IP}|" -e "s|<LONG_RANDOM_PASSWORD>|${PW}|" \
  /tmp/turnserver.tpl | sudo tee /etc/turnserver.conf >/dev/null
unset PW; rm /tmp/turnserver.tpl

# 3. Checks BEFORE starting the service.
ls -l /etc/turnserver.conf                                  # -rw-r----- 1 root turnserver
sudo -u turnserver test -r /etc/turnserver.conf && echo "readable by turnserver: yes"
sudo grep -c '<[A-Z_]*>' /etc/turnserver.conf               # expect 0 (no placeholder left)

# 4. Start.
sudo systemctl enable --now coturn
sudo systemctl status coturn --no-pager
sudo journalctl -u coturn --no-pager | grep -c 'Black listing'   # expect 8; 0 means the config was NOT loaded
```

Copy the password **once** into the password manager, then clear the screen:

```bash
sudo sed -n 's/^user=spike://p' /etc/turnserver.conf
clear
```

coturn only skips lines that start with `#`; a comment after a value becomes part of the value
(rehearsed: a trailing comment on the `user=` line made the correct password fail with 401). The
template therefore keeps all comments on their own lines. Do not add any.

`log-file=stdout` sends logs to the journal. The journal never contains the password (checked after
several full verification runs); it does contain client IP addresses, and
`check_stun_auth: user spike credentials are incorrect` for every failed login. Do not paste logs
into any ticket.

## 3. Hand over the credentials

TURN URL, username (`spike`), and password go to the person running the app spike via a
**password manager shared item** (or another secure channel). The URLs to type into the app:

```
turn:<ELASTIC_IP>:3478?transport=udp,turn:<ELASTIC_IP>:3478?transport=tcp
```

Never by chat, email, git or ticket text. Record in the report only _that_ the handover
happened and how (for example "shared via password manager"), not the values.

**Quota.** The brief sets `user-quota=4` and both phones share the user `spike`. Every
PeerConnection typically opens **one allocation per TURN URL** (two URLs = two allocations; not
measured here), and an old allocation lives until its lifetime ends (10 minutes by default). Two phones with both URLs already
use all four, and an ICE restart (the matrix row that switches networks) needs more. When the quota
is full coturn answers `486 Allocation Quota Reached` (rehearsed) and the app gets no `relay`
candidate. If that shows up in the journal (`sudo journalctl -u coturn | grep 486`), either wait
10 minutes, use one URL per phone, or ask the owner to raise `user-quota` for the spike
(`total-quota=20` still caps the whole relay).

## 4. Verify

### 4.1 Relay candidates (gate item 1)

1. Open the WebRTC **Trickle ICE** sample page (`webrtc.github.io/samples/src/content/peerconnection/trickle-ice/`).
2. Remove the default STUN entry, add the TURN URL + username + password, click _Add server_, then _Gather candidates_.
3. A candidate of type **`relay`** must appear. Do not screenshot the form with the password visible.
4. Then the app spike's matrix rows 2, 3, 4 must show `relay` in the candidate-types stats, over
   mobile data, with the relay-only switch on.

### 4.2 The relay is closed to private networks and to anyone without the password (gate item 2)

Run this on **your PC** (it needs only Node), from the `Server/` folder, in PowerShell, Windows
Terminal, VS Code's terminal or WSL. In Git Bash, prefix it with `winpty` so the password prompt can
hide your typing.

```bash
node infra/coturn/spike-verify.mjs <ELASTIC_IP>
```

It asks for the password with hidden input (or reads `TURN_PASSWORD` if that is set). The password
is never taken from the command line, never printed and never written to a file; the relay address
is not printed either, so the output is safe to paste into the report.

It opens **one** allocation per transport (UDP, then TCP), checks everything on it and releases it
again, so it does not use up the quota. It expects **42 of 42 checks passed**:

- no credentials, or a wrong password: refused with `401`;
- the correct credentials get an allocation;
- 13 private and special peers are refused with `403`: `0.0.0.0/8` (start and end), `10/8`
  (start and end), `100.64/10` (start and end), loopback, `169.254.169.254`, `172.16/12` (start,
  the default VPC `172.31.0.2`, end), `192.168/16`, multicast;
- 4 public peers just outside those ranges are granted (the deny list is not too broad);
- the allocation is released.

| If you see                                                  | It means                                          | Do                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| `allocation without credentials is refused` FAIL (CRITICAL) | Open relay, almost certainly an unreadable config | `sudo systemctl stop coturn`, fix the ownership, redo section 2 step 3 |
| `peer ... is refused (403)` FAIL (CRITICAL)                 | The deny list is not loaded                       | Same: stop coturn, check the config and the journal line count         |
| `correct credentials get an allocation` FAIL with 401       | Wrong password, or the `user=` line is broken     | Re-copy the password from the manager; check the line has no comment   |
| the same, with 486                                          | Quota used by earlier tests                       | Wait 10 minutes and run again                                          |
| `relay reachable` FAIL                                      | Nothing answered                                  | Security group: UDP and TCP 3478; is coturn running?                   |

Not covered: IPv6 peers (the deny list is IPv4 only, which is why the VM must have no IPv6
address; not tested), and traffic from a real phone (that is 4.1).

### 4.3 Secrets hygiene (gate item 3)

The `server-ci` workflow runs gitleaks over the whole history on every pull request. To check
locally first (pinned version, works on Windows with Docker Desktop):

```bash
docker run --rm -v "$PWD:/repo:ro" ghcr.io/gitleaks/gitleaks:v8.30.1 git --redact --no-banner /repo
```

Also confirm the relay address never reached the repository: `git grep -n -F "<ELASTIC_IP>"`
must print nothing.

## 5. Destroy (after the app's spike report is accepted)

Do **all** of these, and record each in the report (time + who):

- [ ] Terminate the EC2 instance (`mobiledesk-spike-turn`). Its volume goes with it; check it did.
- [ ] Release the Elastic IP (an unassociated Elastic IP is billed).
- [ ] Delete the security group `mobiledesk-spike-turn-sg`.
- [ ] Delete the key pair (if one was created just for this).
- [ ] Delete the password-manager item.
- [ ] In the console, open **Resource Groups & Tag Editor**, search `ap-south-1` for tag
      `Name = mobiledesk-spike-turn` (and `purpose = m1-risk-spike`) across all resource types:
      **nothing may be listed** (also check volumes and snapshots).
- [ ] Remove the AWS Budget alert if it was made only for this.
- [ ] Tell the app team the TURN URL is dead, so they remove it from any notes.

If the spike is abandoned early, run the same list immediately. The `delete-by` tag and the
calendar reminder are the backstop.
