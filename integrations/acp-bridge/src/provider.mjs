export const PROVIDER_MODELS = Object.freeze({
  codex: "codex-acp",
  claude: "claude-acp",
});

export function modelForProvider(value) {
  const provider = value?.toLowerCase();
  if (provider in PROVIDER_MODELS) return PROVIDER_MODELS[provider];
  if (Object.values(PROVIDER_MODELS).includes(provider)) return provider;
  throw new Error("Choose codex or claude");
}

export function envValue(source, key) {
  let value;
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(new RegExp(`^${key}=(.*)$`));
    if (match) value = match[1].replace(/^(['"])(.*)\1$/, "$2");
  }
  return value;
}

export function setDefaultModel(source, model) {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  let replaced = false;
  const next = lines.filter((line) => {
    if (!/^ENGINE_MODEL=/.test(line)) return true;
    if (replaced) return false;
    replaced = true;
    return true;
  });
  if (replaced) {
    const index = next.findIndex((line) => /^ENGINE_MODEL=/.test(line));
    next[index] = `ENGINE_MODEL=${model}`;
  } else {
    if (next.at(-1) === "") next.pop();
    next.push(`ENGINE_MODEL=${model}`, "");
  }
  return next.join(eol);
}
