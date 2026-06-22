#!/usr/bin/env node
/**
 * scripts/register-agent.js
 *
 * Command-line registration for Bluffline agents (bots). Registers a wallet-less
 * agent identity against the HTTP API and prints back the agent id + API key you
 * plug into your bot. Humans register through the web app (wallet signature);
 * this command is for `rule_based`, `llm`, and `hybrid` agents.
 *
 * Usage:
 *   node scripts/register-agent.js --name "My Bot" --type rule_based
 *   node scripts/register-agent.js -n "My Bot" -t llm --api https://<host>/v1
 *
 * Positional form (handy via `npm run register`, which eats --flags):
 *   npm run register -- "My Bot" rule_based
 *
 * The API base URL defaults to $BLUFFLINE_API_URL, then http://localhost:3001/v1.
 */

const AGENT_TYPES = ["rule_based", "llm", "hybrid"];
const DEFAULT_API = process.env.BLUFFLINE_API_URL || "http://localhost:3001/v1";

function printHelp() {
  console.log(`
Register a Bluffline agent and receive an API key.

Usage:
  node scripts/register-agent.js --name <name> [--type <type>] [--api <url>]

Options:
  -n, --name   Agent display name (1-64 chars). Required.
  -t, --type   Agent type: ${AGENT_TYPES.join(" | ")}. Default: rule_based.
  -a, --api    API base URL. Default: $BLUFFLINE_API_URL or ${DEFAULT_API}
  -h, --help   Show this help.

Examples:
  node scripts/register-agent.js --name "Escalator 9000" --type rule_based
  npm run register -- "Escalator 9000" rule_based
`);
}

/**
 * Tiny parser supporting --flag value, -f value, --flag=value, and bare
 * positionals (name then type). Positionals make this work through
 * `npm run register`, which otherwise swallows --flags.
 */
function parseArgs(argv) {
  const aliases = { n: "name", t: "type", a: "api", h: "help" };
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (!arg.startsWith("-")) {
      out._.push(arg);
      continue;
    }
    arg = arg.replace(/^--?/, "");
    let value;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      value = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    const key = aliases[arg] || arg;
    if (key === "help") {
      out.help = true;
      continue;
    }
    if (value === undefined) {
      value = argv[i + 1];
      i++;
    }
    out[key] = value;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const name = (args.name ?? args._[0] ?? "").trim();
  const type = (args.type ?? args._[1] ?? "rule_based").trim();
  const apiBase = (args.api || DEFAULT_API).replace(/\/$/, "");

  if (!name) {
    console.error("Error: --name is required.\n");
    printHelp();
    process.exitCode = 1;
    return;
  }
  if (name.length > 64) {
    console.error("Error: --name must be at most 64 characters.");
    process.exitCode = 1;
    return;
  }
  if (!AGENT_TYPES.includes(type)) {
    console.error(
      `Error: --type must be one of ${AGENT_TYPES.join(", ")} ` +
        `(humans register via the web app with a wallet).`
    );
    process.exitCode = 1;
    return;
  }

  const url = `${apiBase}/agents/register`;
  console.log(`Registering "${name}" (${type}) at ${url} ...`);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_name: name, agent_type: type }),
    });
  } catch (err) {
    console.error(`\nCould not reach the API at ${apiBase}.`);
    console.error("Is the backend running? (npm run dev, or set --api / $BLUFFLINE_API_URL)");
    console.error(`Details: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = body?.error?.message || `Request failed with status ${response.status}`;
    console.error(`\nRegistration failed: ${message}`);
    process.exitCode = 1;
    return;
  }

  const { agent_id, api_key, username, starting_elo } = body;
  console.log("\n✓ Agent registered.\n");
  console.log(`  Name:        ${username || name}`);
  console.log(`  Agent ID:    ${agent_id}`);
  console.log(`  API key:     ${api_key}`);
  console.log(`  Starting ELO: ${starting_elo}`);
  console.log("\nSave the API key now — it is shown only once and authenticates your agent.\n");
  console.log("Next: point a bot at a table using the key, e.g.");
  console.log(`  BLUFFLINE_API_KEY=${api_key} node agents/rule-based-agent.js ${apiBase} ws://localhost:8080/v1/ws`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exitCode = 1;
});
