# Private WhatsApp bot

A Node.js bot for GIFs, TfL departures and journeys, coffee QR codes, NASA pictures, and shared counters. Uses Baileys without a browser.

## Setup

1. Install [Node.js](https://nodejs.org/en/download) (version 22 or newer). npm is included.
2. Open a terminal in this project folder and run:

   ```sh
   npm install
   ```

3. Create `.env` beside `index.js`. Get an API key from [GIPHY Developers](https://developers.giphy.com/) and add:

   ```dotenv
   GIPHY_API_KEY=your_key_here
   ```

4. Run `npm start`. On the spare account's phone, open **WhatsApp → Linked devices → Link a device** and scan the terminal QR.
5. Wait for **Connected**, then send `gif funny cat` from a different account. For groups, add the bot account first.

Credentials are saved in `auth/`; restarts normally need no new QR. Keep the process running and run only one instance. Press Ctrl+C to stop.

## Commands

Commands start at the beginning of the message and are case-insensitive. The bot ignores its own messages.

| Command | What it does |
| --- | --- |
| `gif funny cat` | Random GIF matching the search |
| `tfl help` | Short TfL command list |
| `tfl hammersmith` | Next rail departures |
| `tfl hammersmith line district` | Departures filtered by line |
| `tfl hammersmith to south kensington` | Journey with times and changes |
| `tfl line` / `tfl line district` | Network summary / detailed line status |
| `tfl status richmond` | Disrupted lines serving a station |
| `tfl crowd south kensington` | Crowding compared with the usual level |
| `tfl boat westminster` | River-bus departures; no boat routing |
| `coffee` | Fresh QR with today's use count |
| `coffee used` | Record a drink and start the 30-minute cooldown |
| `coffee count` | Show today's recorded drinks |
| `nasa` / `nasa galaxy` | Random NASA image / search by topic |
| `<counter>` / `<counter> Ben` | Increment the global / named counter |
| `<counter> leaderboard` | Total, global count, and ranked names |

The counter keyword is `STUPID_COMMAND` near the top of [stupid.js](stupid.js); replace `<counter>` with that value. Names are case-insensitive. Total = global + all named counts.

TfL supports Tube, Elizabeth line, Overground, and DLR. Use full station names if a search is ambiguous. Line aliases include `hc`, `h&c`, and `picadilly`.

## Optional configuration

Add these to `.env` as needed, then restart:

```dotenv
TFL_APP_KEY=
NASA_API_KEY=
NASA_GROUP_JID=
BOT_ADMINS=
```

TfL works without a key. Daily NASA posts require a [NASA API key](https://api.nasa.gov/) and the destination group's WhatsApp ID. Manual `nasa` searches need neither.

For coffee, put `PRET_PUBLIC_ID` and `PRET_QR_SIGNING_KEY` in private `.env.coffee`. See [coffee deployment instructions](docs/coffee-deployment.md). The configured wallet is available to anyone allowed to use the bot.

## Admin commands

Set `BOT_ADMINS` to comma-separated international phone numbers with country codes, e.g. `447700900123,447700900456`. WhatsApp IDs ending in `@s.whatsapp.net` or `@lid` also work. Group-admin status alone does not grant bot access.

- `clear <name>` removes a named counter and its contribution to the total.
- `ban @person` blocks every bot command for that person across chats.
- `unban @person` restores access.

Use WhatsApp's mention menu to select exactly one person. An empty admin list disables these commands.

## Coffee and NASA behaviour

Coffee allows five recorded drinks per UK calendar day. At 5/5, QR requests are blocked until tomorrow. During the 30-minute cooldown, `coffee` warns but still sends the QR; only `coffee used` changes the count and cooldown.

After requesting a QR outside cooldown, send `coffee used` within five minutes. A private reminder arrives halfway through. Three missed deadlines cause a coffee-only ban; strikes survive restarts and daily resets.

Daily NASA APOD posts run at **09:00 UK time**, with same-day catch-up after a restart. API or delivery failures retry every five minutes. Images have a 48 MiB download limit; failed attachments fall back to a text description and link.

## Running and troubleshooting

For the existing PM2 deployment:

```sh
pm2 restart whatsapp-gif-bot --update-env
pm2 logs whatsapp-gif-bot --lines 100
```

- **No reply:** use another WhatsApp account, check the connection logs, and check whether the sender is banned.
- **Missing key:** check `.env` is beside `index.js`, then restart.
- **Logged out:** stop the bot, rename `auth/` to `auth-backup/`, restart, and pair again.
- **NASA configuration:** run `npm start -- --nasa-check-config`; it does not connect or send anything.
- **Editing counts manually:** stop the bot, back up and edit `stupid-counters.json`, then restart.

Keep `.env*`, `auth/`, and state JSON files private and preserve them when deploying. Normal replies auto-delete after one hour; NASA image posts and scheduled APOD posts remain. Bans, counters, coffee usage, and deletion schedules persist across restarts.

## Code

`index.js` handles startup and WhatsApp; `commands.js` routes commands. Features live in `tfl.js`, `gif.js`, `nasa.js`, `coffee*.js`, `stupid.js`, and `admin.js`. Reply cleanup lives in `message-deletion.js`.

Run `npm run check` to check all JavaScript syntax. Baileys is an unofficial WhatsApp client; use a spare account.
