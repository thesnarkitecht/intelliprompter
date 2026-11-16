# Intelliprompter

Talk through your checklist; items tick themselves off as you say them.

![Intelliprompter](docs/screenshot.png)

Your browser transcribes the microphone live. Every 5 seconds, the text spoken
since the last check (not the whole transcript) goes to [Jev](https://typesafe.ai),
TypeSafe AI's decision model. Jev answers one yes/no question per open item:
*"has the speaker started talking about this?"*. Items Jev is confident about get
checked, so you only need to start on a topic. The next open item is highlighted.

## Setup (1 minute)

Needs Node.js 22.9+ and a TypeSafe API key (from the TypeSafe API console). There are no dependencies to install.

Install and start (installs to `~/intelliprompter`; re-run it to update):

```bash
curl -fsSL https://raw.githubusercontent.com/thesnarkitecht/intelliprompter/main/install.sh | sh
```

Then, from anywhere:

```bash
intelliprompter serve
```

```bash
intelliprompter stop
```

`serve` runs it in the background at http://localhost:9070; `stop` shuts it down.
The installer puts the `intelliprompter` command in `~/.local/bin` and tells you if that folder needs adding to your `PATH`.

Logs go to `~/intelliprompter/server.log`. To run in the foreground instead, use `npm start` inside the folder.

Open http://localhost:9070. Settings opens on first run: paste your TypeSafe API key there (you can change it later under **Settings · API key**).

To keep the key on the server instead, copy `.env.example` to `.env` and set
`TYPESAFE_API_KEY`. That key then takes precedence over one pasted in the browser.

## Using it

- **Edit list**: one item per line; indent a line (space or tab) to make it a sub-item,
  and indent further for sub-sub-items (any depth). A parent is checked automatically
  when everything under it is.
- **Start recording**: speak. Use Chrome, Edge or Safari (Firefox has no built-in speech recognition).
  You can also type lines into the box under the transcript.
- Click any item to check or uncheck it yourself. Clicking a parent toggles everything under it.
- **Settings**: confidence threshold (default 70%) and speech language.
- **Reset**: unchecks everything and clears the transcript.

The list, checks and transcript are saved in your browser.

## Config (env vars)

| Variable | Default |
|---|---|
| `TYPESAFE_API_KEY` | none (use the Settings key) |
| `JEV_MODEL` | `jev-latest` |
| `PORT` | `9070` |
| `TYPESAFE_API_URL` | `https://api.typesafe.ai/v1/systemone` |

## Develop

`npm test` checks the outline parser, the Jev request and response handling, and the server proxy against a fake Jev.

Files: `server.js` (static files + `/api/check` proxy), `public/core.js` (pure logic),
`public/app.js` (UI + speech), `public/style.css`.

## Privacy notes

- In Chrome and Edge, the browser's speech recognition sends audio to the browser vendor's servers.
- Only new snippets of text (the last 5 seconds, plus up to 200 characters of overlap so split sentences still read whole) go to TypeSafe, through your local server.
- A key pasted in Settings is stored in this browser's localStorage.
