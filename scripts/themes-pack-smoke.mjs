#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const themesDir = join(repoRoot, "themes");
const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

assert(manifest.name === "@ferris1225/pi-droid-ui", `unexpected package name: ${manifest.name}`);
assert(Array.isArray(manifest.pi?.themes) && manifest.pi.themes.includes("./themes"), "package must declare pi.themes");
assert(Array.isArray(manifest.pi?.extensions) && manifest.pi.extensions.includes("./dist/index.js"), "package must declare bundled extension");

const files = readdirSync(themesDir).filter((file) => file.endsWith(".json")).sort();
assert(files.length === 26, `expected 26 theme files, got ${files.length}`);

const names = files.map((file) => {
	const parsed = JSON.parse(readFileSync(join(themesDir, file), "utf8"));
	assert(typeof parsed.name === "string" && parsed.name.length > 0, `theme missing name: ${file}`);
	return parsed.name;
});
assert(new Set(names).size === 26, "bundled theme names should be unique");
assert(names.includes("qoder-cli"), "qoder-cli theme should be present");

console.log(`themes pack smoke ok: ${files.length} files, ${names.length} names`);
