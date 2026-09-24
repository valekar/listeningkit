# OpenMagpie ACP bridge

This host-side package lets OpenMagpie use either Codex or Claude for
semantic filtering and extraction. OpenMagpie speaks an OpenAI-compatible `/v1`
API; this bridge translates each request into one Agent Client Protocol (ACP)
session. It exposes two model IDs: `codex-acp` and `claude-acp`.

The bridge runs on the host so the ACP adapters can use the host user's Codex
and Claude authentication. Source text sent for scoring reaches the selected
provider. It does not require an OpenAI or Anthropic API key when the agent is
already authenticated through its supported account login.

## Install and run

Requires Node.js 22 or newer. From this directory:

```sh
npm ci --ignore-scripts
codex login status
claude auth status
```

Create an ignored `.env` in this directory with a random token of at least 32
characters, then run the server:

```sh
OPENMAGPIE_ACP_BIND=127.0.0.1
OPENMAGPIE_ACP_PORT=3182
OPENMAGPIE_ACP_TOKEN=<random-token>
```

```sh
node --env-file=.env src/cli.mjs
```

The bridge binds to loopback and requires the bearer token for both `/v1`
routes. Docker Desktop on macOS can reach this loopback listener through
`host.docker.internal`. The unauthenticated `/healthz` route reports only that
the bridge process is alive.

For a macOS login service, run `npm run service:install` after creating `.env`.
Use `npm run service:remove` to stop and remove it. The service does not poll
sources on its own.

## Point OpenMagpie at the bridge

Set these values in `apps/core/.env` and recreate only the `core` container:

```sh
ENGINE_BASE_URL=http://host.docker.internal:3182/v1
ENGINE_API_KEY=<same-random-token>
ENGINE_MODEL=codex-acp
```

```sh
docker compose up -d --no-deps --force-recreate core
make local-manage CMD="engine_status"
```

The default watch uses `codex-acp`. To select Claude for one semantic filter or
extract action, set `config.engine.model: claude-acp` in that action's YAML and
apply it with `magpie watch action edit <action-id> -f <file> --yes`. Both model
IDs appear in `/v1/models` and work through the existing OpenMagpie engine.
Run `make local-tick` for one manual feed/watch pass, then use
`magpie activity list --action <action-id>` to review scores. A manual tick
polls only feeds whose configured interval has elapsed.

## Behavior and limits

- Each request starts a fresh ACP process and empty temporary working directory.
  No MCP servers or file capabilities are offered. Claude's built-in tools are
  disabled for the session; Codex starts in read-only mode. Permission requests
  are denied, and any observed tool call causes the request to fail. This keeps
  the bridge focused on classification, but the agents still run under your host
  account, so only use it with providers and source data you trust.
- The bridge accepts OpenMagpie's `json_schema` response format and checks the
  returned JSON before passing it back. Agent models do not provide the same
  strict structured-output guarantee as a direct API. A malformed response
  fails the action and can be retried by OpenMagpie.
- ACP model selection uses each agent's configured default model. The bridge
  does not choose a particular Codex or Claude model version. The `temperature`
  parameter from OpenMagpie is not enforced by ACP agents.
- A request has a 120-second timeout, and only one request per provider runs at
  once. Provider usage counts against that provider's authenticated account or
  API billing arrangement.
- The app's source poller and watch scheduler are unchanged. Starting this
  bridge does not start recurring scans or publish anything.

## Choose the default ACP agent

From this package directory, use the selector to inspect or change the live
ListeningKit default:

```sh
npm run provider -- status
npm run provider -- use codex
npm run provider -- use claude
```

The selector changes only `ENGINE_MODEL` in `apps/core/.env`, restarts the core
container, and confirms its engine status. It keeps the local bridge token
private. Actions with an explicit `config.engine.model` remain pinned to that
agent; actions using the default, including the current BestProp watch, follow
the selection. Choosing a provider does not rescore past items or start a scan.

In this Codex conversation, say "use Codex ACP for ListeningKit" or "use Claude
ACP for ListeningKit" and I can run the same selector for you. This setting
controls ListeningKit scoring, not the model answering this chat.
