# Sign-in emails: SPF, DKIM and DMARC

**The problem this solves.** Your sign-in emails are sent by Resend from
`picks@nflweeklypickem.com`. Until these records exist, nothing tells the
receiving mail server that Resend is allowed to send as your domain. Gmail
and Yahoo both tightened this in 2024: unauthenticated bulk mail from a
domain with no DMARC record goes to spam, or is rejected outright.

The user-visible failure is the worst possible one for this app: the person
taps "Deal me in", the app says the code is on its way, and it lands in a
spam folder they never check — or nowhere at all. They cannot sign in and
there is nothing on screen to explain why. **This is the single most likely
reason a real invited player never makes it into the pool.**

Do this before you invite anybody.

---

## 1. Get the records from Resend

Resend generates a DKIM key that is unique to your domain — nobody can give
you that value in advance, you have to read it from their dashboard.

1. <https://resend.com> → **Domains** → your domain (add
   `nflweeklypickem.com` if it is not there yet)
2. Resend shows a table of DNS records to create. Leave that tab open.

## 2. Add them in Cloudflare

Cloudflare dashboard → **nflweeklypickem.com** → **DNS** → **Records**.

For every row Resend lists, click **Add record** and copy it across
exactly. There will be three kinds:

| Type | Name | Content | Proxy |
|---|---|---|---|
| TXT | `send` (or as shown) | `v=spf1 include:amazonses.com ~all` | n/a |
| TXT | `resend._domainkey` | the long `p=MIGfMA0...` key Resend shows | n/a |
| MX | `send` (or as shown) | `feedback-smtp.us-east-1.amazonses.com` (priority 10) | n/a |

Two things people get wrong here:

- **Do not paste the domain into the Name field.** Cloudflare appends it.
  Typing `resend._domainkey.nflweeklypickem.com` creates
  `resend._domainkey.nflweeklypickem.com.nflweeklypickem.com`, which
  silently never validates.
- **Proxy status must be DNS only** (grey cloud) for any record Cloudflare
  offers to proxy. An orange cloud breaks mail records.

## 3. Add DMARC — Resend does not do this one for you

This is the record that actually decides spam-or-inbox at Gmail and Yahoo,
and it is the one most often skipped.

| Field | Value |
|---|---|
| Type | `TXT` |
| Name | `_dmarc` |
| Content | `v=DMARC1; p=none; rua=mailto:anconalee@yahoo.com; fo=1` |

`p=none` means "authenticate, report, but do not reject yet" — the correct
starting point. It gets you the Gmail/Yahoo compliance tick without any
risk of your own mail being bounced while the setup settles.

Once you have run a couple of weeks with no problems, tighten it to
`p=quarantine`, and later `p=reject`, which is what stops somebody
spoofing your domain. Change one word; nothing else moves.

## 4. Verify

Back in Resend → **Domains**, click **Verify**. Cloudflare's DNS is fast;
this usually goes green within a minute or two.

Then check it independently, because Resend only checks its own records:

```
nslookup -type=txt _dmarc.nflweeklypickem.com
nslookup -type=txt resend._domainkey.nflweeklypickem.com
```

Both must return a value. If `_dmarc` comes back empty, step 3 did not
take.

## 5. Prove it end to end

Send yourself a code from the real site, then in Gmail open the message →
**⋮** → **Show original**. You want all three:

```
SPF:   PASS
DKIM:  PASS
DMARC: PASS
```

If DKIM says FAIL, the `resend._domainkey` value was truncated on paste —
it is long, and copying from a narrow browser column often drops the tail.
Re-copy the whole thing.

---

## Why the app cannot detect this for you

`/api/request-code` asks Resend to send and Resend answers "accepted" — it
has queued the message. Whether a receiving server then files it under
spam happens later, at a different company, and is never reported back.
So the Worker cannot know, the app cannot know, and the only signal is a
person telling you they never got their code. Which is exactly why this
needs doing before anyone is invited rather than after.
