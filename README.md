# Private WhatsApp GIF bot

A small Node.js bot for a spare WhatsApp account. Send `@gif-bot funny cat` in a private chat with the bot or a group containing it, and it replies there with an animated GIF. You can type the literal text `@gif-bot`, or select the bot account from WhatsApp's mention menu at the start of the message and then type your search.

Uses the maintained **`baileys` package, pinned to `7.0.0-rc14`**, verified against npm's latest tag and the [official release](https://github.com/WhiskeySockets/Baileys/releases/tag/v7.0.0-rc14). This is a release candidate. The project uses ESM imports, `connection.update` QR events, `creds.update` persistence, and supports private-chat LID addresses used by v7. It needs no automated browser, database, frontend, or video converter.

## 1. Install Node.js

Visit [nodejs.org/download](https://nodejs.org/en/download) and install **Node.js 24 LTS** for your operating system. On Windows/macOS, use the installer and keep the default options. On Linux, follow the site's installation instructions. npm comes with Node.js.

Open a new terminal (PowerShell on Windows, Terminal on macOS/Linux) and check:

```sh
node --version
npm --version
```

This project requires Node.js 22 or newer; Node.js 24 LTS is recommended.

## 2. Install the project dependencies

Open a terminal in this project's folder, or use `cd` to go there. For example:

```sh
cd /path/to/whatsapp-gif-bot
npm install
```

Replace the example path with your folder's actual location. Keep the generated `package-lock.json` so installs use consistent versions.

## 3. Create your .env file

Create a new file named exactly `.env` in the same folder as `index.js`, and enter your GIPHY API Key under the variable name GIPHY_API_KEY. i.e.:

```sh
GIPHY_API_KEY="EXAMPLE_API_KEY"
```

If you do not have an API key, follow the [GIPHY developer guide](https://developers.giphy.com/docs/api#quick-start-guide):

## 4. Add a GIPHY API key

Sign in at [GIPHY Developers](https://developers.giphy.com/), create an app using the **API** option, and copy its API key. Open `.env` in a text editor and replace the placeholder:

```dotenv
GIPHY_API_KEY=paste_your_actual_key_here
```

Save the file. Never post the key or your `.env` publicly. The bot sends search terms to GIPHY; it does not send them your WhatsApp credentials.

## 5. Run the bot

```sh
npm start
```

A QR code appears in the terminal. Keep this terminal open and the computer connected to the internet. The bot stops if the process exits or the computer sleeps. Press **Ctrl+C** to stop it; it lets the current request finish and removes its temporary download.

## 6. Link the spare WhatsApp account

1. Open WhatsApp on the phone signed into the **spare account** you want the bot to use.
2. Open **Linked devices** (under Settings on iPhone, or the three-dot menu on Android).
3. Tap **Link a device** and scan the terminal QR code with that phone.
4. Wait for the terminal to say **Connected**. A brief reconnect after pairing is normal.
5. From a **different WhatsApp account**, send `@gif-bot funny cat` to the spare account. To test a group, add the spare account and send the same command from another member's account.

The bot ignores its own account's messages, including messages typed on that account's phone. Other messages are ignored unless they start with the exact, lowercase `@gif-bot` command or a menu mention of the bot account, followed by whitespace or the end of the message. Sending just the command or mention replies with `Usage: @gif-bot <search>`.

Login credentials are saved in `auth/`, so later runs normally connect without another QR scan. Keep this folder private: its contents grant access to the linked account. Run only one instance using this folder. Anyone who can message the account, or shares a group with it, can invoke the bot; there is no allowlist.

## How GIFs work

The bot requests up to 20 [GIPHY search results](https://developers.giphy.com/docs/api/endpoint/#search), then randomly picks a usable GIF from the first 10. Repeated searches can still select the same GIF by chance. Search terms are limited to 50 characters by GIPHY.

WhatsApp requires GIF animations to be sent as MP4 videos with `gifPlayback: true`, as described in the [Baileys media examples](https://github.com/WhiskeySockets/Baileys/blob/master/README.md). The bot downloads GIPHY's ready-made MP4 rendition of the selected GIF to `tmp/`, sends it as an animated GIF, and deletes that request's temporary folder in a `finally` block, including after failures. It does not download a raw `.gif` or need FFmpeg. Downloads have a 30-second timeout and a 16 MiB size cap.

Temporary connection failures retry with delays up to 30 seconds. Logout, invalid sessions, and another instance replacing this connection stop the bot for attention. Full history sync is disabled, but Baileys' default initial sync is enabled to load account ID mappings. Only `notify` message events are processed as commands; history events are ignored.

## Troubleshooting

- **`node` or `npm` not found:** install Node.js, close and reopen the terminal, then check the version commands above.
- **Dependency installation fails:** check your internet connection and Node version, then rerun `npm install`. Avoid installing an old Baileys version from a tutorial.
- **Missing API key at startup:** check that `.env` is beside `index.js`, is not `.env.txt`, and contains your real `GIPHY_API_KEY`. Restart after editing it.
- **QR does not scan:** enlarge the terminal or reduce its font size so the entire QR fits. Use the newest code shown; codes expire. Scan inside WhatsApp's Linked devices screen, not the normal camera app.
- **No reply:** send from a different account, start the message with literal `@gif-bot` or a menu mention of the bot, and check the terminal says Connected. In groups, the spare account must be a member and allowed to send messages. `@gif-botanytext` is not a command. The terminal logs message event counts without their content: `own=1` means the message came from the bot's own account and is ignored. `GIF request received` means the command matched.
- **Linked device says Google Chrome (Mac OS) on Linux:** this is Baileys' default client identification, not a detected operating system or a real browser. No Chrome process is launched. This label does not prevent receiving messages.
- **Warning about disabling initial LID mapping sync:** update to this version and restart. The bot now allows Baileys' default initial sync. If an already-paired session still has mapping/decryption errors, follow the credential-backup and re-pair steps below to obtain a fresh initial sync.
- **GIPHY rejects the key:** check the key in your developer dashboard and `.env`. A rate-limit reply means wait before trying again. No results means try another phrase. Download or send errors can usually be retried.
- **Disconnected:** leave the bot running for temporary network problems; it reconnects automatically. If another connection replaced it (code 440), stop duplicate bot processes and restart this one.
- **Logged out / invalid session (such as 401, 403, 411, or 500):** stop the bot. Check the account works on the phone and remove the stale linked device if present. Rename `auth/` to `auth-backup/`, then restart and scan a new QR. This preserves the old files while creating fresh credentials. If WhatsApp restricts the account, resolve that on the phone first.
- **Credential or disk errors:** make sure this project folder is writable and there is free disk space.
- **Temporary files left after a crash or power loss:** stop the bot and delete the project's `tmp/` folder using your file manager. It is recreated on startup. Normal success and failure paths clean up automatically.

`.gitignore` excludes `.env`, authentication folders, `node_modules/`, and `tmp/`. Do not share QR codes or credential backups either. Baileys is an unofficial WhatsApp client; use a spare account and keep usage modest because accounts can be restricted.

You can check JavaScript syntax without connecting to WhatsApp:

```sh
npm run check
```
