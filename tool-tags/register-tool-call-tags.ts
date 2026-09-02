import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerBashTool } from "./bash.js";
import { registerEditTool } from "./edit.js";
import { registerFindTool } from "./find.js";
import { registerGrepTool } from "./grep.js";
import { registerLsTool } from "./ls.js";
import { registerReadTool } from "./read.js";
import { registerWriteTool } from "./write.js";

export async function registerToolCallTags(pi: ExtensionAPI): Promise<void> {
	await Promise.all([
		registerReadTool(pi),
		registerWriteTool(pi),
		registerEditTool(pi),
		registerLsTool(pi),
		registerFindTool(pi),
		registerGrepTool(pi),
		registerBashTool(pi),
	]);
}
