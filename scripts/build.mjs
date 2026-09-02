import { build } from "esbuild";

await build({
	entryPoints: ["index.ts"],
	bundle: true,
	format: "esm",
	platform: "node",
	outfile: "dist/index.js",
	packages: "external",
	legalComments: "none",
	logLevel: "info",
});
