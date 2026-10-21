# Private WhatsApp GIF bot

A small Node.js bot for a spare WhatsApp account. Send `gif funny cat` in a private chat with the bot or a group containing it, and it replies there with an animated GIF. No @ or mention is needed. It can also show live Tube departures with `tfl hammersmith`.

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
5. From a **different WhatsApp account**, send `gif funny cat` to the spare account. To test a group, add the spare account and send the same command from another member's account.

The bot ignores its own account's messages, including messages typed on that account's phone. Commands must start at the beginning of the message: lowercase `gif <search>` searches GIPHY and bare `gif` replies with `Usage: gif <search>`; `tfl` can use any capitalization. Trailing whitespace is allowed. Ordinary messages, words like `gift`, and the old `@gif-bot`/menu-mention commands are ignored.

## Live rail departures

Use `tfl <station>` to receive up to eight live TfL rail departures, ordered by expected arrival time:

```text
tfl hammersmith
```

Send `tfl help` in WhatsApp to see the short list of TfL commands.

To show one Tube line only, add the explicit `line` qualifier:

```text
tfl hammersmith line district
tfl hammersmith line h&c
```

Departure boards and journeys cover Tube, Elizabeth line, London Overground, and DLR. This means `tfl reading` can show Elizabeth line departures. The optional `line` qualifier supports Tube lines, plus `elizabeth` and `dlr`. Supported Tube aliases include Hammersmith & City (`h&c` or `hc`) and the common `picadilly` misspelling. The bot uses TfL's station search. It accepts some abbreviations, but if a short name matches multiple stations it lists the choices instead of guessing; for example, `tfl southken` can mean South Kenton or South Kensington. Use `tfl south kensington` in that case.

Use `tfl <from> to <destination>` for the quickest current Tube journey, for example:

```text
tfl hammersmith to south kensington
```

The reply shows the estimated duration, leave/arrival times, and each rail leg. Where a route changes line, it also says where to change. Both places are first resolved as TfL rail stations, so ambiguous abbreviations are rejected instead of guessed. For example, use `south kensington`, rather than `southken` (which can also mean South Kenton).

## River bus departures

Use `tfl boat <station>` for live river-bus departures from a pier:

```text
tfl boat westminster
```

The station must be a river-bus pier name, such as Westminster Pier. The reply lists up to eight upcoming services with their route, destination, expected time, and berth. It only provides departures; river-bus journey routing is not included.

## Rail network status

Use `tfl line` to see the current status of every Tube line, London Overground route, DLR, and Elizabeth line. Add a line name to check just that one:

```text
tfl line
tfl line district
```

The full-network reply is deliberately compact: one status per line. An individual-line lookup also includes TfL's disruption reason. Individual-line lookups support the usual Tube names plus DLR, Elizabeth, and named London Overground routes such as Mildmay or Windrush.

## Live crowding

Use `tfl crowd <station>` to check whether TfL considers a station quieter or busier than usual:

```text
tfl crowd southkensington
```

TfL returns a percentage of its normal crowding baseline, rather than a platform-capacity percentage. The bot reports that value alongside a plain-language comparison and the TfL update time. Some stations and modes do not publish live crowding data; the bot says so when the feed is unavailable.

## Station service status

Use `tfl status <station>` to see reported problems on TfL rail lines serving that station:

```text
tfl status richmond
```

The reply lists affected Tube, Elizabeth line, London Overground, and DLR lines with TfL's severity and a shortened reason. If every applicable line has good service, it says so. National Rail operators are not included in this command.

Departure boards use TfL's public Unified API. You may optionally set `TFL_APP_KEY` in `.env` if you have an API key from TfL; the bot works without it for small personal use. Do not put the key in a message.

## Coffee QR codes

Send exactly `coffee` (any capitalization) to get a fresh Pret wallet QR image.
The bot generates the timestamp, signature, and PNG when it handles the request.
It keeps the PNG in memory and sends it through the normal reply/deletion path.
The received image is static: request another just before use.
Send `coffee used` after the QR has been redeemed. This records one use, starts the global 30-minute cooldown, and replies with today's count. Send `coffee count` to check the count without changing it. The subscription allows five recorded uses per UK calendar day; at `5/5`, `coffee` replies with an error instead of a QR until the next day. A normal `coffee` request only generates a QR: it does not increment the count or reset the cooldown, but its QR caption shows today's count. If a use was marked less than 30 minutes ago, it gives the warning and still sends the QR.

The use count and last-use time are saved locally so restarting the bot does not bypass the limit or cooldown.

Set `PRET_PUBLIC_ID` and `PRET_QR_SIGNING_KEY` in a private `.env.coffee` file
beside `index.js`, or in the process environment. Both are required only for
`coffee`; missing values do not disable GIF/TfL commands. No credentials are
hardcoded in the source. Existing process environment values take precedence,
then `.env.coffee`, then `.env`.

See [Oracle VM deployment and private credential setup](docs/coffee-deployment.md).
After setup, the VM needs only the project's Node dependencies—no Waydroid,
Python, `qrencode` executable, or Pret API request. PNG rendering uses
[`qrcode`](https://github.com/soldair/node-qrcode).

This command follows the bot's existing access model: anyone able to invoke the
bot can request the configured wallet's QR, including in groups. Keep the bot
in chats where you intend to share that wallet. The configuration and QR images
should be treated as private. The implementation reproduces the inspected
Android app's device-time dynamic QR algorithm; live app comparison and till
acceptance remain unverified.

## Daily NASA post

At **09:00 Europe/London** every day, the running bot posts NASA's Astronomy
Picture of the Day to the group configured by `NASA_GROUP_JID`. GMT/BST changes are automatic,
regardless of the server's timezone. Posts include the title, date, full NASA
explanation, source link, and credit when supplied. Video/iframe days send the
APOD page link and description instead of an image. NASA posts are permanent:
they bypass the bot's one-hour deletion queue.

Send `nasa` (any capitalization) for a random image from NASA's Image and
Video Library. It chooses from nebula, galaxy, Jupiter, Saturn, Moon, Earth,
astronaut, Artemis, Hubble, James Webb, and rocket launch topics. Add search
words to choose your own subject:

```text
nasa galaxy
nasa astronaut
nasa earth
nasa artemis
nasa rocket launch
```

Searches return a random image from up to the first five pages of matching
results, with its title, description, and source link. Queries can be up to 200
characters. This command needs no NASA API key and does not affect the daily
APOD schedule. Successful manual NASA posts are permanent too; error replies
follow the normal one-hour deletion policy.

One sleeping Node timer schedules the next morning; there is no polling loop,
external cron job, extra WhatsApp session, or last-posted file. Reconnecting does
not create another timer. Run only one bot instance. The bot and WhatsApp
connection must be available at 09:00: failed posts are logged and skipped,
with no catch-up or retries until the following morning. A timer delayed by a
suspended machine by a minute or more is also skipped. Restarting after 09:00
schedules tomorrow's post.

Set both values in your private, gitignored `.env` (blank examples are also in
`.env.example`):

```dotenv
NASA_GROUP_JID=
NASA_API_KEY=
```

Enter your target group's ID and your own key from [NASA](https://api.nasa.gov/).
There is no default group or API key. Daily posts stay disabled until both are
configured with a valid group ID; the manual `nasa` command needs neither value.
Never commit your populated `.env` or put real IDs/keys in `.env.example`. API requests and image downloads have 30-second timeouts;
images have a 16 MiB download limit. Restart the bot after deploying these files
or changing configuration. No test post is sent on startup.

### Diagnose the daily NASA job

Run these in the project directory on the machine that hosts the bot, after
deploying the updated files. Configuration checks do not connect to WhatsApp:

```sh
npm start -- --nasa-check-config
```

This prints whether the API key is present and the group ID has valid syntax,
plus current UK time and the next 09:00 slot. It does not print the key or ID.
A valid format alone does not prove that the group exists or the bot belongs to it.

**Stop the existing bot before running any of the following commands**, since
they open the same WhatsApp session. Run one command at a time; press Ctrl+C
before switching commands. They remain running as the bot after the diagnostic.

```sh
npm start -- --nasa-check-group
npm start -- --nasa-test-group
npm start -- --nasa-test-trigger
```

- `--nasa-check-group`: checks the configured ID against groups this account
  belongs to, and prints the matching group name and posting restriction. Sends
  no diagnostic message.
- `--nasa-test-group`: performs that check, then sends a permanent plain-text
  test message to the configured group, without calling NASA. Confirm it appears
  in the intended group to check the destination and posting permissions.
- `--nasa-test-trigger`: checks membership, then starts a 10-second timer after
  connecting. It uses the same timer callback and APOD posting path as the daily
  job and sends a permanent APOD post. Afterward it schedules the next 09:00 job.

Normal startup now logs the next scheduled time. At trigger time, logs distinguish
timer firing, APOD fetching, sending, disconnection, and failures. Missed jobs
still do not catch up: a bot started after 09:00 waits until the following day.
Restore your normal service after finishing diagnostics; remove test flags from
its startup command to avoid sending another test after every restart.

## Automatic reply deletion

Every command reply except successful NASA posts is scheduled for deletion for everyone one hour later, including GIFs and error replies. The bot stores only the message references and deletion times in `scheduled-deletions.json`, so it can finish the job after a restart; this is not a database. If WhatsApp is temporarily disconnected at the scheduled time, the bot retries after it reconnects.

WhatsApp replaces a deleted message with a visible “This message was deleted” notice. It cannot undo screenshots, forwards, or media that a recipient already saved.

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
- **No reply:** send from a different account, use `gif funny cat`, `tfl hammersmith`, `tfl hammersmith to south kensington`, `tfl boat westminster`, `tfl crowd southkensington`, or `tfl status richmond`, and check the terminal says Connected. In groups, the spare account must be a member and allowed to send messages. `gift` is not a command. The terminal logs message event counts without their content: `own=1` means the message came from the bot's own account and is ignored. `GIF request received`, `TfL departure request received`, `TfL journey request received`, `TfL river-bus request received`, `TfL crowding request received`, or `TfL status request received` means the command matched.
- **TfL cannot find a station:** use a fuller station name. Short forms can be ambiguous. Add `line <name>` only after the station name, for example `tfl hammersmith line district`.
- **Linked device says Google Chrome (Mac OS) on Linux:** this is Baileys' default client identification, not a detected operating system or a real browser. No Chrome process is launched. This label does not prevent receiving messages.
- **Warning about disabling initial LID mapping sync:** update to this version and restart. The bot now allows Baileys' default initial sync. If an already-paired session still has mapping/decryption errors, follow the credential-backup and re-pair steps below to obtain a fresh initial sync.
- **GIPHY rejects the key:** check the key in your developer dashboard and `.env`. A rate-limit reply means wait before trying again. No results means try another phrase. Download or send errors can usually be retried.
- **Disconnected:** leave the bot running for temporary network problems; it reconnects automatically. If another connection replaced it (code 440), stop duplicate bot processes and restart this one.
- **Logged out / invalid session (such as 401, 403, 411, or 500):** stop the bot. Check the account works on the phone and remove the stale linked device if present. Rename `auth/` to `auth-backup/`, then restart and scan a new QR. This preserves the old files while creating fresh credentials. If WhatsApp restricts the account, resolve that on the phone first.
- **Credential or disk errors:** make sure this project folder is writable and there is free disk space.
- **Temporary files left after a crash or power loss:** stop the bot and delete the project's `tmp/` folder using your file manager. It is recreated on startup. Normal success and failure paths clean up automatically.

`.gitignore` excludes `.env`, authentication folders, `node_modules/`, `tmp/`, and the scheduled-deletion file. Do not share QR codes or credential backups either. Baileys is an unofficial WhatsApp client; use a spare account and keep usage modest because accounts can be restricted.

You can check JavaScript syntax without connecting to WhatsApp:

```sh
npm run check
```
