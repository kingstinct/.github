#!/usr/bin/env bun
/**
 * Validates that all local plugins with .claude-plugin directories
 * are listed in the marketplace.json file.
 */

import { readdir, exists } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";

// Script is in .github/scripts/, so root is parent directory
const ROOT_DIR = dirname(import.meta.dirname);
const MARKETPLACE_PATH = join(ROOT_DIR, ".claude-plugin", "marketplace.json");

async function findLocalPlugins(): Promise<string[]> {
  const entries = await readdir(ROOT_DIR, { withFileTypes: true });
  const plugins: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const pluginConfigPath = join(ROOT_DIR, entry.name, ".claude-plugin", "plugin.json");
    if (await exists(pluginConfigPath)) {
      plugins.push(entry.name);
    }
  }

  return plugins.sort();
}

async function getMarketplacePlugins(): Promise<string[]> {
  const marketplace = await Bun.file(MARKETPLACE_PATH).json();
  return marketplace.plugins
    .filter((p: { source: string | object }) => typeof p.source === "string" && p.source.startsWith("./"))
    .map((p: { source: string }) => p.source.replace("./", ""))
    .sort();
}

async function main() {
  const localPlugins = await findLocalPlugins();
  const marketplacePlugins = await getMarketplacePlugins();

  const missing = localPlugins.filter((p) => !marketplacePlugins.includes(p));
  const extra = marketplacePlugins.filter((p) => !localPlugins.includes(p));

  let hasErrors = false;

  if (missing.length > 0) {
    console.error("❌ Local plugins missing from marketplace.json:");
    for (const plugin of missing) {
      console.error(`   - ${plugin}`);
    }
    hasErrors = true;
  }

  if (extra.length > 0) {
    console.error("❌ Plugins in marketplace.json without local directory:");
    for (const plugin of extra) {
      console.error(`   - ${plugin}`);
    }
    hasErrors = true;
  }

  if (hasErrors) {
    console.error("\nPlease update .claude-plugin/marketplace.json to match local plugins.");
    process.exit(1);
  }

  console.log(`✅ All ${localPlugins.length} local plugins are in marketplace.json`);
}

main();
