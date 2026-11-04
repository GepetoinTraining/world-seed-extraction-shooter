/**
 * SETTING UP A MODEL ON THE PLAYER'S MACHINE (Pedro, 2026-11-04: "We simply do what every vendor
 * does, make a prompt to send to the local code model they have... we can script and teach the
 * player how to install and allow the agent to help them").
 *
 * Three ways, one set of steps: install Ollama, pull the model the check suggests, allow this
 * game's own origin in OLLAMA_ORIGINS (that origin only, never `*`), restart Ollama, and press TRY.
 *   - a prompt for whatever coding agent the player already has, shown in full before it is copied;
 *   - a plain script per system, readable before it runs, which runs only when the player starts it;
 *   - free agents, listed as data beside the door's options (agents.json), for a player with none.
 *
 * Nothing here runs anything. It writes text.
 */

export type SetupSystem = 'windows' | 'macos' | 'linux';

export interface ISetupAsk {
  /** This game's own origin, from configuration: the only one Ollama is told to answer. */
  origin: string;
  /** The model the check suggests for this machine. */
  model: string;
}

/** An origin Ollama may be told to answer: one exact scheme, host and port, never a wildcard. */
export function originProblem(origin: string): string | null {
  if (!origin || /[*\s,]/.test(origin)) return 'An origin is one exact address, with no wildcard, space or comma.';
  try {
    const url = new URL(origin);
    if (url.origin !== origin.replace(/\/+$/, '')) return 'An origin is a scheme, a host and a port only, with no path.';
    if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) return 'A public origin is https.';
    return null;
  } catch {
    return 'That is not an address.';
  }
}

const clean = (ask: ISetupAsk) => {
  const problem = originProblem(ask.origin);
  if (problem) throw new Error(problem);
  if (!/^[\w.:/-]+$/.test(ask.model)) throw new Error('That model name has characters a command line would misread.');
  return { origin: ask.origin.replace(/\/+$/, ''), model: ask.model };
};

/** The prompt a player pastes into their own coding agent. It asks the agent to show before it acts. */
export function setupPrompt(ask: ISetupAsk): string {
  const { origin, model } = clean(ask);
  return [
    'Please set up a local AI model on this computer for a browser game, World Seed. Work step by step, show me each command before you run it, and stop to ask me if anything is unclear or needs administrator rights.',
    '',
    '1. Find out which operating system this is.',
    '2. Install Ollama if it is not installed, from https://ollama.com/download (on Linux, its official install script; on Windows, the installer or `winget install Ollama.Ollama`; on macOS, the app).',
    `3. Download this model: \`ollama pull ${model}\``,
    `4. Allow the game's page to reach Ollama by setting the environment variable OLLAMA_ORIGINS to exactly \`${origin}\`. Allow only that origin: never \`*\`, and no other site. If OLLAMA_ORIGINS already holds other origins, keep them and add this one, separated by a comma.`,
    '   - Windows: set it as a user environment variable.',
    '   - macOS: `launchctl setenv OLLAMA_ORIGINS "<value>"`.',
    '   - Linux with systemd: an override for the ollama service, with `Environment="OLLAMA_ORIGINS=<value>"`, then `systemctl daemon-reload`.',
    '5. Restart Ollama so it reads the new setting, and check it answers at http://127.0.0.1:11434.',
    '6. Tell me it is done, and that I should go back to the game, open SYSTEM, THE VOICE, and press TRY on the model.',
    '',
    'Do not change anything else on this computer.'
  ].join('\n');
}

/** Windows PowerShell. Run as the player, by the player: nothing in it runs until they start it. */
export function windowsScript(ask: ISetupAsk): string {
  const { origin, model } = clean(ask);
  return `# World Seed: a local model for the game, on Windows.
# Read it before you run it. It installs Ollama if it is missing, downloads one model,
# lets only this game's page (${origin}) reach Ollama, and restarts Ollama.
#   powershell -ExecutionPolicy Bypass -File .\\world-seed-local-model.ps1
param([string]$Origin = '${origin}', [string]$Model = '${model}')
$ErrorActionPreference = 'Stop'
if ($Origin -match '[*\\s,]') { throw 'The origin must be one exact address, never a wildcard.' }

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing Ollama with winget...'
  winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

$held = [Environment]::GetEnvironmentVariable('OLLAMA_ORIGINS', 'User')
$origins = @($held -split ',' | Where-Object { $_ -and $_ -ne '*' })
if ($origins -notcontains $Origin) { $origins += $Origin }
[Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', ($origins -join ','), 'User')
$env:OLLAMA_ORIGINS = ($origins -join ',')
Write-Host "OLLAMA_ORIGINS is now: $env:OLLAMA_ORIGINS"

Write-Host 'Restarting Ollama...'
Get-Process -Name 'ollama', 'ollama app' -ErrorAction SilentlyContinue | Stop-Process -Force
$app = Join-Path $env:LOCALAPPDATA 'Programs\\Ollama\\ollama app.exe'
if (Test-Path $app) { Start-Process $app } else { Start-Process ollama -ArgumentList 'serve' -WindowStyle Hidden }
Start-Sleep -Seconds 3

Write-Host "Downloading $Model..."
ollama pull $Model
Write-Host 'Done. Go back to the game: SYSTEM, THE VOICE, and press TRY.'
`;
}

/** macOS and Linux shell. Same steps; on Linux the setting goes into the service, which needs sudo. */
export function unixScript(ask: ISetupAsk): string {
  const { origin, model } = clean(ask);
  return `#!/bin/sh
# World Seed: a local model for the game, on macOS or Linux.
# Read it before you run it. It installs Ollama if it is missing, downloads one model,
# lets only this game's page (${origin}) reach Ollama, and restarts Ollama.
#   sh world-seed-local-model.sh
set -eu
ORIGIN="\${1:-${origin}}"
MODEL="\${2:-${model}}"
case "$ORIGIN" in *'*'*|*,*|*' '*) echo 'The origin must be one exact address, never a wildcard.' >&2; exit 1;; esac

join_origins() {
  printf '%s' "$1" | tr ',' '\\n' | grep -v -e '^$' -e '^\\*$' | grep -v -x -F "$ORIGIN" | tr '\\n' ',' | sed 's/,$//'
}

if [ "$(uname -s)" = "Darwin" ]; then
  if ! command -v ollama >/dev/null 2>&1 && [ ! -d /Applications/Ollama.app ]; then
    echo 'Install Ollama from https://ollama.com/download first, then run this again.'; exit 1
  fi
  HELD="$(launchctl getenv OLLAMA_ORIGINS || true)"
  KEPT="$(join_origins "$HELD")"
  VALUE="\${KEPT:+$KEPT,}$ORIGIN"
  launchctl setenv OLLAMA_ORIGINS "$VALUE"
  echo "OLLAMA_ORIGINS is now: $VALUE"
  echo 'Restarting Ollama...'
  osascript -e 'quit app "Ollama"' 2>/dev/null || true
  sleep 2
  open -a Ollama
else
  if ! command -v ollama >/dev/null 2>&1; then
    echo 'Installing Ollama with its official script (it asks for sudo)...'
    curl -fsSL https://ollama.com/install.sh | sh
  fi
  DIR=/etc/systemd/system/ollama.service.d
  HELD="$(sed -n 's/^Environment="OLLAMA_ORIGINS=\\(.*\\)"$/\\1/p' "$DIR/world-seed.conf" 2>/dev/null || true)"
  KEPT="$(join_origins "$HELD")"
  VALUE="\${KEPT:+$KEPT,}$ORIGIN"
  sudo mkdir -p "$DIR"
  printf '[Service]\\nEnvironment="OLLAMA_ORIGINS=%s"\\n' "$VALUE" | sudo tee "$DIR/world-seed.conf" >/dev/null
  echo "OLLAMA_ORIGINS is now: $VALUE"
  echo 'Restarting Ollama...'
  sudo systemctl daemon-reload
  sudo systemctl restart ollama
fi
sleep 3
echo "Downloading $MODEL..."
ollama pull "$MODEL"
echo 'Done. Go back to the game: SYSTEM, THE VOICE, and press TRY.'
`;
}

/** The system a browser says it is on, for which script to show first. Any can be picked. */
export function systemOf(userAgent: string): SetupSystem {
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(userAgent)) return 'macos';
  return 'linux';
}
