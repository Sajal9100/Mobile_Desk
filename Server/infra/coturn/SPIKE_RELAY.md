# Spike TURN relay — runbook (Server Phase 1)

**Throwaway.** One small VM running coturn so the app's Milestone 1 spike can test screen
streaming over mobile data. It is destroyed when the app's spike report is accepted.

Rules that apply to everything below (`00_SERVER_AGENT_RULES.md`, rule 5): **no credential in
git, chat, email or tickets.** The username/password go from a password manager straight into
the spike screen's input fields, at runtime.

Config template: [`turnserver.spike.conf.example`](turnserver.spike.conf.example).

---

## 1. Provision (AWS console, region `ap-south-1` Mumbai)

| Setting | Value |
|---|---|
| AMI | Ubuntu Server LTS (current) |
| Type | `t3.small` (smallest that is comfortable; `t3.micro` also works for 2 phones) |
| Key pair | A new key pair, or use SSM Session Manager instead of SSH |
| Tags | `Name = mobiledesk-spike-turn`, `delete-by = <date, ≤ 10 days out>`, `purpose = m1-risk-spike` |
| Public IP | Allocate an **Elastic IP** and associate it. Coturn's `external-ip` must not change. |

**Security group** (name it `mobiledesk-spike-turn-sg`) — inbound only:

| Protocol | Port(s) | Source |
|---|---|---|
| UDP | 3478 | 0.0.0.0/0 |
| TCP | 3478 | 0.0.0.0/0 |
| UDP | 49160–49200 | 0.0.0.0/0 |
| TCP | 22 | **your public IP /32 only** |

Nothing else. No TLS/5349 for the spike (production adds it in Phase 5).

## 2. Install and configure coturn (on the VM)

```bash
sudo apt-get update && sudo apt-get install -y coturn
sudo systemctl stop coturn

# Ubuntu's package ships /etc/default/coturn — make sure the service is enabled:
#   TURNSERVER_ENABLED=1   (older packages only; harmless otherwise)

# 1. Put the template in place
sudo cp /dev/null /etc/turnserver.conf
sudo nano /etc/turnserver.conf         # paste the contents of turnserver.spike.conf.example

# 2. Replace <PUBLIC_IP> with the Elastic IP.
#    If relay candidates fail to gather on EC2 (1:1 NAT), use the mapped form instead:
#      external-ip=<ELASTIC_IP>/<INSTANCE_PRIVATE_IP>

# 3. Generate the password ON THE VM and put it into the file (not into shell history):
openssl rand -base64 32          # copy the output into user=spike:<password>
# Base64 can contain '/' '+' '='; that is fine for coturn's user= line.

sudo chmod 640 /etc/turnserver.conf
sudo systemctl enable --now coturn
sudo systemctl status coturn --no-pager
sudo journalctl -u coturn -n 50 --no-pager     # no errors; "listener opened on" lines for 3478
```

Because the config sets `log-file=stdout`, logs go to the journal. Do not paste logs into any
ticket without checking they contain no username/password.

## 3. Hand over the credentials

TURN URL, username (`spike`), and password go to the person running the app spike via a
**password manager shared item** (or another secure channel). The URLs to type into the app:

```
turn:<ELASTIC_IP>:3478?transport=udp,turn:<ELASTIC_IP>:3478?transport=tcp
```

Never by chat, email, git or ticket text. Record in the report only *that* the handover
happened and how (e.g. "shared via password manager"), not the values.

## 4. Verify

### 4.1 Relay candidates (gate item 1)

1. Open the WebRTC **Trickle ICE** sample page (`webrtc.github.io/samples/src/content/peerconnection/trickle-ice/`).
2. Remove the default STUN entry, add the TURN URL + username + password, click *Add server* → *Gather candidates*.
3. A candidate of type **`relay`** must appear. Do not screenshot the form with the password visible.
4. Then the app spike's matrix rows 2, 3, 4 must show `relay` in the candidate-types stats.

### 4.2 The relay cannot reach private networks (gate item 2)

From any Linux box (or a container) with the coturn utilities (`apt install coturn` provides
`turnutils_uclient`), attempt to allocate and send to a private IP. Read the password from a
prompt so it isn't stored in shell history, and check the flags against `turnutils_uclient -h`
for the installed version:

```bash
read -rsp 'TURN password: ' TURNPW; echo
turnutils_uclient -v -u spike -w "$TURNPW" -e 10.0.0.1 -r 3478 <ELASTIC_IP>
turnutils_uclient -v -u spike -w "$TURNPW" -e 172.31.0.2 -r 3478 <ELASTIC_IP>      # default VPC range
turnutils_uclient -v -u spike -w "$TURNPW" -e 169.254.169.254 -r 3478 <ELASTIC_IP> # instance metadata
unset TURNPW
```

**Expected:** the CreatePermission / send to the private peer is refused — a `403` ("Forbidden IP")
response from the server — and the VM log shows the denied peer. **If any of the three
succeeds, stop and fix `denied-peer-ip` before continuing.** Paste the redacted command output
(no password) into the report as evidence.

### 4.3 Secrets hygiene (gate item 3)

Run gitleaks over the repo and confirm it is clean:

```bash
docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo --redact
```

## 5. Destroy (after the app's spike report is accepted)

Do **all** of these, and record each in the report (time + who):

- [ ] Terminate the EC2 instance (`mobiledesk-spike-turn`).
- [ ] Release the Elastic IP (an unassociated Elastic IP is billed).
- [ ] Delete the security group `mobiledesk-spike-turn-sg`.
- [ ] Delete the key pair (if one was created just for this).
- [ ] Delete the password-manager item.
- [ ] Confirm in the AWS console that no resource tagged `mobiledesk-spike-turn` remains
      (EC2, Elastic IPs, security groups, volumes, snapshots).
- [ ] Tell the app team the TURN URL is dead, so they remove it from any notes.

If the spike is abandoned early, run the same list immediately. The `delete-by` tag is the
backstop; set a calendar reminder for that date.
