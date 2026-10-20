# Deploy coffee on the Oracle VM

## What stays private

The public code reads these values; neither belongs in Git:

```dotenv
PRET_PUBLIC_ID="your wallet's public_pret_id"
PRET_QR_SIGNING_KEY="the signing key recovered from your installed app"
```

The name “public ID” does not mean the file should be published: these values
allow generation of the wallet QR. The existing `.gitignore` excludes `.env`
and `.env.*`, except the placeholder-only `.env.example`.

A ready-to-transfer `.env.coffee` has been created on your Arch machine at
`~/projects/whatsapp-gif-bot/.env.coffee`, with permissions `0600`. It contains
only the existing wallet identifier and signing key, not your GIPHY key,
WhatsApp credentials, Pret password, or OAuth tokens. Do not copy the entire
local `.env` over the VM's `.env`.

## Deploy

1. Commit/push the code changes using your normal workflow. Review
   `git status --short` and check that the private file is ignored:

   ```sh
   cd ~/projects/whatsapp-gif-bot
   git check-ignore .env.coffee
   ```

2. Transfer the private file over SSH from your Arch machine. Replace `VM_USER`,
   `VM_HOST`, and the remote project path with your actual values (Oracle images
   commonly have different usernames; use your existing SSH login):

   ```sh
   scp ~/projects/whatsapp-gif-bot/.env.coffee \
     VM_USER@VM_HOST:~/projects/whatsapp-gif-bot/.env.coffee
   ```

   Use your usual `-i /path/to/ssh-key` option if needed. The remote folder must
   already exist. Transfer to the same project directory the running bot uses.

3. SSH into the VM, then update that checkout:

   ```sh
   cd ~/projects/whatsapp-gif-bot
   git pull --ff-only
   chmod 600 .env.coffee
   npm ci
   npm run check
   ```

   Ensure `.env.coffee` is owned by the account running Node so it can read it.
   Leave the existing `.env` and `auth/` in place.

4. Check that the VM's clock is synchronized:

   ```sh
   timedatectl status
   ```

   If it isn't, configure time synchronization using your VM's existing time
   service (e.g. chrony or systemd-timesyncd). No particular timezone is required:
   generation uses Unix time.

5. Restart the existing bot process using your existing supervisor. For example,
   use `pm2 restart YOUR_PROCESS_NAME` if managed by PM2, or
   `sudo systemctl restart YOUR_SERVICE_NAME` if managed by systemd.
   These are placeholders, not discovered service names.
   For a manually run bot, stop the old process and run `npm start`.
   Do not start a second instance against the same WhatsApp auth directory.

6. From a different WhatsApp account, message `coffee` to the bot. Its own
   account's messages are ignored, just as for GIF/TfL commands.

## How it works and limitations

Each request creates:

```text
message = public_pret_id + ":" + Unix_timestamp_seconds
signature = lowercase_hex(HMAC_SHA256(signing_key, message))
QR payload = "PR_" + Base64(message + ":" + signature)
```

The PNG is generated in memory without a temporary QR file. It follows the
normal one-hour reply-deletion policy, which is not the QR's validity period.
Validity at Pret's servers is unknown; generate just before use.

The code has automated checks for the signature against an independent fixture,
current timestamps, PNG generation, command matching, and missing configuration.
An image decode comparison against the existing Python implementation was also
performed locally. This does not establish till acceptance or account eligibility.

There is no coffee-specific allowlist: all users who can invoke this private bot
can get the configured wallet's QR. WhatsApp receives the image as intended;
the bot does not send its identifier/key to a QR-generation service.

To change accounts later, re-import the identifier using the local Python setup
tool and update `PRET_PUBLIC_ID` in the private file, transfer it again, and
restart. Updating the local Python configuration alone does not update the bot's
private file. An app algorithm/key change may require updating both code and
configuration.
