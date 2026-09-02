// index.ts
import {
  AssistantMessageComponent as AssistantMessageComponent2,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  InteractiveMode,
  SkillInvocationMessageComponent,
  ToolExecutionComponent as ToolExecutionComponent3
} from "@earendil-works/pi-coding-agent";

// tool-tags/bash.ts
import { createBashTool, highlightCode } from "@earendil-works/pi-coding-agent";

// render-budget.ts
import { truncateToWidth as tuiTruncateToWidth, visibleWidth as tuiVisibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// performance/profiler.ts
import { Buffer as Buffer2 } from "node:buffer";
import { appendFileSync } from "node:fs";
import { monitorEventLoopDelay, performance as performance2 } from "node:perf_hooks";
var PROFILE_STATE = Symbol.for("pi-droid-styling.profiler.state");
var DEFAULT_INTERVAL_MS = 5e3;
var MIN_INTERVAL_MS = 250;
var TRUE_VALUES = /* @__PURE__ */ new Set(["1", "true", "yes", "on"]);
function envFlag(name) {
  return TRUE_VALUES.has(String(process.env[name] ?? "").trim().toLowerCase());
}
function envIntervalMs() {
  const value = Number(process.env.PI_DROID_PROFILE_INTERVAL_MS);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.floor(value));
}
function round(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
function mb(bytes) {
  return round(bytes / 1024 / 1024, 2);
}
function nowMs() {
  return performance2.now();
}
function createState() {
  return {
    enabled: envFlag("PI_DROID_PROFILE"),
    intervalMs: envIntervalMs(),
    out: String(process.env.PI_DROID_PROFILE_OUT ?? "stderr").trim() || "stderr",
    lastFlushAt: nowMs(),
    counters: /* @__PURE__ */ new Map(),
    samples: /* @__PURE__ */ new Map(),
    exitHandlerInstalled: false
  };
}
function getState() {
  const host = globalThis;
  if (!host[PROFILE_STATE]) host[PROFILE_STATE] = createState();
  return host[PROFILE_STATE];
}
var state = getState();
function ensureReporter() {
  if (!state.enabled) return;
  if (!state.lastCpuUsage) {
    state.lastCpuUsage = process.cpuUsage();
  }
  if (!state.lastEventLoopUsage) {
    try {
      state.lastEventLoopUsage = performance2.eventLoopUtilization();
    } catch {
      state.lastEventLoopUsage = void 0;
    }
  }
  if (!state.loopDelay) {
    try {
      state.loopDelay = monitorEventLoopDelay({ resolution: 20 });
      state.loopDelay.enable();
    } catch {
      state.loopDelay = void 0;
    }
  }
  if (!state.reporter) {
    state.reporter = setInterval(() => flushProfile("interval"), state.intervalMs);
    state.reporter.unref?.();
  }
  if (!state.exitHandlerInstalled) {
    state.exitHandlerInstalled = true;
    process.once("exit", () => flushProfile("exit"));
  }
}
function sampleSummary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const percentile = (percent) => {
    if (count === 0) return 0;
    const index = Math.min(count - 1, Math.max(0, Math.ceil(percent / 100 * count) - 1));
    return sorted[index] ?? 0;
  };
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count,
    avg: round(sum / Math.max(1, count)),
    p50: round(percentile(50)),
    p95: round(percentile(95)),
    max: round(sorted[count - 1] ?? 0)
  };
}
function writeRecord(record) {
  const line = `${JSON.stringify(record)}
`;
  if (state.out === "stderr") {
    process.stderr.write(line);
    return;
  }
  if (state.out === "stdout") {
    process.stdout.write(line);
    return;
  }
  try {
    appendFileSync(state.out, line, "utf8");
  } catch {
    process.stderr.write(line);
  }
}
function profileNow() {
  return state.enabled ? nowMs() : 0;
}
function profileCount(name, value = 1) {
  if (!state.enabled || !Number.isFinite(value) || value === 0) return;
  ensureReporter();
  state.counters.set(name, (state.counters.get(name) ?? 0) + value);
}
function profileTextBytes(name, text) {
  if (!state.enabled || text.length === 0) return;
  profileCount(name, Buffer2.byteLength(text, "utf8"));
}
function profileSample(name, value) {
  if (!state.enabled || !Number.isFinite(value)) return;
  ensureReporter();
  const values = state.samples.get(name);
  if (values) {
    values.push(value);
  } else {
    state.samples.set(name, [value]);
  }
}
function profileDuration(name, startMs) {
  if (!state.enabled || startMs <= 0) return;
  profileSample(name, nowMs() - startMs);
}
function flushProfile(reason = "manual") {
  if (!state.enabled) return;
  const flushedAt = nowMs();
  const intervalMs = Math.max(1, flushedAt - state.lastFlushAt);
  state.lastFlushAt = flushedAt;
  const counters = {};
  for (const [name, count] of state.counters) {
    counters[name] = {
      count: round(count),
      perSec: round(count * 1e3 / intervalMs)
    };
  }
  state.counters.clear();
  const samples = {};
  for (const [name, values] of state.samples) {
    samples[name] = sampleSummary(values);
  }
  state.samples.clear();
  const memoryUsage = process.memoryUsage();
  const currentCpuUsage = process.cpuUsage();
  const previousCpuUsage = state.lastCpuUsage;
  state.lastCpuUsage = currentCpuUsage;
  const cpuUserMs = previousCpuUsage ? Math.max(0, (currentCpuUsage.user - previousCpuUsage.user) / 1e3) : 0;
  const cpuSystemMs = previousCpuUsage ? Math.max(0, (currentCpuUsage.system - previousCpuUsage.system) / 1e3) : 0;
  const cpuTotalMs = cpuUserMs + cpuSystemMs;
  let loopUsageDelta;
  try {
    const currentLoopUsage = performance2.eventLoopUtilization();
    if (state.lastEventLoopUsage) {
      loopUsageDelta = performance2.eventLoopUtilization(currentLoopUsage, state.lastEventLoopUsage);
    }
    state.lastEventLoopUsage = currentLoopUsage;
  } catch {
    state.lastEventLoopUsage = void 0;
  }
  const loopDelay = state.loopDelay;
  const record = {
    type: "pi-droid-profile",
    reason,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    pid: process.pid,
    intervalMs: round(intervalMs),
    memory: {
      rssMb: mb(memoryUsage.rss),
      heapUsedMb: mb(memoryUsage.heapUsed),
      heapTotalMb: mb(memoryUsage.heapTotal),
      externalMb: mb(memoryUsage.external)
    },
    cpu: {
      userMs: round(cpuUserMs),
      systemMs: round(cpuSystemMs),
      totalMs: round(cpuTotalMs),
      percentOneCore: round(cpuTotalMs * 100 / intervalMs)
    },
    counters,
    samples
  };
  if (loopDelay) {
    record.eventLoop = {
      meanMs: round(loopDelay.mean / 1e6),
      p95Ms: round(loopDelay.percentile(95) / 1e6),
      maxMs: round(loopDelay.max / 1e6)
    };
    loopDelay.reset();
  }
  if (loopUsageDelta) {
    record.eventLoopUtilization = {
      idleMs: round(loopUsageDelta.idle),
      activeMs: round(loopUsageDelta.active),
      utilization: round(loopUsageDelta.utilization)
    };
  }
  writeRecord(record);
}

// render-budget.ts
var MAX_RENDER_LINE_CHARS = 2e3;
var DEFAULT_COLLAPSED_RENDER_LINES = 10;
var MAX_BOXED_RESULT_RENDERED_HEAD_LINES = 40;
var MAX_BOXED_RESULT_RENDERED_TAIL_LINES = 8;
var MAX_BOXED_RESULT_RENDERED_LINES = 160;
var RENDER_TRUNCATION_SUFFIX = "\u2026 (truncated)";
var TRUNCATE_ELLIPSIS = "\u2026";
var ANSI_RESET = "\x1B[0m";
var SGR_PREFIX_PATTERN = /^(?:\x1b\[[0-9;]*m)+/;
var SGR_SUFFIX_PATTERN = /(?:\x1b\[[0-9;]*m)+$/;
var KITTY_IMAGE_PREFIX = "\x1B_G";
var ITERM2_IMAGE_PREFIX = "\x1B]1337;File=";
function isImageRenderLine(line) {
  return line.includes(KITTY_IMAGE_PREFIX) || line.includes(ITERM2_IMAGE_PREFIX);
}
function clampRenderLine(line, maxChars = MAX_RENDER_LINE_CHARS) {
  if (line.length <= maxChars) return line;
  return line.slice(0, maxChars) + RENDER_TRUNCATION_SUFFIX;
}
function isPrintableAsciiCode(code) {
  return code >= 32 && code <= 126;
}
function isSimpleWidthOneGlyphCode(code) {
  if (code >= 9472 && code <= 9599) return true;
  if (code >= 9600 && code <= 9631) return true;
  if (code >= 9632 && code <= 9727) return true;
  if (code >= 10240 && code <= 10495) return true;
  return code === 178 || // ²
  code === 183 || // ·
  code === 960 || // π
  code === 8211 || // –
  code === 8212 || // —
  code === 8226 || // •
  code === 8230 || // …
  code === 8593 || // ↑
  code === 8594 || // →
  code === 8595 || // ↓
  code === 8627 || // ↳
  code === 8709 || // ∅
  code === 8776 || // ≈
  code === 8943 || // ⋯
  code === 9095 || // ⎇
  code === 9209 || // ⏹
  code === 9998 || // ✎
  code === 10003 || // ✓
  code === 10007 || // ✗
  code === 10095 || // ❯
  code === 10132;
}
function isSimpleWidthOneCode(code) {
  return isPrintableAsciiCode(code) || isSimpleWidthOneGlyphCode(code);
}
function fastKindCounter(prefix, kind) {
  if (kind === "ascii") return `${prefix}.fastAscii`;
  if (kind === "sgrAscii") return `${prefix}.fastSgrAscii`;
  if (kind === "simple") return `${prefix}.fastSimple`;
  return `${prefix}.fastSgrSimple`;
}
function breakLongAsciiWord(word, width) {
  const lines = [];
  for (let i = 0; i < word.length; i += width) {
    lines.push(word.slice(i, i + width));
  }
  return lines.length > 0 ? lines : [""];
}
function wrapPrintableAsciiLine(line, width) {
  if (!line) return [""];
  if (line.length <= width) return [line];
  const wrapped = [];
  let currentLine = "";
  let currentVisibleLength = 0;
  let tokenStart = 0;
  while (tokenStart < line.length) {
    const tokenIsSpace = line[tokenStart] === " ";
    let tokenEnd = tokenStart + 1;
    while (tokenEnd < line.length && line[tokenEnd] === " " === tokenIsSpace) tokenEnd++;
    const token = line.slice(tokenStart, tokenEnd);
    const tokenVisibleLength = token.length;
    if (tokenVisibleLength > width && !tokenIsSpace) {
      if (currentLine) {
        wrapped.push(currentLine.trimEnd());
        currentLine = "";
        currentVisibleLength = 0;
      }
      const broken = breakLongAsciiWord(token, width);
      wrapped.push(...broken.slice(0, -1));
      currentLine = broken[broken.length - 1] ?? "";
      currentVisibleLength = currentLine.length;
      tokenStart = tokenEnd;
      continue;
    }
    const totalNeeded = currentVisibleLength + tokenVisibleLength;
    if (totalNeeded > width && currentVisibleLength > 0) {
      wrapped.push(currentLine.trimEnd());
      if (tokenIsSpace) {
        currentLine = "";
        currentVisibleLength = 0;
      } else {
        currentLine = token;
        currentVisibleLength = tokenVisibleLength;
      }
    } else {
      currentLine += token;
      currentVisibleLength += tokenVisibleLength;
    }
    tokenStart = tokenEnd;
  }
  if (currentLine) wrapped.push(currentLine);
  return wrapped.length > 0 ? wrapped.map((wrappedLine) => wrappedLine.trimEnd()) : [""];
}
function matchSimpleSgrWrappedText(text) {
  const prefixMatch = SGR_PREFIX_PATTERN.exec(text);
  const suffixMatch = SGR_SUFFIX_PATTERN.exec(text);
  if (!prefixMatch || !suffixMatch) return null;
  const prefix = prefixMatch[0];
  const suffix = suffixMatch[0];
  const bodyStart = prefix.length;
  const bodyEnd = suffixMatch.index;
  if (bodyEnd < bodyStart) return null;
  const body = text.slice(bodyStart, bodyEnd);
  const bodyWidth = knownVisibleWidth(body);
  if (!bodyWidth || bodyWidth.kind === "sgrAscii" || bodyWidth.kind === "sgrSimple") return null;
  return { prefix, body, suffix, kind: bodyWidth.kind === "ascii" ? "sgrAscii" : "sgrSimple" };
}
function wrapSimpleSgrWrappedText(text, width) {
  const match = matchSimpleSgrWrappedText(text);
  if (!match) return null;
  return {
    lines: wrapPrintableAsciiLine(match.body, width).map((line) => `${match.prefix}${line}${match.suffix}`),
    kind: match.kind
  };
}
function readSgrSequenceEnd(text, offset) {
  if (text.charCodeAt(offset) !== 27 || text[offset + 1] !== "[") return -1;
  let cursor = offset + 2;
  while (cursor < text.length) {
    const code = text.charCodeAt(cursor);
    if (code === 109) return cursor + 1;
    if (code !== 59 && (code < 48 || code > 57)) return -1;
    cursor++;
  }
  return -1;
}
function knownVisibleWidth(text) {
  let width = 0;
  let sawSgr = false;
  let sawSimpleGlyph = false;
  for (let i = 0; i < text.length; ) {
    const sgrEnd = readSgrSequenceEnd(text, i);
    if (sgrEnd > i) {
      sawSgr = true;
      i = sgrEnd;
      continue;
    }
    const code = text.charCodeAt(i);
    if (!isSimpleWidthOneCode(code)) return null;
    if (!isPrintableAsciiCode(code)) sawSimpleGlyph = true;
    width++;
    i++;
  }
  if (sawSgr) return { visibleWidth: width, kind: sawSimpleGlyph ? "sgrSimple" : "sgrAscii" };
  return { visibleWidth: width, kind: sawSimpleGlyph ? "simple" : "ascii" };
}
function knownEllipsisWidth(text) {
  if (text === TRUNCATE_ELLIPSIS) return 1;
  return knownVisibleWidth(text)?.visibleWidth ?? null;
}
function truncatePrintableAscii(text, width, ellipsis = TRUNCATE_ELLIPSIS) {
  if (width <= 0) return { text: "", visibleWidth: 0 };
  if (text.length <= width) return { text, visibleWidth: text.length };
  const ellipsisWidth = knownEllipsisWidth(ellipsis);
  if (ellipsisWidth === null) return { text: text.slice(0, width), visibleWidth: width };
  if (ellipsisWidth >= width) {
    if (ellipsis === TRUNCATE_ELLIPSIS) return { text: TRUNCATE_ELLIPSIS, visibleWidth: 1 };
    return { text: ellipsis.slice(0, width), visibleWidth: Math.min(width, ellipsis.length) };
  }
  const targetWidth = Math.max(0, width - ellipsisWidth);
  return { text: `${text.slice(0, targetWidth)}${ellipsis}`, visibleWidth: targetWidth + ellipsisWidth };
}
function truncateSgrAscii(text, width, ellipsis, visibleWidth3) {
  if (visibleWidth3 <= width) return { text, visibleWidth: visibleWidth3 };
  const ellipsisWidth = knownEllipsisWidth(ellipsis);
  if (ellipsisWidth === null) return null;
  if (ellipsisWidth >= width) return truncatePrintableAscii(ellipsis, width, "");
  const targetWidth = Math.max(0, width - ellipsisWidth);
  let keptWidth = 0;
  let output = "";
  for (let i = 0; i < text.length && keptWidth < targetWidth; ) {
    const sgrEnd = readSgrSequenceEnd(text, i);
    if (sgrEnd > i) {
      output += text.slice(i, sgrEnd);
      i = sgrEnd;
      continue;
    }
    const code = text.charCodeAt(i);
    if (!isSimpleWidthOneCode(code)) return null;
    output += text[i] ?? "";
    keptWidth++;
    i++;
  }
  return { text: `${output}${ANSI_RESET}${ellipsis}${ANSI_RESET}`, visibleWidth: keptWidth + ellipsisWidth };
}
function fastTruncateText(text, width, ellipsis = TRUNCATE_ELLIPSIS) {
  const knownWidth = knownVisibleWidth(text);
  if (!knownWidth) return null;
  if (knownWidth.kind === "ascii" || knownWidth.kind === "simple") return { ...truncatePrintableAscii(text, width, ellipsis), kind: knownWidth.kind };
  const simple = matchSimpleSgrWrappedText(text);
  if (simple) {
    const truncated2 = truncatePrintableAscii(simple.body, width, ellipsis);
    return { text: `${simple.prefix}${truncated2.text}${simple.suffix}`, visibleWidth: truncated2.visibleWidth, kind: simple.kind };
  }
  const truncated = truncateSgrAscii(text, width, ellipsis, knownWidth.visibleWidth);
  return truncated ? { ...truncated, kind: knownWidth.kind } : null;
}
function safeVisibleWidth(text) {
  const fastWidth = knownVisibleWidth(text);
  if (fastWidth) {
    profileCount(fastKindCounter("safeVisible", fastWidth.kind));
    return fastWidth.visibleWidth;
  }
  if (text === TRUNCATE_ELLIPSIS) {
    profileCount("safeVisible.fastAscii");
    return 1;
  }
  profileCount("safeVisible.fallback");
  return tuiVisibleWidth(text);
}
var TRAILING_RENDER_PADDING_PATTERN = /[ \t]+((?:\x1b\[[0-9;?]*[ -/]*[@-~])*)$/;
function trimTrailingRenderPadding(text) {
  return text.replace(TRAILING_RENDER_PADDING_PATTERN, "$1");
}
function toSingleRenderLine(text) {
  return text.replace(/[\t\n\v\f\r]+/g, " ");
}
function safeTruncateToWidth(text, maxWidth, ellipsis = "...", pad = false) {
  const width = Math.floor(maxWidth);
  if (!Number.isFinite(width) || width <= 0) return "";
  if (text.length === 0) return pad ? " ".repeat(width) : "";
  const truncated = fastTruncateText(text, width, ellipsis);
  if (truncated) {
    profileCount(fastKindCounter("safeTruncate", truncated.kind));
    return pad ? `${truncated.text}${" ".repeat(Math.max(0, width - truncated.visibleWidth))}` : truncated.text;
  }
  profileCount("safeTruncate.fallback");
  return tuiTruncateToWidth(text, maxWidth, ellipsis, pad);
}
function fastBoxLineContent(content, width) {
  const contentWidth = Math.floor(width);
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) return null;
  return fastTruncateText(content, contentWidth);
}
function safeWrapTextWithAnsi(text, width, maxChars = MAX_RENDER_LINE_CHARS) {
  const clamped = clampRenderLine(text, maxChars);
  const wrapWidth = Math.floor(width);
  if (!Number.isFinite(wrapWidth) || wrapWidth <= 0) {
    profileCount("safeWrap.fallback");
    return wrapTextWithAnsi(clamped, width);
  }
  const clampedWidth = knownVisibleWidth(clamped);
  if (clampedWidth?.kind === "ascii" || clampedWidth?.kind === "simple") {
    profileCount(fastKindCounter("safeWrap", clampedWidth.kind));
    return wrapPrintableAsciiLine(clamped, wrapWidth);
  }
  const simpleSgrWrapped = wrapSimpleSgrWrappedText(clamped, wrapWidth);
  if (simpleSgrWrapped) {
    profileCount(fastKindCounter("safeWrap", simpleSgrWrapped.kind));
    return simpleSgrWrapped.lines;
  }
  profileCount("safeWrap.fallback");
  return wrapTextWithAnsi(clamped, width);
}
function boxedResultRenderBudget(rawLineBudget = DEFAULT_COLLAPSED_RENDER_LINES) {
  const rawLines = Math.max(0, Math.floor(Number.isFinite(rawLineBudget) ? rawLineBudget : DEFAULT_COLLAPSED_RENDER_LINES));
  const maxRenderedLines = Math.max(1, Math.min(rawLines * 3, MAX_BOXED_RESULT_RENDERED_LINES));
  const tailLines = Math.min(
    Math.ceil(rawLines * 0.15),
    MAX_BOXED_RESULT_RENDERED_TAIL_LINES,
    Math.max(0, maxRenderedLines - 1)
  );
  const headLines = Math.min(
    rawLines,
    MAX_BOXED_RESULT_RENDERED_HEAD_LINES,
    Math.max(1, maxRenderedLines - tailLines - 1)
  );
  return { headLines, tailLines, maxRenderedLines };
}

// theme/ansi.ts
var RE_CSI = /\x1b\[[0-9;]*[a-zA-Z]/g;
var RE_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
var RE_APC = /\x1b_[^\x07\x1b]*(?:\x07|\x1b\\)/g;
function stripAnsi(str) {
  return str.replace(RE_CSI, "").replace(RE_OSC, "").replace(RE_APC, "");
}
function isHexColor(hex) {
  const cleaned = hex.replace("#", "");
  return cleaned.length === 3 ? /^[0-9a-fA-F]{3}$/.test(cleaned) : (cleaned.length === 6 || cleaned.length === 8) && /^[0-9a-fA-F]+$/.test(cleaned);
}
function hexToRgb(hex) {
  const cleaned = hex.replace("#", "");
  if (cleaned.length === 3) {
    const r2 = Number.parseInt(cleaned[0] + cleaned[0], 16);
    const g2 = Number.parseInt(cleaned[1] + cleaned[1], 16);
    const b2 = Number.parseInt(cleaned[2] + cleaned[2], 16);
    return { r: r2, g: g2, b: b2 };
  }
  if (cleaned.length !== 6 && cleaned.length !== 8 || !/^[0-9a-fA-F]+$/.test(cleaned)) {
    return { r: 0, g: 0, b: 0 };
  }
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  return { r, g, b };
}
function rgbToHex(rgb) {
  const channel = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}
var CUBE_VALUES = [0, 95, 135, 175, 215, 255];
var GRAY_VALUES = Array.from({ length: 24 }, (_, i) => 8 + i * 10);
function ansi256ToRgb(index) {
  if (index >= 232) {
    const gray = 8 + (index - 232) * 10;
    return { r: gray, g: gray, b: gray };
  }
  const cubeIndex = Math.max(0, index - 16);
  const redIndex = Math.floor(cubeIndex / 36);
  const greenIndex = Math.floor(cubeIndex % 36 / 6);
  const blueIndex = cubeIndex % 6;
  return { r: CUBE_VALUES[redIndex], g: CUBE_VALUES[greenIndex], b: CUBE_VALUES[blueIndex] };
}
var ANSI_16_RGB = [
  [0, 0, 0],
  [128, 0, 0],
  [0, 128, 0],
  [128, 128, 0],
  [0, 0, 128],
  [128, 0, 128],
  [0, 128, 128],
  [192, 192, 192],
  [128, 128, 128],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [0, 0, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255]
];
function parseFgAnsiToRgb(ansi) {
  const truecolor = /38;2;(\d+);(\d+);(\d+)/.exec(ansi);
  if (truecolor) {
    return { r: Number(truecolor[1]), g: Number(truecolor[2]), b: Number(truecolor[3]) };
  }
  const indexed = /38;5;(\d+)/.exec(ansi);
  if (indexed) {
    const index = Number(indexed[1]);
    if (index < 16) {
      const [r, g, b] = ANSI_16_RGB[index] ?? [255, 255, 255];
      return { r, g, b };
    }
    return ansi256ToRgb(index);
  }
  return void 0;
}
function colorDistance(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
}
function findClosestCubeIndex(value) {
  let minDist = Number.POSITIVE_INFINITY;
  let minIdx = 0;
  for (let i = 0; i < CUBE_VALUES.length; i++) {
    const dist = Math.abs(value - CUBE_VALUES[i]);
    if (dist < minDist) {
      minDist = dist;
      minIdx = i;
    }
  }
  return minIdx;
}
function findClosestGrayIndex(gray) {
  let minDist = Number.POSITIVE_INFINITY;
  let minIdx = 0;
  for (let i = 0; i < GRAY_VALUES.length; i++) {
    const dist = Math.abs(gray - GRAY_VALUES[i]);
    if (dist < minDist) {
      minDist = dist;
      minIdx = i;
    }
  }
  return minIdx;
}
function rgbTo256(r, g, b) {
  const rIdx = findClosestCubeIndex(r);
  const gIdx = findClosestCubeIndex(g);
  const bIdx = findClosestCubeIndex(b);
  const cubeR = CUBE_VALUES[rIdx];
  const cubeG = CUBE_VALUES[gIdx];
  const cubeB = CUBE_VALUES[bIdx];
  const cubeIndex = 16 + 36 * rIdx + 6 * gIdx + bIdx;
  const cubeDist = colorDistance(r, g, b, cubeR, cubeG, cubeB);
  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  const grayIdx = findClosestGrayIndex(gray);
  const grayValue = GRAY_VALUES[grayIdx];
  const grayIndex = 232 + grayIdx;
  const grayDist = colorDistance(r, g, b, grayValue, grayValue, grayValue);
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  if (spread < 10 && grayDist < cubeDist) {
    return grayIndex;
  }
  return cubeIndex;
}
var fgEscapeCache = /* @__PURE__ */ new Map();
var bgEscapeCache = /* @__PURE__ */ new Map();
function getFgEscape(theme, hex) {
  const mode = typeof theme?.getColorMode === "function" ? theme.getColorMode() : "truecolor";
  const cacheKey = `${mode}:${hex}`;
  let cached2 = fgEscapeCache.get(cacheKey);
  if (!cached2) {
    const { r, g, b } = hexToRgb(hex);
    if (mode === "256color") {
      const idx = rgbTo256(r, g, b);
      cached2 = `\x1B[38;5;${idx}m`;
    } else {
      cached2 = `\x1B[38;2;${r};${g};${b}m`;
    }
    fgEscapeCache.set(cacheKey, cached2);
  }
  return { prefix: cached2, suffix: "\x1B[39m" };
}
function getBgEscape(theme, hex) {
  const mode = typeof theme?.getColorMode === "function" ? theme.getColorMode() : "truecolor";
  const cacheKey = `${mode}:${hex}`;
  let cached2 = bgEscapeCache.get(cacheKey);
  if (!cached2) {
    const { r, g, b } = hexToRgb(hex);
    if (mode === "256color") {
      const idx = rgbTo256(r, g, b);
      cached2 = `\x1B[48;5;${idx}m`;
    } else {
      cached2 = `\x1B[48;2;${r};${g};${b}m`;
    }
    bgEscapeCache.set(cacheKey, cached2);
  }
  return { prefix: cached2, suffix: RESET_BACKGROUND };
}
var RESET_BACKGROUND = "\x1B[49m";
var ERASE_TO_END_OF_LINE = "\x1B[K";
var ERASE_LINE = "\x1B[2K";
function fgHex(theme, hex, text) {
  if (!isHexColor(hex)) return text;
  const { prefix, suffix } = getFgEscape(theme, hex);
  return `${prefix}${text}${suffix}`;
}
function bgHexAnsi(theme, hex) {
  if (!isHexColor(hex)) return "";
  return getBgEscape(theme, hex).prefix;
}
function sgrColorParameterEnd(codes, index) {
  const code = Number(codes[index]);
  if (code !== 38 && code !== 48) return index;
  const mode = Number(codes[index + 1]);
  if (mode === 2) return Math.min(codes.length - 1, index + 4);
  if (mode === 5) return Math.min(codes.length - 1, index + 2);
  return index;
}
function isBasicBackgroundCode(code) {
  return code >= 40 && code <= 47 || code >= 100 && code <= 107;
}
function finalBackgroundAction(rawCodes) {
  const codes = rawCodes.split(";").filter(Boolean);
  if (codes.length === 0) return "reset";
  let action = "none";
  for (let i = 0; i < codes.length; i++) {
    const code = Number(codes[i]);
    if (code === 0 || code === 49) {
      action = "reset";
      continue;
    }
    if (code === 48) {
      action = "set";
      i = sgrColorParameterEnd(codes, i);
      continue;
    }
    if (code === 38) {
      i = sgrColorParameterEnd(codes, i);
      continue;
    }
    if (isBasicBackgroundCode(code)) action = "set";
  }
  return action;
}
function removeStandaloneBackgroundReset(rawCodes) {
  const codes = rawCodes.split(";").filter(Boolean);
  if (codes.length === 0) return "0";
  const rebuilt = [];
  for (let i = 0; i < codes.length; i++) {
    const code = Number(codes[i]);
    if (code === 49) continue;
    const end = sgrColorParameterEnd(codes, i);
    for (let j = i; j <= end; j++) rebuilt.push(codes[j]);
    i = end;
  }
  return rebuilt.join(";");
}
function keepAnsiBackgroundAcrossResets(text, bgAnsi) {
  if (!text) return text;
  return text.replace(/\x1b\[([0-9;]*)m/g, (sequence, rawCodes) => {
    const codes = String(rawCodes ?? "");
    if (finalBackgroundAction(codes) !== "reset") return sequence;
    const rebuilt = removeStandaloneBackgroundReset(codes);
    return `${rebuilt ? `\x1B[${rebuilt}m` : ""}${bgAnsi}`;
  });
}
function wrapAnsiBackground(text, bgAnsi, options = {}) {
  if (!bgAnsi || bgAnsi === RESET_BACKGROUND) return text;
  const body = keepAnsiBackgroundAcrossResets(text, bgAnsi);
  const fill = options.fillToEnd ? `${bgAnsi}${ERASE_TO_END_OF_LINE}` : "";
  return `${bgAnsi}${body}${fill}${RESET_BACKGROUND}`;
}
function readAnsiToken(text, index) {
  if (text[index] !== "\x1B") return void 0;
  const tail = text.slice(index);
  const csi = tail.match(/^\x1b\[[0-9;?]*[ -/]*[@-~]/)?.[0];
  if (csi) return csi;
  const osc = tail.match(/^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/)?.[0];
  return osc;
}
function dropLeadingColumns(line, columns) {
  if (columns <= 0 || line.length === 0) return line;
  let i = 0;
  let dropped = 0;
  let leadingAnsi = "";
  while (i < line.length && dropped < columns) {
    const ansi = readAnsiToken(line, i);
    if (ansi) {
      leadingAnsi += ansi;
      i += ansi.length;
      continue;
    }
    const codePoint = line.codePointAt(i);
    if (codePoint === void 0) break;
    const charLen = codePoint > 65535 ? 2 : 1;
    const char = line.slice(i, i + charLen);
    i += charLen;
    dropped += Math.max(1, safeVisibleWidth(char));
  }
  return `${leadingAnsi}${line.slice(i)}`;
}
function startsWithVisibleSpace(line) {
  if (!line) return false;
  let i = 0;
  while (i < line.length) {
    const ansi = readAnsiToken(line, i);
    if (ansi) {
      i += ansi.length;
      continue;
    }
    const codePoint = line.codePointAt(i);
    if (codePoint === void 0) return false;
    const charLen = codePoint > 65535 ? 2 : 1;
    const char = line.slice(i, i + charLen);
    return char === " ";
  }
  return false;
}

// config.ts
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

// presentation/reasonix-layout.ts
var REASONIX_MARKER_GAP = " ";
var REASONIX_COLLAPSED_MIN_WIDTH = 40;
var REASONIX_COLLAPSED_WIDTH_RATIO = 0.8;
function getReasonixCollapsedRowWidth(width) {
  const availableWidth = Math.max(1, Math.floor(width));
  if (availableWidth <= REASONIX_COLLAPSED_MIN_WIDTH) return availableWidth;
  return Math.floor(availableWidth * REASONIX_COLLAPSED_WIDTH_RATIO);
}

// presentation/designs.ts
var PRESENTATION_STYLE_NAME_SET = {
  droid: true,
  reasonix: true
};
var DEFAULT_PRESENTATION_STYLE = "droid";
var PRESENTATION_DESIGNS = {
  droid: { name: "droid", compactLayout: false, markerGap: "  ", stripsBackground: false },
  reasonix: { name: "reasonix", compactLayout: true, markerGap: REASONIX_MARKER_GAP, stripsBackground: true }
};
function getPresentationDesignFor(style) {
  return PRESENTATION_DESIGNS[style];
}
function isPresentationStyleName(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PRESENTATION_STYLE_NAME_SET, value);
}
function normalizePresentationStyleName(value) {
  return isPresentationStyleName(value) ? value : DEFAULT_PRESENTATION_STYLE;
}

// user-zone/designs.ts
var USER_ZONE_STYLE_NAME_SET = {
  droid: true,
  gemini: true,
  "cli-dock": true,
  nvim: true
};
var DEFAULT_USER_ZONE_STYLE = "gemini";
var FALLBACK_USER_ZONE_STYLE = "droid";
var USER_ZONE_STYLES = {
  droid: {
    name: "droid",
    editor: {
      layout: "droid",
      panelPaddingX: 2,
      prompt: "\u276F",
      promptColor: "accent",
      promptBold: true,
      promptGap: 2,
      showHostBorder: true,
      hostBorderFill: "\u22EF",
      hostPrefixColor: "accent",
      hostBorderColor: "border",
      showMetadataRow: true,
      showRuntimeRow: true,
      showDivider: true,
      dividerChar: "\u2501",
      dividerColor: "border",
      dividerBold: true,
      showTrailingBlankLine: true,
      slashBorderColor: "border",
      inputBackgroundColor: "selectedBg",
      inputFrame: "none",
      footerLabelColor: "dim",
      footerValueColor: "muted"
    }
  },
  gemini: {
    name: "gemini",
    editor: {
      layout: "gemini",
      panelPaddingX: 1,
      prompt: "\u276F",
      promptColor: "accent",
      promptBold: true,
      promptGap: 2,
      showHostBorder: false,
      hostBorderFill: "",
      hostPrefixColor: "accent",
      hostBorderColor: "borderMuted",
      showMetadataRow: false,
      showRuntimeRow: true,
      showDivider: true,
      dividerChar: "\u2500",
      dividerColor: "border",
      dividerBold: true,
      showTrailingBlankLine: false,
      slashBorderColor: "borderMuted",
      inputBackgroundColor: "selectedBg",
      inputFrame: "auto",
      footerLabelColor: "dim",
      footerValueColor: "dim"
    }
  },
  "cli-dock": {
    name: "cli-dock",
    editor: {
      layout: "cli-dock",
      panelPaddingX: 0,
      prompt: "\u203A",
      promptColor: "accent",
      promptBold: true,
      promptGap: 1,
      showHostBorder: false,
      hostBorderFill: "",
      hostPrefixColor: "accent",
      hostBorderColor: "borderMuted",
      showMetadataRow: false,
      showRuntimeRow: true,
      showDivider: false,
      dividerChar: "\u2500",
      dividerColor: "borderMuted",
      dividerBold: false,
      showTrailingBlankLine: false,
      slashBorderColor: "borderMuted",
      inputBackgroundColor: "selectedBg",
      inputFrame: "outline",
      footerLabelColor: "dim",
      footerValueColor: "muted",
      placeholder: " Type a prompt or / for commands"
    }
  },
  nvim: {
    name: "nvim",
    editor: {
      layout: "nvim",
      panelPaddingX: 1,
      prompt: "\u276F",
      promptColor: "accent",
      promptBold: true,
      promptGap: 2,
      showHostBorder: false,
      hostBorderFill: "",
      hostPrefixColor: "accent",
      hostBorderColor: "borderMuted",
      showMetadataRow: false,
      showRuntimeRow: false,
      showDivider: false,
      dividerChar: "\u2500",
      dividerColor: "border",
      dividerBold: true,
      showTrailingBlankLine: false,
      slashBorderColor: "borderMuted",
      inputBackgroundColor: "selectedBg",
      inputFrame: "line",
      footerLabelColor: "dim",
      footerValueColor: "muted",
      placeholder: "Type a prompt  \xB7  / commands  \xB7  ! bash"
    }
  }
};
function isUserZoneStyleName(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(USER_ZONE_STYLE_NAME_SET, value);
}
function normalizeUserZoneStyleName(value) {
  if (value === void 0) return DEFAULT_USER_ZONE_STYLE;
  return isUserZoneStyleName(value) ? value : FALLBACK_USER_ZONE_STYLE;
}
function resolveUserZoneStyle(value) {
  return USER_ZONE_STYLES[normalizeUserZoneStyleName(value)];
}

// config.ts
var TASKS_WIDGET_STYLE_SET = { default: true, compact: true };
function isTasksWidgetStyle(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TASKS_WIDGET_STYLE_SET, value);
}
function normalizeTasksWidgetStyle(value) {
  if (value === void 0) return DEFAULTS.tasksWidgetStyle;
  return isTasksWidgetStyle(value) ? value : DEFAULTS.tasksWidgetStyle;
}
var DEFAULT_CUSTOM_WORKING_MESSAGE = {
  working: "Working",
  thinking: "DeepThinking",
  answering: "Answering",
  running: "Cooking"
};
var DEFAULT_INPUT_BOX = {
  style: "auto"
};
var DEFAULTS = {
  alwaysExpanded: false,
  maxExpandedLines: 50,
  dimToolOutput: true,
  customWorkingMessage: DEFAULT_CUSTOM_WORKING_MESSAGE,
  presentationStyle: DEFAULT_PRESENTATION_STYLE,
  userZoneStyle: DEFAULT_USER_ZONE_STYLE,
  inputBox: DEFAULT_INPUT_BOX,
  tasksWidgetStyle: "compact",
  forceOSC11: false,
  visibleChatTail: 30
};
var CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-droid-ui.json");
var MAX_EXPANDED_LINES_LIMIT = 1e3;
var DEPRECATED_CONFIG_KEYS = ["fixedUserZoneMouseScroll", "fixedUserZoneSidebar", "fixedUserZone"];
var cached = defaultConfig();
var cachedMtimeMs = -1;
var lastStatAt = 0;
var STAT_INTERVAL_MS = 1e3;
function defaultCustomWorkingMessage() {
  return { ...DEFAULT_CUSTOM_WORKING_MESSAGE };
}
function defaultConfig() {
  return { ...DEFAULTS, customWorkingMessage: defaultCustomWorkingMessage() };
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function booleanOrDefault(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function maxExpandedLinesOrDefault(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULTS.maxExpandedLines;
  const normalized = Math.floor(value);
  if (normalized < 0) return DEFAULTS.maxExpandedLines;
  return Math.min(normalized, MAX_EXPANDED_LINES_LIMIT);
}
function visibleChatTailOrDefault(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULTS.visibleChatTail;
  const normalized = Math.floor(value);
  if (normalized < 0) return DEFAULTS.visibleChatTail;
  return normalized;
}
function customWorkingMessageOrDefault(value) {
  const labels = defaultCustomWorkingMessage();
  if (!isRecord(value)) return labels;
  for (const key of Object.keys(labels)) {
    const label = value[key];
    if (typeof label === "string" && label.trim().length > 0) labels[key] = label;
  }
  return labels;
}
function isInputBoxStyle(value) {
  return value === "auto" || value === "halfblock" || value === "line" || value === "solid";
}
function inputBoxOrDefault(value) {
  const config = { ...DEFAULT_INPUT_BOX };
  if (!isRecord(value)) return config;
  if (isInputBoxStyle(value.style)) config.style = value.style;
  return config;
}
function defaultValueForKey(key) {
  if (key === "customWorkingMessage") return defaultCustomWorkingMessage();
  if (key === "inputBox") return { ...DEFAULT_INPUT_BOX };
  return DEFAULTS[key];
}
function backfillCustomWorkingMessage(config) {
  const value = config.customWorkingMessage;
  if (!isRecord(value)) {
    config.customWorkingMessage = defaultCustomWorkingMessage();
    return true;
  }
  let changed = false;
  for (const key of Object.keys(DEFAULT_CUSTOM_WORKING_MESSAGE)) {
    const label = value[key];
    if (typeof label === "string" && label.trim().length > 0) continue;
    value[key] = DEFAULT_CUSTOM_WORKING_MESSAGE[key];
    changed = true;
  }
  return changed;
}
function backfillPresentationStyle(config) {
  const value = config.presentationStyle;
  if (value === void 0) {
    config.presentationStyle = DEFAULT_PRESENTATION_STYLE;
    return true;
  }
  if (isPresentationStyleName(value)) return false;
  if (typeof value === "string" && value.trim().length > 0) return false;
  config.presentationStyle = DEFAULT_PRESENTATION_STYLE;
  return true;
}
function backfillUserZoneStyle(config) {
  const value = config.userZoneStyle;
  if (value === void 0) {
    config.userZoneStyle = DEFAULT_USER_ZONE_STYLE;
    return true;
  }
  if (isUserZoneStyleName(value)) return false;
  if (typeof value === "string" && value.trim().length > 0) return false;
  config.userZoneStyle = FALLBACK_USER_ZONE_STYLE;
  return true;
}
function backfillInputBox(config) {
  if (!isRecord(config.inputBox)) {
    config.inputBox = { ...DEFAULT_INPUT_BOX };
    return true;
  }
  const inputBox = config.inputBox;
  if (isInputBoxStyle(inputBox.style)) return false;
  inputBox.style = DEFAULT_INPUT_BOX.style;
  return true;
}
function backfillTasksWidgetStyle(config) {
  const value = config.tasksWidgetStyle;
  if (value === void 0) {
    config.tasksWidgetStyle = DEFAULTS.tasksWidgetStyle;
    return true;
  }
  if (isTasksWidgetStyle(value)) return false;
  config.tasksWidgetStyle = DEFAULTS.tasksWidgetStyle;
  return true;
}
function normalizeConfig(raw) {
  if (!isRecord(raw)) return defaultConfig();
  const config = raw;
  return {
    alwaysExpanded: booleanOrDefault(config.alwaysExpanded, DEFAULTS.alwaysExpanded),
    maxExpandedLines: maxExpandedLinesOrDefault(config.maxExpandedLines),
    dimToolOutput: booleanOrDefault(config.dimToolOutput, DEFAULTS.dimToolOutput),
    customWorkingMessage: customWorkingMessageOrDefault(config.customWorkingMessage),
    presentationStyle: normalizePresentationStyleName(config.presentationStyle),
    userZoneStyle: normalizeUserZoneStyleName(config.userZoneStyle),
    inputBox: inputBoxOrDefault(config.inputBox),
    tasksWidgetStyle: normalizeTasksWidgetStyle(config.tasksWidgetStyle),
    forceOSC11: booleanOrDefault(config.forceOSC11, DEFAULTS.forceOSC11),
    visibleChatTail: visibleChatTailOrDefault(config.visibleChatTail)
  };
}
function scaffoldIfMissing() {
  if (existsSync(CONFIG_PATH)) return;
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig(), null, 2) + "\n", "utf-8");
  } catch {
  }
}
function backfillMissingDefaults(raw) {
  if (!isRecord(raw)) return;
  const config = raw;
  let changed = false;
  for (const key of DEPRECATED_CONFIG_KEYS) {
    if (!(key in config)) continue;
    delete config[key];
    changed = true;
  }
  for (const key of Object.keys(DEFAULTS)) {
    if (key in config) continue;
    config[key] = defaultValueForKey(key);
    changed = true;
  }
  if (backfillCustomWorkingMessage(config)) changed = true;
  if (backfillPresentationStyle(config)) changed = true;
  if (backfillUserZoneStyle(config)) changed = true;
  if (backfillInputBox(config)) changed = true;
  if (backfillTasksWidgetStyle(config)) changed = true;
  if (!changed) return;
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
  } catch {
  }
}
function loadConfig() {
  const now = Date.now();
  if (now - lastStatAt < STAT_INTERVAL_MS) return cached;
  lastStatAt = now;
  let mtimeMs = -1;
  try {
    mtimeMs = statSync(CONFIG_PATH).mtimeMs;
  } catch {
    scaffoldIfMissing();
    try {
      mtimeMs = statSync(CONFIG_PATH).mtimeMs;
    } catch {
      cached = defaultConfig();
      cachedMtimeMs = -1;
      return cached;
    }
  }
  if (mtimeMs === cachedMtimeMs) return cached;
  cachedMtimeMs = mtimeMs;
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    cached = normalizeConfig(raw);
    backfillMissingDefaults(raw);
  } catch {
    cached = defaultConfig();
  }
  return cached;
}

// presentation/state.ts
var ACTIVE_PRESENTATION_STYLE = Symbol.for("pi-droid-styling.presentation.active-style");
var runtimeState = globalThis;
function setPresentationStyle(style) {
  runtimeState[ACTIVE_PRESENTATION_STYLE] = style;
}
function getPresentationStyle() {
  const style = runtimeState[ACTIVE_PRESENTATION_STYLE];
  return isPresentationStyleName(style) ? style : DEFAULT_PRESENTATION_STYLE;
}
function getPresentationDesign() {
  return getPresentationDesignFor(getPresentationStyle());
}

// tool-tags/common.ts
import { homedir as homedir3 } from "node:os";
import { relative, resolve as resolve2 } from "node:path";

// theme/theme-extras.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, readdirSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname as dirname2, join as join2, resolve } from "node:path";
import { fileURLToPath } from "node:url";
var extensionDir = dirname2(fileURLToPath(import.meta.url));
var HARDCODED_DEFAULTS = {
  assistantPrefix: "\u2022",
  assistantPrefixColor: "",
  userPrefix: "\u276F",
  userPrefixColor: "accent",
  dividerChar: "\u2500",
  dividerColor: "",
  showDivider: "true",
  quoteStyle: "false",
  quoteChar: "\u2506",
  quoteColor: "",
  inputBorderColor: "",
  bashPromptColor: "",
  tagBgColor: "",
  parensTextColor: "",
  parensBracketColor: "",
  slashSelectedColor: "",
  slashCommandColor: "",
  slashDescriptionColor: "",
  slashHintColor: "",
  userBoxBorderColor: "",
  gitInsertionColor: "#2ea043",
  gitDeletionColor: "#f85149"
};
var cachedExtras = null;
var cachedVars = null;
var cachedColors = null;
var cachedThemeExport = null;
var cachedThemeName = null;
function themeDiscoveryFromContent(content) {
  const extras = content?.extras && typeof content.extras === "object" ? content.extras : null;
  const vars = content?.vars && typeof content.vars === "object" ? content.vars : null;
  const colors = content?.colors && typeof content.colors === "object" ? content.colors : null;
  const themeExport = content?.export && typeof content.export === "object" ? content.export : null;
  return extras || vars || colors || themeExport ? { extras, vars, colors, themeExport } : null;
}
function readThemeDiscoveryFromPath(filePath) {
  try {
    if (!filePath || !existsSync2(filePath)) return null;
    const content = JSON.parse(readFileSync2(filePath, "utf-8"));
    return themeDiscoveryFromContent(content);
  } catch {
    return null;
  }
}
function resolveThemeSourcePath(theme) {
  return typeof theme?.sourcePath === "string" ? theme.sourcePath : typeof theme?.definition?.sourcePath === "string" ? theme.definition.sourcePath : "";
}
function addThemeDir(searchDirs, dir) {
  if (existsSync2(dir)) searchDirs.add(dir);
}
function addBundledThemeDirs(searchDirs) {
  for (const root of [extensionDir, process.cwd()]) {
    for (const scope of ["@earendil-works", "@mariozechner"]) {
      addThemeDir(searchDirs, resolve(root, "node_modules", scope, "pi-coding-agent", "dist", "modes", "interactive", "theme"));
      addThemeDir(searchDirs, resolve(root, "node_modules", scope, "pi-coding-agent", "dist", "theme"));
    }
  }
}
function collectThemeDirs(root, searchDirs, maxDepth = 4) {
  if (maxDepth < 0 || !existsSync2(root)) return;
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const dir = join2(root, entry.name);
      if (entry.name === "themes") {
        searchDirs.add(dir);
        continue;
      }
      collectThemeDirs(dir, searchDirs, maxDepth - 1);
    }
  } catch {
  }
}
function readSettingsPackagePaths(settingsPath) {
  if (!existsSync2(settingsPath)) return [];
  try {
    const settings = JSON.parse(readFileSync2(settingsPath, "utf-8"));
    const entries = [
      ...Array.isArray(settings.packages) ? settings.packages : [],
      ...Array.isArray(settings.extensions) ? settings.extensions : []
    ];
    return entries.map((entry) => typeof entry === "string" ? entry : typeof entry?.source === "string" ? entry.source : "").filter((entry) => entry && !entry.startsWith("npm:") && !entry.startsWith("git:"));
  } catch {
    return [];
  }
}
function discoverThemeExtras(themeName) {
  const searchDirs = /* @__PURE__ */ new Set();
  addThemeDir(searchDirs, join2(homedir2(), ".pi", "agent", "themes"));
  addThemeDir(searchDirs, resolve(process.cwd(), ".pi", "themes"));
  addBundledThemeDirs(searchDirs);
  addThemeDir(searchDirs, resolve(extensionDir, "..", "themes"));
  addThemeDir(searchDirs, join2(homedir2(), ".pi", "agent", "npm", "node_modules", "@ferris1225", "pi-droid-ui", "themes"));
  collectThemeDirs(join2(homedir2(), ".pi", "agent", "git"), searchDirs);
  collectThemeDirs(resolve(process.cwd(), ".pi", "git"), searchDirs);
  const localPackagePaths = [
    ...readSettingsPackagePaths(join2(homedir2(), ".pi", "agent", "settings.json")),
    ...readSettingsPackagePaths(resolve(process.cwd(), ".pi", "settings.json"))
  ];
  for (const packagePath of localPackagePaths) {
    addThemeDir(searchDirs, resolve(process.cwd(), packagePath, "themes"));
  }
  for (const dir of searchDirs) {
    try {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".json")) continue;
        const filePath = join2(dir, file);
        try {
          const content = JSON.parse(readFileSync2(filePath, "utf-8"));
          if (content?.name === themeName) {
            const result = themeDiscoveryFromContent(content);
            if (result) return result;
          }
        } catch {
        }
      }
    } catch {
    }
  }
  return null;
}
function resolveThemeName(theme) {
  if (typeof theme?.definition?.name === "string") return theme.definition.name;
  if (typeof theme?.name === "string") return theme.name;
  try {
    const settingsPath = join2(homedir2(), ".pi", "agent", "settings.json");
    if (existsSync2(settingsPath)) {
      const settings = JSON.parse(readFileSync2(settingsPath, "utf-8"));
      if (typeof settings.theme === "string") return settings.theme;
    }
  } catch {
  }
  return null;
}
function setFullTheme(theme, force = false) {
  const themeName = resolveThemeName(theme);
  const sourcePath = resolveThemeSourcePath(theme);
  if (!themeName && !sourcePath) return;
  const cacheKey = sourcePath || themeName;
  if (!force && cacheKey === cachedThemeName && (cachedExtras !== null || cachedVars !== null || cachedColors !== null || cachedThemeExport !== null)) return;
  cachedThemeName = cacheKey;
  const result = readThemeDiscoveryFromPath(sourcePath) ?? (themeName ? discoverThemeExtras(themeName) : null);
  cachedExtras = result?.extras ?? null;
  cachedVars = result?.vars ?? null;
  cachedColors = result?.colors ?? null;
  cachedThemeExport = result?.themeExport ?? null;
}
function getThemeExtra(_theme, key) {
  if (cachedExtras === null && cachedVars === null && cachedColors === null && cachedThemeExport === null && cachedThemeName === null) {
    const themeName = resolveThemeName(_theme);
    if (themeName) {
      cachedThemeName = themeName;
      const result = discoverThemeExtras(themeName);
      cachedExtras = result?.extras ?? null;
      cachedVars = result?.vars ?? null;
      cachedColors = result?.colors ?? null;
      cachedThemeExport = result?.themeExport ?? null;
    }
  }
  const extraValue = cachedExtras?.[key];
  if (typeof extraValue === "string" || typeof extraValue === "boolean") {
    return resolveThemeExtraValue(key, String(extraValue));
  }
  return resolveThemeExtraValue(key, HARDCODED_DEFAULTS[key] ?? "");
}
function ensureThemeExportLoaded(theme) {
  if (cachedExtras !== null || cachedVars !== null || cachedColors !== null || cachedThemeExport !== null || cachedThemeName !== null) return;
  const themeName = resolveThemeName(theme);
  const sourcePath = resolveThemeSourcePath(theme);
  if (!themeName && !sourcePath) return;
  cachedThemeName = sourcePath || themeName;
  const result = readThemeDiscoveryFromPath(sourcePath) ?? (themeName ? discoverThemeExtras(themeName) : null);
  cachedExtras = result?.extras ?? null;
  cachedVars = result?.vars ?? null;
  cachedColors = result?.colors ?? null;
  cachedThemeExport = result?.themeExport ?? null;
}
function isHexColor2(value) {
  return /^#?[0-9a-fA-F]{3}$/.test(value) || /^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value);
}
function readThemeToken(name) {
  const varValue = cachedVars && typeof cachedVars[name] === "string" ? cachedVars[name] : "";
  if (varValue) return varValue;
  return cachedColors && typeof cachedColors[name] === "string" ? cachedColors[name] : "";
}
function resolveThemeColorToken(value) {
  let resolved = value;
  const seen = /* @__PURE__ */ new Set();
  for (let depth = 0; depth < 8; depth++) {
    if (!resolved) return "";
    if (isHexColor2(resolved)) return resolved;
    if (seen.has(resolved)) return "";
    seen.add(resolved);
    const next = readThemeToken(resolved);
    if (!next) return "";
    resolved = next;
  }
  return "";
}
function resolveThemeExtraValue(key, value) {
  if (!key.endsWith("Color")) return value;
  return resolveThemeColorToken(value) || value;
}
function resolveThemeExportColor(key) {
  if (!cachedThemeExport) return "";
  const value = cachedThemeExport[key];
  if (typeof value !== "string" || !value) return "";
  const resolved = cachedVars && typeof cachedVars[value] === "string" ? cachedVars[value] : value;
  return isHexColor2(resolved) ? resolved : "";
}
function getThemePageBackground(theme) {
  ensureThemeExportLoaded(theme);
  const directBg = cachedVars && typeof cachedVars.bg === "string" ? cachedVars.bg : "";
  if (isHexColor2(directBg)) return directBg;
  return resolveThemeExportColor("pageBg");
}
function getThemeVarBackground(theme, varName) {
  ensureThemeExportLoaded(theme);
  const value = cachedVars && typeof cachedVars[varName] === "string" ? cachedVars[varName] : "";
  const resolved = cachedVars && value && typeof cachedVars[value] === "string" ? cachedVars[value] : value;
  return isHexColor2(resolved) ? resolved : "";
}

// tool-tags/elapsed.ts
var ELAPSED_KEY = "__elapsedMs";
var OUTPUT_CHARS_KEY = "__outputChars";
function getTextOutputLength(result) {
  if (!Array.isArray(result.content)) return 0;
  let length = 0;
  let seenText = false;
  for (const contentBlock of result.content) {
    if (contentBlock?.type !== "text") continue;
    if (seenText) length += 1;
    length += String(contentBlock.text ?? "").replace(/\r/g, "").length;
    seenText = true;
  }
  return length;
}
function getElapsedMs(result) {
  const elapsed = result?.details?.[ELAPSED_KEY];
  return typeof elapsed === "number" && Number.isFinite(elapsed) ? elapsed : void 0;
}
function annotateToolResultMetrics(result, elapsedMs) {
  if (!result || typeof result !== "object") return;
  if (!result.details || typeof result.details !== "object") {
    result.details = {};
  }
  const details = result.details;
  const existingElapsed = details[ELAPSED_KEY];
  if (typeof elapsedMs === "number" && Number.isFinite(elapsedMs) && (typeof existingElapsed !== "number" || !Number.isFinite(existingElapsed))) {
    details[ELAPSED_KEY] = elapsedMs;
  }
  if (typeof details[OUTPUT_CHARS_KEY] !== "number" || !Number.isFinite(details[OUTPUT_CHARS_KEY])) {
    details[OUTPUT_CHARS_KEY] = getTextOutputLength(result);
  }
}
function wrapExecuteWithTiming(executeFn) {
  return (async (...args) => {
    const start = performance.now();
    const result = await executeFn(...args);
    annotateToolResultMetrics(result, performance.now() - start);
    return result;
  });
}

// tool-tags/common.ts
function isExpanded(options) {
  return typeof options?.expanded === "boolean" ? options.expanded : false;
}
function shortenPath(path) {
  const home = homedir3();
  if (path.startsWith(home)) return `~${path.slice(home.length)}`;
  return path;
}
function resolveAbsolutePath(rawPath, cwd) {
  const path = rawPath.trim();
  if (!path) return "";
  const home = process.env.HOME;
  if (home && (path === "~" || path.startsWith("~/"))) {
    return path === "~" ? home : resolve2(home, path.slice(2));
  }
  return resolve2(cwd, path);
}
function resolveRelativePath(rawPath, cwd) {
  const absPath = resolveAbsolutePath(rawPath, cwd);
  if (!absPath) return "(unknown)";
  const relPath = relative(cwd, absPath).replace(/\\/g, "/");
  return relPath || ".";
}
function replaceTabs(text) {
  return text.replace(/\t/g, "   ");
}
function getTextOutput(result) {
  if (!result?.content) return "";
  const textBlocks = result.content.filter((contentBlock) => contentBlock.type === "text");
  return textBlocks.map((contentBlock) => String(contentBlock.text ?? "")).join("\n").replace(/\r/g, "");
}
function stripTrailingNotice(text) {
  const normalized = (text ?? "").replace(/\r/g, "").trimEnd();
  if (!normalized) return "";
  if (normalized.startsWith("[") && normalized.endsWith("]")) return "";
  const noticeStart = normalized.lastIndexOf("\n\n[");
  if (noticeStart >= 0 && normalized.endsWith("]")) {
    return normalized.slice(0, noticeStart).trimEnd();
  }
  return normalized;
}
function extractTrailingNotice(text) {
  const normalized = (text ?? "").replace(/\r/g, "").trimEnd();
  if (!normalized) return null;
  if (normalized.startsWith("[") && normalized.endsWith("]")) return normalized;
  const noticeStart = normalized.lastIndexOf("\n\n[");
  if (noticeStart >= 0 && normalized.endsWith("]")) {
    return normalized.slice(noticeStart + 2).trimEnd();
  }
  return null;
}
function countLines(text) {
  const normalized = (text ?? "").replace(/\r/g, "").replace(/\n+$/g, "");
  if (!normalized) return 0;
  return normalized.split("\n").length;
}
function countWords(text) {
  let count = 0;
  let inWord = false;
  for (const char of text) {
    const isWord = /[\p{L}\p{N}_'-]/u.test(char);
    if (isWord && !inWord) count++;
    inWord = isWord;
  }
  return count;
}
function formatCompactCount(value) {
  if (value < 1e3) return `${Math.round(value)}`;
  if (value < 1e4) return `${(value / 1e3).toFixed(1)}k`;
  if (value < 1e6) return `${Math.round(value / 1e3)}k`;
  if (value < 1e7) return `${(value / 1e6).toFixed(1)}M`;
  return `${Math.round(value / 1e6)}M`;
}
function formatBoxedWords(text) {
  return `\u270E ~${formatCompactCount(countWords(text))} words`;
}
var BOX_HORIZONTAL = "\u2500";
var BOX_VERTICAL = "\u2502";
var BOX_SIDE_PADDING = 2;
var BOX_MIN_WIDTH = 12;
var COMPACT_TOOL_NAME_WIDTH = safeVisibleWidth("Search");
var COMPACT_FOOTER_ELAPSED_WIDTH = 8;
var COMPACT_FOOTER_EXTRA_WIDTH = 8;
var COMPACT_FOOTER_WORDS_WIDTH = safeVisibleWidth("\u270E ~1.2k words");
function boxWidth(width) {
  return Math.max(BOX_MIN_WIDTH, width);
}
function boxInnerWidth(width) {
  return Math.max(1, boxWidth(width) - 2 - BOX_SIDE_PADDING * 2);
}
function boxedToolWidthKey(toolName, detail) {
  return `${toolName}:${detail}`;
}
function formatToolName(toolName) {
  const spaced = toolName.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").trim();
  return spaced.replace(/\b\w/g, (char) => char.toUpperCase()) || toolName;
}
function formatToolParamName(name) {
  const spaced = name.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : name;
}
var MAX_PARAM_VALUE_LENGTH = 120;
function formatOperationSummary(value) {
  if (!Array.isArray(value) || value.length === 0) return void 0;
  if (!value.every((item) => item && typeof item === "object" && !Array.isArray(item))) return void 0;
  const types = Array.from(new Set(value.map((item) => String(item.type ?? "operation"))));
  const typeSummary = types.length === 1 ? ` (${types[0]})` : types.length > 1 ? ` (${types.slice(0, 3).join(", ")}${types.length > 3 ? ", \u2026" : ""})` : "";
  return `${value.length} ${value.length === 1 ? "operation" : "operations"}${typeSummary}`;
}
function formatToolParamValue(value) {
  if (value === void 0) return "";
  if (value === null) return "null";
  if (typeof value === "string") {
    if (value.length <= MAX_PARAM_VALUE_LENGTH) return value;
    return value.slice(0, MAX_PARAM_VALUE_LENGTH) + "\u2026";
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return formatOperationSummary(value) ?? `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    return `{${keys.length} ${keys.length === 1 ? "key" : "keys"}}`;
  }
  try {
    const json = JSON.stringify(value);
    if (json.length <= MAX_PARAM_VALUE_LENGTH) return json;
    return json.slice(0, MAX_PARAM_VALUE_LENGTH) + "\u2026";
  } catch {
    return String(value);
  }
}
function formatToolParamLines(args, theme) {
  if (args === void 0 || args === null) return [];
  if (typeof args !== "object" || Array.isArray(args)) {
    const value = formatToolParamValue(args);
    return value ? [`Params: ${value}`] : [];
  }
  const entries = Object.entries(args).filter(([, value]) => value !== void 0);
  if (entries.length === 0) return [];
  const lines = [];
  for (const [key, value] of entries) {
    const formattedValue = formatToolParamValue(value);
    if (!formattedValue) continue;
    const [firstLine = "", ...restLines] = formattedValue.replace(/\r/g, "").split("\n");
    const keyLabel = formatToolParamName(key);
    if (theme) {
      lines.push(`${theme.fg("dim", keyLabel + ":")} ${theme.fg("text", firstLine)}`);
      lines.push(...restLines.map((line) => `  ${theme.fg("text", line)}`));
    } else {
      lines.push(`${keyLabel}: ${firstLine}`);
      lines.push(...restLines.map((line) => `  ${line}`));
    }
  }
  return lines;
}
var RESET_INTENSITY = "\x1B[22m";
function themeBg(theme, bgName, text) {
  const pageBg = getThemePageBackground(theme);
  if (pageBg) {
    const bgAnsi = bgHexAnsi(theme, pageBg);
    if (bgAnsi) return wrapAnsiBackground(text, bgAnsi);
  }
  const varBg = getThemeVarBackground(theme, bgName);
  if (varBg) {
    const bgAnsi = bgHexAnsi(theme, varBg);
    if (bgAnsi) return wrapAnsiBackground(text, bgAnsi);
  }
  try {
    if (typeof theme?.getBgAnsi === "function") {
      const bgAnsi = String(theme.getBgAnsi(bgName) ?? "");
      if (bgAnsi && bgAnsi !== RESET_BACKGROUND) return wrapAnsiBackground(text, bgAnsi);
    }
  } catch {
  }
  try {
    return typeof theme?.bg === "function" ? theme.bg(bgName, text) : text;
  } catch {
    return text;
  }
}
function colorFromExtra(theme, extraKey, fallbackColor, text) {
  const color2 = getThemeExtra(theme, extraKey);
  if (color2) {
    if (isHexColor(color2)) return fgHex(theme, color2, text);
    try {
      return typeof theme?.fg === "function" ? theme.fg(color2, text) : text;
    } catch {
    }
  }
  return typeof theme?.fg === "function" ? theme.fg(fallbackColor, text) : text;
}
function formatBoxedStatusIcon(theme, isError) {
  const icon = isError ? "\u2717" : "\u2713";
  return typeof theme?.fg === "function" ? theme.fg(isError ? "error" : "success", icon) : icon;
}
function formatBoxedToolTitle(theme, name, isError) {
  const rawTitle = `\u2794 ${name}`;
  const coloredTitle = `${colorFromExtra(theme, "bashPromptColor", "bashMode", rawTitle)} ${formatBoxedStatusIcon(theme, isError)}`;
  const title = typeof theme?.bold === "function" ? theme.bold(coloredTitle) : coloredTitle;
  return `${title} ${boxText(theme, "|")}`;
}
function formatCompactBoxedToolTitle(theme, name, isError) {
  const paddedName = padVisibleRight(name, COMPACT_TOOL_NAME_WIDTH);
  const rawTitle = `\u2794 ${paddedName}`;
  const coloredTitle = `${colorFromExtra(theme, "bashPromptColor", "bashMode", rawTitle)} ${formatBoxedStatusIcon(theme, isError)}`;
  const title = typeof theme?.bold === "function" ? theme.bold(coloredTitle) : coloredTitle;
  return `${title} ${boxText(theme, "|")}`;
}
function boxText(theme, text) {
  return `${RESET_INTENSITY}${theme.fg("borderMuted", text)}`;
}
function boxFrameText(theme, text) {
  return `${RESET_INTENSITY}${theme.fg("border", text)}`;
}
function boxedToolBgName(isError, isPartial) {
  return isPartial ? "toolPendingBg" : isError ? "toolErrorBg" : "toolSuccessBg";
}
function boxBg(theme, text, bgName = "toolSuccessBg") {
  return themeBg(theme, bgName, text);
}
function boxBgLines(theme, lines, bgName = "toolSuccessBg") {
  return lines.map((line) => boxBg(theme, line, bgName));
}
function boxBorder(theme, left, right, width) {
  const renderedWidth = boxWidth(width);
  const innerWidth = renderedWidth - 2;
  return boxFrameText(theme, `${left}${BOX_HORIZONTAL.repeat(innerWidth)}${right}`);
}
function padVisibleRight(text, width) {
  return `${text}${" ".repeat(Math.max(0, width - safeVisibleWidth(text)))}`;
}
function boxLineWithRight(theme, left, right, width) {
  const renderedWidth = boxWidth(width);
  const contentWidth = boxInnerWidth(renderedWidth);
  const divider = ` ${boxText(theme, "|")} `;
  const dividerWidth = safeVisibleWidth(divider);
  const rightWidth = safeVisibleWidth(right);
  const sidePad = " ".repeat(BOX_SIDE_PADDING);
  if (!right || rightWidth + dividerWidth >= contentWidth) {
    return boxLine(theme, right || left, renderedWidth);
  }
  const maxLeftWidth = Math.max(1, contentWidth - dividerWidth - rightWidth - 1);
  const truncatedLeft = safeTruncateToWidth(left, maxLeftWidth, "\u2026");
  const gap = " ".repeat(Math.max(1, contentWidth - safeVisibleWidth(truncatedLeft) - dividerWidth - rightWidth));
  return `${boxFrameText(theme, BOX_VERTICAL)}${sidePad}${truncatedLeft}${gap}${divider}${right}${sidePad}${boxFrameText(theme, BOX_VERTICAL)}`;
}
function boxLine(theme, content, width) {
  const renderedWidth = boxWidth(width);
  const contentWidth = boxInnerWidth(renderedWidth);
  const fastContent = fastBoxLineContent(content, contentWidth);
  const sidePad = " ".repeat(BOX_SIDE_PADDING);
  if (fastContent) {
    const counter = fastContent.kind === "ascii" ? "boxLine.fastAscii" : fastContent.kind === "sgrAscii" ? "boxLine.fastSgrAscii" : fastContent.kind === "simple" ? "boxLine.fastSimple" : "boxLine.fastSgrSimple";
    profileCount(counter);
    const fill2 = " ".repeat(Math.max(0, contentWidth - fastContent.visibleWidth));
    return `${boxFrameText(theme, BOX_VERTICAL)}${sidePad}${fastContent.text}${fill2}${sidePad}${boxFrameText(theme, BOX_VERTICAL)}`;
  }
  profileCount("boxLine.fallback");
  const truncated = safeTruncateToWidth(content, contentWidth, "\u2026");
  const fill = " ".repeat(Math.max(0, contentWidth - safeVisibleWidth(truncated)));
  return `${boxFrameText(theme, BOX_VERTICAL)}${sidePad}${truncated}${fill}${sidePad}${boxFrameText(theme, BOX_VERTICAL)}`;
}
function boxInsetDivider(theme, width) {
  const renderedWidth = boxWidth(width);
  const lineWidth = boxInnerWidth(renderedWidth);
  const sidePad = " ".repeat(BOX_SIDE_PADDING);
  return `${boxFrameText(theme, BOX_VERTICAL)}${sidePad}${boxText(theme, BOX_HORIZONTAL.repeat(lineWidth))}${sidePad}${boxFrameText(theme, BOX_VERTICAL)}`;
}
function boxedWrappedLines(theme, content, width) {
  return safeWrapTextWithAnsi(content, boxInnerWidth(width)).map((line) => boxLine(theme, line, width));
}
function boxedTruncatedLine(theme, content, width) {
  return boxLine(theme, safeTruncateToWidth(content, boxInnerWidth(width), "\u2026"), width);
}
function pushBoundedLines(target, lines, maxLines) {
  const slots = maxLines - target.length;
  if (slots <= 0) return false;
  if (lines.length > slots) {
    target.push(...lines.slice(0, slots));
    return false;
  }
  target.push(...lines);
  return true;
}
function renderBoxedOutputLines(theme, outputLines, width, rawLineBudget = DEFAULT_COLLAPSED_RENDER_LINES) {
  const budget = boxedResultRenderBudget(rawLineBudget);
  const headLimit = Math.max(0, Math.min(budget.headLines, budget.maxRenderedLines));
  const tailLimit = Math.max(0, Math.min(budget.tailLines, Math.max(0, budget.maxRenderedLines - headLimit - 1)));
  const head = [];
  let nextInputIndex = 0;
  let truncated = false;
  for (; nextInputIndex < outputLines.length; nextInputIndex++) {
    const line = boxedTruncatedLine(theme, outputLines[nextInputIndex] ?? "", width);
    if (!pushBoundedLines(head, [line], headLimit)) {
      truncated = true;
      nextInputIndex++;
      break;
    }
  }
  if (!truncated && nextInputIndex >= outputLines.length) return head;
  const tail = [];
  const tailStart = Math.max(nextInputIndex, outputLines.length - tailLimit);
  for (let i = tailStart; i < outputLines.length; i++) {
    const line = boxedTruncatedLine(theme, outputLines[i] ?? "", width);
    tail.push(line);
    if (tail.length > tailLimit) tail.splice(0, tail.length - tailLimit);
  }
  const skippedInputLines = Math.max(0, tailStart - nextInputIndex);
  const skippedText = skippedInputLines > 0 ? `\u2026 rendered output truncated; ${skippedInputLines} input lines skipped before tail` : "\u2026 rendered output truncated";
  return [...head, boxLine(theme, theme.fg("muted", skippedText), width), ...tail];
}
function isReasonixPresentation() {
  return getPresentationDesign().compactLayout;
}
function reasonixEllipsis(theme) {
  return typeof theme?.fg === "function" ? theme.fg("dim", " \u2026") : " \u2026";
}
function truncateReasonixLine(theme, text, width) {
  const content = trimTrailingRenderPadding(text);
  const rowWidth = Math.max(1, Math.floor(width));
  if (safeVisibleWidth(content) <= rowWidth) return content;
  return safeTruncateToWidth(content, rowWidth, reasonixEllipsis(theme));
}
function renderReasonixInlineFooter(theme, left, right, width) {
  const footer = toSingleRenderLine(right);
  const footerWidth = safeVisibleWidth(footer);
  if (footerWidth + 2 >= width) return truncateReasonixLine(theme, `${left} ${footer}`, width);
  const leftWidth = Math.max(1, width - footerWidth - 1);
  const truncatedLeft = truncateReasonixLine(theme, left, leftWidth);
  return `${padVisibleRight(truncatedLeft, leftWidth)} ${footer}`;
}
var REASONIX_PENDING_FRAMES = ["\u25D0", "\u25D3", "\u25D1", "\u25D2"];
var REASONIX_PENDING_FRAME_INTERVAL_MS = 160;
function reasonixPendingMarker() {
  return REASONIX_PENDING_FRAMES[Math.floor(Date.now() / REASONIX_PENDING_FRAME_INTERVAL_MS) % REASONIX_PENDING_FRAMES.length];
}
var REASONIX_MAX_TOOL_CALL_ROWS = 3;
function renderReasonixWrappedToolRows(theme, markerTitle, detailRows, pending, rowWidth, maxRows) {
  const detail = detailRows.map((row) => toSingleRenderLine(row).trim()).filter((row) => stripAnsi(row).length > 0).join(" ");
  const detailStart = safeVisibleWidth(markerTitle) + 1;
  if (detailStart >= rowWidth) {
    const contentWidth = Math.max(1, rowWidth - safeVisibleWidth("     "));
    const text = `${markerTitle}${detail ? ` ${detail}` : ""}${pending}`;
    const wrapped2 = safeWrapTextWithAnsi(text, contentWidth).map(trimTrailingRenderPadding);
    const rows2 = wrapped2.slice(0, Math.max(1, maxRows));
    if (wrapped2.length > rows2.length) {
      const lastIndex = rows2.length - 1;
      const ellipsis = reasonixEllipsis(theme);
      const lastWidth = Math.max(1, contentWidth - safeVisibleWidth(ellipsis));
      rows2[lastIndex] = `${safeTruncateToWidth(rows2[lastIndex] ?? "", lastWidth, "")}${ellipsis}`;
    }
    return rows2.map((line, index) => index === 0 ? line : `     ${line}`);
  }
  const payload = `${detail ? `${detail}` : ""}${pending}`;
  const payloadPrefix = detail ? " " : "";
  const payloadWidth = Math.max(1, rowWidth - detailStart);
  const connector = `  ${theme.fg("dim", "\u2502")}${" ".repeat(Math.max(0, detailStart - 3))}`;
  const wrappedPayload = safeWrapTextWithAnsi(payload, payloadWidth).map(trimTrailingRenderPadding);
  const wrapped = wrappedPayload.length > 0 ? wrappedPayload : [""];
  const rowCount = Math.min(wrapped.length, Math.max(1, maxRows));
  const rows = [];
  for (let index = 0; index < rowCount; index++) {
    let content = wrapped[index] ?? "";
    if (wrapped.length > rowCount && index === rowCount - 1) {
      const ellipsis = reasonixEllipsis(theme);
      const contentWidth = Math.max(1, payloadWidth - safeVisibleWidth(ellipsis));
      content = `${safeTruncateToWidth(content, contentWidth, "")}${ellipsis}`;
    }
    rows.push(index === 0 ? `${markerTitle}${payloadPrefix}${content}` : `${connector}${content}`);
  }
  return rows;
}
function renderReasonixToolRow(theme, toolName, detail, options = {}) {
  return {
    invalidate() {
    },
    render(width) {
      const compactFooter = typeof options.state?.[COMPACT_FOOTER_KEY] === "string" ? options.state[COMPACT_FOOTER_KEY] : "";
      const isError = Boolean(options.isError || options.state?.[COMPACT_FOOTER_ERROR_KEY]);
      const isPartial = Boolean(options.isPartial || options.state?.[COMPACT_FOOTER_PARTIAL_KEY]);
      const coloredName = colorFromExtra(theme, "bashPromptColor", "bashMode", toolName);
      const title = typeof theme?.bold === "function" ? theme.bold(coloredName) : coloredName;
      const pending = options.isPending ? ` \xB7 ${theme.fg("dim", options.pendingText ?? "Waiting for output\u2026")}` : "";
      const marker = isError ? "\u2717" : options.isPending || isPartial ? reasonixPendingMarker() : "\u2713";
      const markerColor = isError ? "error" : options.isPending || isPartial ? "accent" : "success";
      const rowWidth = getReasonixCollapsedRowWidth(width);
      const markerTitle = `${theme.fg(markerColor, marker)} ${title}`;
      const detailRows = options.detailRows ?? [detail];
      let rows;
      if ((options.maxRows ?? 1) > 1) {
        rows = renderReasonixWrappedToolRows(theme, markerTitle, detailRows, pending, rowWidth, options.maxRows ?? 1);
      } else {
        const headerText = toSingleRenderLine(`${markerTitle}${detail ? ` ${detail}` : ""}${pending}`);
        const header = options.inlineFooter && compactFooter ? renderReasonixInlineFooter(theme, headerText, compactFooter, rowWidth) : truncateReasonixLine(theme, headerText, rowWidth);
        rows = [header];
      }
      if (!compactFooter || options.inlineFooter) return rows;
      const footerWidth = getToolBodyWidth(rowWidth, 5);
      const footerText = toSingleRenderLine(compactFooter);
      const footer = `  ${theme.fg("dim", "\u2514\u2500 ")}${truncateReasonixLine(theme, footerText, footerWidth)}`;
      return [...rows, footer];
    }
  };
}
function renderReasonixToolBody(theme, body, options = {}) {
  let cache = null;
  return {
    invalidate() {
      cache = null;
      if (typeof body !== "function") body.invalidate();
    },
    render(width) {
      if (cache?.width === width) return cache.lines;
      const firstPrefix = `  ${theme.fg("dim", "\u2514\u2500 ")}`;
      const contentIndent = safeVisibleWidth(firstPrefix);
      const continuationPrefix = " ".repeat(contentIndent);
      const bodyWidth = getToolBodyWidth(width, contentIndent);
      const bodyLines = typeof body === "function" ? body(bodyWidth) : body.render(bodyWidth);
      const outputLines = bodyLines.length > 0 ? bodyLines : [theme.fg("muted", `\u2205 ${options.emptyText ?? "(no output)"}`)];
      const limited = options.renderLineBudget === void 0 ? outputLines : outputLines.slice(0, options.renderLineBudget);
      const rendered = [
        ...limited.map((line, index) => `${index === 0 ? firstPrefix : continuationPrefix}${truncateReasonixLine(theme, line, bodyWidth)}`),
        ...(options.footerLines ?? []).map((line) => `${continuationPrefix}${truncateReasonixLine(theme, line, bodyWidth)}`)
      ];
      cache = { width, lines: rendered };
      return rendered;
    }
  };
}
function setCompactBoxedFooter(state2, footer, options = {}) {
  if (!state2 || typeof state2 !== "object") return;
  state2[COMPACT_FOOTER_KEY] = footer;
  state2[COMPACT_FOOTER_ERROR_KEY] = Boolean(options.isError);
  state2[COMPACT_FOOTER_PARTIAL_KEY] = Boolean(options.isPartial);
}
function renderBoxedToolCall(theme, toolName, detailLines, options = {}) {
  if (isReasonixPresentation()) return renderReasonixToolRow(theme, toolName, detailLines[0] ?? "", {
    ...options,
    detailRows: detailLines,
    maxRows: REASONIX_MAX_TOOL_CALL_ROWS
  });
  let cache = null;
  return {
    invalidate() {
      cache = null;
    },
    render(width) {
      if (cache?.width === width) return cache.lines;
      const title = formatBoxedToolTitle(theme, toolName, options.isError);
      const renderedWidth = boxWidth(width);
      const lines = [
        boxBorder(theme, "\u250C", "\u2510", renderedWidth),
        boxLine(theme, title, renderedWidth),
        boxInsetDivider(theme, renderedWidth),
        ...detailLines.flatMap((line) => boxedWrappedLines(theme, line, renderedWidth))
      ];
      if (options.isPending) {
        const pendingText = options.pendingText ?? "Waiting for output\u2026";
        lines.push(
          boxInsetDivider(theme, renderedWidth),
          ...boxedWrappedLines(theme, `${theme.fg("muted", "\u2026")} ${theme.fg("dim", pendingText)}`, renderedWidth),
          boxBorder(theme, "\u2514", "\u2518", renderedWidth)
        );
      }
      const rendered = boxBgLines(theme, lines, boxedToolBgName(options.isError, options.isPartial));
      cache = { width, lines: rendered };
      return rendered;
    }
  };
}
var COMPACT_FOOTER_KEY = "__droidCompactFooter";
var COMPACT_FOOTER_ERROR_KEY = "__droidCompactFooterError";
var COMPACT_FOOTER_PARTIAL_KEY = "__droidCompactFooterPartial";
function clearCompactBoxedFooter(state2) {
  if (!state2 || typeof state2 !== "object") return;
  delete state2[COMPACT_FOOTER_KEY];
  delete state2[COMPACT_FOOTER_ERROR_KEY];
  delete state2[COMPACT_FOOTER_PARTIAL_KEY];
}
function renderCompactBoxedToolCall(theme, toolName, detailLine, options = {}) {
  if (isReasonixPresentation()) return renderReasonixToolRow(theme, toolName, detailLine, { ...options, inlineFooter: true });
  return {
    invalidate() {
    },
    render(width) {
      const renderedWidth = boxWidth(width);
      const title = `${formatCompactBoxedToolTitle(theme, toolName, options.isError)} ${detailLine}`;
      const compactFooter = typeof options.state?.[COMPACT_FOOTER_KEY] === "string" ? options.state[COMPACT_FOOTER_KEY] : "";
      const footerIsError = Boolean(options.state?.[COMPACT_FOOTER_ERROR_KEY]);
      const footerIsPartial = Boolean(options.state?.[COMPACT_FOOTER_PARTIAL_KEY]);
      if (compactFooter) {
        return boxBgLines(theme, [
          boxBorder(theme, "\u250C", "\u2510", renderedWidth),
          boxLineWithRight(theme, title, compactFooter, renderedWidth),
          boxBorder(theme, "\u2514", "\u2518", renderedWidth)
        ], boxedToolBgName(footerIsError || options.isError, footerIsPartial || options.isPartial));
      }
      const lines = [boxBorder(theme, "\u250C", "\u2510", renderedWidth), boxLine(theme, title, renderedWidth)];
      if (options.isPending) {
        const pendingText = options.pendingText ?? "Waiting for output\u2026";
        lines.push(
          boxInsetDivider(theme, renderedWidth),
          ...boxedWrappedLines(theme, `${theme.fg("muted", "\u2026")} ${theme.fg("dim", pendingText)}`, renderedWidth),
          boxBorder(theme, "\u2514", "\u2518", renderedWidth)
        );
      }
      return boxBgLines(theme, lines, boxedToolBgName(options.isError, options.isPartial));
    }
  };
}
function renderBoxedToolResult(theme, body, options = {}) {
  if (isReasonixPresentation()) return renderReasonixToolBody(theme, body, options);
  let cache = null;
  return {
    invalidate() {
      cache = null;
      if (typeof body !== "function") body.invalidate();
    },
    render(width) {
      if (cache?.width === width) return cache.lines;
      const renderedWidth = boxWidth(width);
      const maxContentWidth = boxInnerWidth(renderedWidth);
      const bodyLines = typeof body === "function" ? body(maxContentWidth) : body.render(maxContentWidth);
      const errorPrefix = options.isError ? [theme.fg("error", "\u2717 Error")] : [];
      const outputLines = bodyLines.length > 0 ? [...errorPrefix, ...bodyLines] : [theme.fg("muted", `\u2205 ${options.emptyText ?? "(no output)"}`)];
      const footerLines = options.footerLines ?? [];
      const renderedFooterLines = footerLines.length > 0 ? [boxInsetDivider(theme, renderedWidth), ...footerLines.map((line) => boxLine(theme, line, renderedWidth))] : [];
      const rendered = boxBgLines(theme, [
        boxInsetDivider(theme, renderedWidth),
        ...renderBoxedOutputLines(theme, outputLines, renderedWidth, options.renderLineBudget ?? outputLines.length),
        ...renderedFooterLines,
        boxBorder(theme, "\u2514", "\u2518", renderedWidth)
      ], boxedToolBgName(options.isError, options.isPartial));
      cache = { width, lines: rendered };
      return rendered;
    }
  };
}
function formatBoxedFooterFromValues(theme, elapsedMs, output, extraParts = [], fixedColumns = false) {
  const wall = elapsedMs === void 0 ? "--" : `${(elapsedMs / 1e3).toFixed(2)}s`;
  const elapsedPart = `${theme.fg("text", "\u25F7")} ${theme.fg("dim", wall)}`;
  const extraPartList = extraParts.filter(Boolean).map((part) => theme.fg("dim", part));
  const wordsPart = theme.fg("dim", formatBoxedWords(output));
  const parts = fixedColumns ? [
    padVisibleRight(elapsedPart, COMPACT_FOOTER_ELAPSED_WIDTH),
    ...extraPartList.map((part) => padVisibleRight(part, COMPACT_FOOTER_EXTRA_WIDTH)),
    padVisibleRight(wordsPart, COMPACT_FOOTER_WORDS_WIDTH)
  ] : [elapsedPart, ...extraPartList, wordsPart];
  return parts.join(theme.fg("dim", " \xB7 "));
}
function formatBoxedFooterParts(theme, result, extraParts = [], fixedColumns = false) {
  return formatBoxedFooterFromValues(theme, getElapsedMs(result), getTextOutput(result), extraParts, fixedColumns);
}
function formatBoxedFooter(theme, result, extraParts = []) {
  return formatBoxedFooterParts(theme, result, extraParts);
}
function renderCompactBoxedFooter(theme, result, options = {}) {
  if (options.state && typeof options.state === "object") {
    setCompactBoxedFooter(options.state, formatBoxedFooterParts(theme, result, [], true), options);
    return { invalidate() {
    }, render: () => [] };
  }
  return {
    invalidate() {
    },
    render(width) {
      const renderedWidth = boxWidth(width);
      return boxBgLines(theme, [
        boxLine(theme, formatBoxedFooterParts(theme, result), renderedWidth),
        boxBorder(theme, "\u2514", "\u2518", renderedWidth)
      ], boxedToolBgName(options.isError, options.isPartial));
    }
  };
}
var TOOL_BODY_INDENT = 2;
var TOOL_RIGHT_MARGIN = 1;
function getToolBodyWidth(width, spaces = TOOL_BODY_INDENT) {
  return Math.max(1, width - spaces - TOOL_RIGHT_MARGIN);
}
function clampLine(line) {
  return clampRenderLine(line);
}
function formatToolOutputLine(theme, line, color2 = "toolOutput") {
  if (color2 === "error") return theme.fg("error", line);
  const clean = stripAnsi(line);
  if (/^##\s/.test(clean)) return theme.fg("muted", line);
  if (/^\?\?\s/.test(clean)) return theme.bold(theme.fg("syntaxVariable", line));
  return theme.fg(color2, line);
}
function selectRenderLines(text, maxLines, tail = false) {
  const source = text ?? "";
  if (!source) return { lines: [], omitted: 0 };
  const limit = Math.max(0, maxLines);
  const selected = [];
  let lineCount = 0;
  let lineStart = 0;
  for (let i = 0; i <= source.length; i++) {
    if (i < source.length && source[i] !== "\n") continue;
    const rawLine = source.slice(lineStart, i).replace(/\r/g, "");
    lineCount++;
    if (limit > 0) {
      const line = clampLine(rawLine);
      if (tail) {
        selected.push(line);
        if (selected.length > limit) selected.shift();
      } else if (selected.length < limit) {
        selected.push(line);
      }
    }
    lineStart = i + 1;
  }
  if (selected.length === 1 && selected[0] === "") return { lines: [], omitted: 0 };
  return { lines: selected, omitted: Math.max(0, lineCount - selected.length) };
}
function renderLines(theme, text, options, cfg = { maxLines: 10 }) {
  const color2 = cfg.color ?? "toolOutput";
  const { lines, omitted } = selectRenderLines(text, cfg.maxLines, cfg.tail);
  const renderWidth = cfg.width ? getToolBodyWidth(cfg.width) : void 0;
  const renderLine = (line) => {
    const rendered = renderWidth ? safeTruncateToWidth(line, renderWidth, "\u2026") : line;
    return formatToolOutputLine(theme, rendered, color2);
  };
  if (lines.length === 0) return "";
  let output = lines.map(renderLine).join("\n");
  if (omitted <= 0) return output;
  const hintText = isExpanded(options) ? `... ${omitted} more lines omitted by render budget` : `... ${omitted} more lines, press Ctrl+o to expand`;
  const hint = cfg.width ? safeTruncateToWidth(hintText, Math.max(1, cfg.width - 1), "\u2026") : hintText;
  output += theme.fg("muted", `

${hint}`);
  return output;
}

// tool-tags/bash.ts
var MAX_BASH_PREVIEW_LINES = 5;
var MAX_LINE_CHARS = 2e3;
var BASH_TOOL_NOTICE_PATTERN = /^\[Showing (?:last|lines)\b.*\. Full output: .+\]$/;
var BG_ANSI_PATTERN = /\x1b\[4[0-9;]*m/g;
var SHELL_VAR_PATTERN = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/;
var SHELL_OP_PATTERN = /^(?:&&|\|\||>>|>&|\|&|[|&;()<>])$/;
function highlightBashFallback(line) {
  try {
    const highlighted = highlightCode(line, "bash")[0] ?? line;
    return highlighted.replace(BG_ANSI_PATTERN, "");
  } catch {
    return line;
  }
}
function normalizeShellWord(word) {
  return word.replace(/^(['"])(.*)\1$/, "$2");
}
function colorShellWord(theme, word, commandExpected) {
  const normalized = normalizeShellWord(word);
  if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(normalized)) return theme.fg("syntaxVariable", word);
  if (normalized.startsWith("-")) return theme.fg("syntaxKeyword", word);
  if (normalized.includes("/") || /^\.{1,2}(?:\/|$)/.test(normalized)) return theme.fg("syntaxVariable", word);
  if (SHELL_VAR_PATTERN.test(normalized)) return theme.fg("syntaxVariable", word);
  return commandExpected ? theme.fg("syntaxFunction", word) : theme.fg("syntaxString", word);
}
function tokenizeShellLinePreservingText(line) {
  const tokens = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i] ?? "";
    const next = line[i + 1] ?? "";
    if (quote) {
      current += char;
      if (char === "\\" && next) current += line[++i] ?? "";
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      tokens.push(char);
      continue;
    }
    if (char === "#" && !current) {
      if (current) tokens.push(current);
      tokens.push(line.slice(i));
      return tokens;
    }
    const two = `${char}${next}`;
    if (SHELL_OP_PATTERN.test(two) || SHELL_OP_PATTERN.test(char)) {
      if (current) tokens.push(current);
      current = "";
      if (SHELL_OP_PATTERN.test(two)) {
        tokens.push(two);
        i++;
      } else {
        tokens.push(char);
      }
      continue;
    }
    current += char;
  }
  if (quote) return void 0;
  if (current) tokens.push(current);
  return tokens;
}
function highlightBashLine(line, theme) {
  const tokens = tokenizeShellLinePreservingText(line);
  if (!tokens) return highlightBashFallback(line);
  let commandExpected = true;
  return tokens.map((token) => {
    if (/^\s+$/.test(token)) return token;
    if (token.startsWith("#")) return theme.fg("syntaxComment", token);
    if (SHELL_OP_PATTERN.test(token)) {
      commandExpected = token === "|" || token === "||" || token === "&&" || token === ";" || token === "&";
      return theme.fg("syntaxOperator", token);
    }
    const styled = colorShellWord(theme, token, commandExpected);
    if (!/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(normalizeShellWord(token))) commandExpected = false;
    return styled;
  }).join("");
}
function clampLineLength(line, max = MAX_LINE_CHARS) {
  if (line.length <= max) return line;
  return line.slice(0, max) + "\u2026 (truncated)";
}
function countNewlines(text, from, to) {
  let count = 0;
  for (let i = from; i < to; i++) {
    if (text.charCodeAt(i) === 10) count++;
  }
  return count;
}
function stripBashToolNoticeLines(text) {
  const filteredLines = text.replace(/\r/g, "").split("\n").filter((line) => !BASH_TOOL_NOTICE_PATTERN.test(line.trim()));
  return filteredLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}
function bashWidthKey(rawCommand, timeout) {
  return boxedToolWidthKey("Bash", `${rawCommand}|${timeout ?? ""}`);
}
function renderBoxedBashCall(theme, commandLines, timeout, widthKey, context) {
  const maxCommandLines = 5;
  const shownCount = Math.min(commandLines.length, maxCommandLines + 1);
  const detailLines = [];
  const usesReasonix = getPresentationDesign().compactLayout;
  for (let i = 0; i < shownCount; i++) {
    const prefix = i === 0 ? usesReasonix ? "" : theme.fg("dim", "$ ") : theme.fg("dim", "> ");
    detailLines.push(`${prefix}${highlightBashLine(commandLines[i] ?? "", theme)}`);
  }
  if (commandLines.length > maxCommandLines + 1) {
    detailLines.push(theme.fg("muted", `... ${commandLines.length - maxCommandLines - 1} more lines`));
  }
  return renderBoxedToolCall(theme, "Bash", detailLines, {
    widthKey,
    isError: Boolean(context?.isError),
    isPartial: Boolean(context?.isPartial),
    isPending: Boolean(context?.isPartial && !context?.hasResult)
  });
}
function formatTimeout(context) {
  const timeout = context?.args?.timeout ?? 300;
  return `${timeout}s`;
}
function renderBoxedBashResult(theme, inner, result, context) {
  const rawCommand = String(context?.args?.command ?? "...");
  const timeout = context?.args?.timeout;
  const referenceLines = rawCommand.split("\n").map((line, index) => `${index === 0 ? "$ " : "> "}${line}`);
  return renderBoxedToolResult(theme, inner, {
    widthKey: bashWidthKey(rawCommand, timeout),
    referenceLines,
    footerLines: [formatBoxedFooter(theme, result, [`\u23F9 ${formatTimeout(context)}`])],
    isError: context?.isError,
    isPartial: Boolean(context?.isPartial)
  });
}
function createBashResultPreview(theme, text, options, color2, extraLinesBefore = 0, state2) {
  let cacheKey = "";
  let cacheLines = null;
  return {
    invalidate() {
      cacheKey = "";
      cacheLines = null;
    },
    render(width) {
      const bodyWidth = Math.max(1, width);
      const cfg = loadConfig();
      const expanded = isExpanded(options);
      const cacheId = `${bodyWidth}|${expanded ? 1 : 0}|${cfg.maxExpandedLines}|${cfg.dimToolOutput ? 1 : 0}`;
      if (cacheLines && cacheKey === cacheId) return cacheLines;
      if (!expanded) {
        const needed = MAX_BASH_PREVIEW_LINES;
        let totalNewlines = 0;
        let scanFrom = 0;
        for (let i = text.length - 1; i >= 0; i--) {
          if (text.charCodeAt(i) === 10) {
            totalNewlines++;
            if (totalNewlines === needed) {
              scanFrom = i + 1;
              break;
            }
          }
        }
        if (text.length === 0) {
          cacheKey = cacheId;
          cacheLines = [];
          return cacheLines;
        }
        const tail = replaceTabs(text.slice(scanFrom)).replace(/\r/g, "");
        const shownLines = tail ? tail.split("\n").map((l) => clampLineLength(l)) : [];
        if (shownLines.length === 0) {
          cacheKey = cacheId;
          cacheLines = [];
          return cacheLines;
        }
        const truncatedShown = shownLines.map((line) => {
          const truncated = safeTruncateToWidth(line, bodyWidth, "\u2026");
          if (color2 === "error") return formatToolOutputLine(theme, truncated, "error");
          return cfg.dimToolOutput ? formatToolOutputLine(theme, truncated) : formatToolOutputLine(theme, truncated, "text");
        });
        const remaining = extraLinesBefore + (scanFrom > 0 ? countNewlines(text, 0, scanFrom) : 0);
        if (remaining <= 0) {
          cacheKey = cacheId;
          cacheLines = truncatedShown;
          return cacheLines;
        }
        const hint = safeTruncateToWidth(`... ${remaining} more lines, press Ctrl+o to expand`, bodyWidth, "\u2026");
        cacheKey = cacheId;
        cacheLines = [...truncatedShown, "", theme.fg("muted", hint)];
        return cacheLines;
      }
      const normalized = replaceTabs(text);
      const logicalLines = normalized.split("\n").map((l) => clampLineLength(l));
      const hasOutput = !(logicalLines.length === 1 && logicalLines[0] === "");
      if (!hasOutput) {
        cacheKey = cacheId;
        cacheLines = [];
        return cacheLines;
      }
      const truncatedLines = logicalLines.map((line) => safeTruncateToWidth(line, bodyWidth, "\u2026"));
      const expandedLines = truncatedLines.length === 1 && truncatedLines[0] === "" ? [] : truncatedLines;
      const applyColor = (l) => color2 === "error" ? formatToolOutputLine(theme, l, "error") : cfg.dimToolOutput ? formatToolOutputLine(theme, l) : formatToolOutputLine(theme, l, "text");
      if (cfg.maxExpandedLines > 0 && expandedLines.length > cfg.maxExpandedLines) {
        const truncated = expandedLines.slice(-cfg.maxExpandedLines).map(applyColor);
        const remaining = expandedLines.length - cfg.maxExpandedLines;
        truncated.unshift(theme.fg("dim", `\u2026 ${remaining} earlier lines`));
        cacheKey = cacheId;
        cacheLines = truncated;
        return cacheLines;
      }
      cacheKey = cacheId;
      cacheLines = expandedLines.map(applyColor);
      return cacheLines;
    }
  };
}
function registerBashTool(pi) {
  const baseBash = createBashTool(process.cwd());
  pi.registerTool({
    name: baseBash.name,
    label: baseBash.label,
    description: baseBash.description,
    parameters: { ...baseBash.parameters },
    execute: wrapExecuteWithTiming(async (toolCallId, params, signal, onUpdate, ctx) => {
      const tool = createBashTool(ctx.cwd);
      return tool.execute(toolCallId, params, signal, onUpdate);
    }),
    renderCall(args, theme, context) {
      const rawCommand = String(args?.command ?? "...");
      return renderBoxedBashCall(theme, rawCommand.split("\n"), args?.timeout, bashWidthKey(rawCommand, args?.timeout), context);
    },
    renderResult(result, options, theme, context) {
      const raw = getTextOutput(result);
      const outputColor = context?.isError ? "error" : "toolOutput";
      if (!isExpanded(options)) {
        const scanLines = MAX_BASH_PREVIEW_LINES + 10;
        let nlCount = 0;
        let tailStart = 0;
        for (let i = raw.length - 1; i >= 0; i--) {
          if (raw.charCodeAt(i) === 10) {
            nlCount++;
            if (nlCount >= scanLines) {
              tailStart = i + 1;
              break;
            }
          }
        }
        const tail = stripBashToolNoticeLines(stripAnsi(raw.slice(tailStart)));
        const totalLinesBefore = tailStart > 0 ? countNewlines(raw, 0, tailStart) : 0;
        const inner2 = createBashResultPreview(theme, tail, options, outputColor, totalLinesBefore, context?.state);
        return renderBoxedBashResult(theme, inner2, result, context);
      }
      const output = stripBashToolNoticeLines(stripAnsi(raw));
      const inner = createBashResultPreview(theme, output, options, outputColor, 0, context?.state);
      return renderBoxedBashResult(theme, inner, result, context);
    }
  });
}

// tool-tags/edit.ts
import { existsSync as existsSync3 } from "node:fs";
import { join as join3 } from "node:path";
import { pathToFileURL } from "node:url";
import { createEditToolDefinition, getAgentDir, getLanguageFromPath as getLanguageFromPath2 } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

// split-diff.ts
import { highlightCode as highlightCode2 } from "@earendil-works/pi-coding-agent";
var BG_ANSI_PATTERN2 = /\x1b\[(?:4\d|10\d|48;5;\d{1,3}|48;2;\d{1,3};\d{1,3};\d{1,3}|49)m/g;
var ADD_ROW_BACKGROUND_MIX_RATIO = 0.24;
var REMOVE_ROW_BACKGROUND_MIX_RATIO = 0.12;
var ADD_INLINE_EMPHASIS_MIX_RATIO = 0.44;
var REMOVE_INLINE_EMPHASIS_MIX_RATIO = 0.26;
function ansi256ToRgb2(code) {
  if (code <= 15) {
    const base16 = [
      { r: 0, g: 0, b: 0 },
      { r: 128, g: 0, b: 0 },
      { r: 0, g: 128, b: 0 },
      { r: 128, g: 128, b: 0 },
      { r: 0, g: 0, b: 128 },
      { r: 128, g: 0, b: 128 },
      { r: 0, g: 128, b: 128 },
      { r: 192, g: 192, b: 192 },
      { r: 128, g: 128, b: 128 },
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 255, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 },
      { r: 255, g: 0, b: 255 },
      { r: 0, g: 255, b: 255 },
      { r: 255, g: 255, b: 255 }
    ];
    return base16[code] ?? { r: 255, g: 255, b: 255 };
  }
  if (code >= 232) {
    const value = Math.max(0, Math.min(255, 8 + (code - 232) * 10));
    return { r: value, g: value, b: value };
  }
  const cube = code - 16;
  const levels = [0, 95, 135, 175, 215, 255];
  const blue = cube % 6;
  const green = Math.floor(cube / 6) % 6;
  const red = Math.floor(cube / 36) % 6;
  return {
    r: levels[red] ?? 0,
    g: levels[green] ?? 0,
    b: levels[blue] ?? 0
  };
}
function parseAnsiColorCode(ansi) {
  if (!ansi) return null;
  const rgbMatch = /\x1b\[(?:3|4)8;2;(\d{1,3});(\d{1,3});(\d{1,3})m/.exec(ansi);
  if (rgbMatch) {
    const r = Number.parseInt(rgbMatch[1] ?? "0", 10);
    const g = Number.parseInt(rgbMatch[2] ?? "0", 10);
    const b = Number.parseInt(rgbMatch[3] ?? "0", 10);
    return { r, g, b };
  }
  const bitMatch = /\x1b\[(?:3|4)8;5;(\d{1,3})m/.exec(ansi);
  if (bitMatch) {
    const code = Number.parseInt(bitMatch[1] ?? "0", 10);
    return ansi256ToRgb2(code);
  }
  return null;
}
function rgbToBgAnsi(color2) {
  const r = Math.max(0, Math.min(255, Math.round(color2.r)));
  const g = Math.max(0, Math.min(255, Math.round(color2.g)));
  const b = Math.max(0, Math.min(255, Math.round(color2.b)));
  return `\x1B[48;2;${r};${g};${b}m`;
}
function mixRgb(base, tint, ratio) {
  const clamped = Math.max(0, Math.min(1, ratio));
  return {
    r: base.r * (1 - clamped) + tint.r * clamped,
    g: base.g * (1 - clamped) + tint.g * clamped,
    b: base.b * (1 - clamped) + tint.b * clamped
  };
}
function resolveDiffPalette(theme) {
  const baseBg = parseAnsiColorCode(theme.getBgAnsi("toolSuccessBg")) ?? parseAnsiColorCode(theme.getBgAnsi("toolPendingBg")) ?? { r: 32, g: 35, b: 42 };
  const addFg = parseAnsiColorCode(theme.getFgAnsi("toolDiffAdded")) ?? { r: 88, g: 173, b: 88 };
  const removeFg = parseAnsiColorCode(theme.getFgAnsi("toolDiffRemoved")) ?? { r: 196, g: 98, b: 98 };
  const addRowBg = mixRgb(baseBg, addFg, ADD_ROW_BACKGROUND_MIX_RATIO);
  const removeRowBg = mixRgb(baseBg, removeFg, REMOVE_ROW_BACKGROUND_MIX_RATIO);
  const addEmphasisBg = mixRgb(baseBg, addFg, ADD_INLINE_EMPHASIS_MIX_RATIO);
  const removeEmphasisBg = mixRgb(baseBg, removeFg, REMOVE_INLINE_EMPHASIS_MIX_RATIO);
  return {
    addRowBgAnsi: rgbToBgAnsi(addRowBg),
    removeRowBgAnsi: rgbToBgAnsi(removeRowBg),
    addEmphasisBgAnsi: rgbToBgAnsi(addEmphasisBg),
    removeEmphasisBgAnsi: rgbToBgAnsi(removeEmphasisBg)
  };
}
function keepBackgroundAcrossResets(text, rowBgAnsi) {
  if (!text) return text;
  return text.replace(/\x1b\[([0-9;]*)m/g, (sequence, rawCodes) => {
    const split = String(rawCodes ?? "").split(";").filter(Boolean);
    const codes = split.length > 0 ? split : ["0"];
    const hasGlobalReset = codes.includes("0");
    const hasBgReset = codes.includes("49");
    if (!hasGlobalReset && !hasBgReset) {
      return sequence;
    }
    const rebuiltCodes = codes.filter((code) => code !== "49");
    const rebuilt = rebuiltCodes.length > 0 ? `\x1B[${rebuiltCodes.join(";")}m` : "";
    return `${rebuilt}${rowBgAnsi}`;
  });
}
function applyBackgroundToVisibleRange(ansiText, start, end, backgroundAnsi, restoreBackgroundAnsi) {
  if (!ansiText || start >= end || end <= 0) return ansiText;
  let output = "";
  let visibleIndex = 0;
  let index = 0;
  let inRange = false;
  while (index < ansiText.length) {
    if (ansiText[index] === "\x1B") {
      const sequenceEnd = ansiText.indexOf("m", index);
      if (sequenceEnd !== -1) {
        output += ansiText.slice(index, sequenceEnd + 1);
        index = sequenceEnd + 1;
        continue;
      }
    }
    if (visibleIndex === start && !inRange) {
      output += backgroundAnsi;
      inRange = true;
    }
    if (visibleIndex === end && inRange) {
      output += restoreBackgroundAnsi;
      inRange = false;
    }
    output += ansiText[index] ?? "";
    visibleIndex++;
    index++;
  }
  if (inRange) output += restoreBackgroundAnsi;
  return output;
}
function sanitizeSingleLineText(value) {
  return value.replace(/\r/g, "").replace(/\n/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}
function stripInlineBreaksPreserveAnsi(value) {
  return value.replace(/\r/g, "").replace(/\n/g, "");
}
function padRight(value, width) {
  const visual = safeVisibleWidth(stripAnsi(value));
  if (visual >= width) return value;
  return value + " ".repeat(width - visual);
}
function fitToWidth(value, width) {
  return padRight(safeTruncateToWidth(value, width), width);
}
function padRenderedLineWidth(line, width) {
  const safeWidth = Math.max(1, width);
  const current = safeVisibleWidth(stripAnsi(line));
  if (current >= safeWidth) return line;
  return line + " ".repeat(safeWidth - current);
}
function wrapPlainText(text, width) {
  const safeWidth = Math.max(1, width);
  const safeText = sanitizeSingleLineText(text);
  if (!safeText) return [""];
  const lines = [];
  let cursor = 0;
  while (cursor < safeText.length) {
    const remaining = safeText.length - cursor;
    if (remaining <= safeWidth) {
      lines.push(safeText.slice(cursor));
      break;
    }
    const window = safeText.slice(cursor, cursor + safeWidth);
    const breakOnSpace = window.lastIndexOf(" ");
    if (breakOnSpace > 0) {
      const next = breakOnSpace + 1;
      lines.push(safeText.slice(cursor, cursor + next));
      cursor += next;
      continue;
    }
    lines.push(window);
    cursor += safeWidth;
  }
  return lines.length > 0 ? lines : [""];
}
function parseLineNumber(value) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return void 0;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : void 0;
}
function makeDiffLine(prefix, lineNumber, line) {
  return {
    prefix,
    lineNumber: lineNumber === void 0 ? "" : String(lineNumber),
    line
  };
}
function parseDiffLine(rawLine) {
  const match = rawLine.match(/^([+\- ])\s?(.*)$/);
  if (!match) return void 0;
  const [, prefix, rest = ""] = match;
  if (prefix !== "+" && prefix !== "-" && prefix !== " ") return void 0;
  const gutterMatch = rest.match(/^(\d+)\s(.*)$/);
  const lineNumber = gutterMatch?.[1] ?? "";
  const line = gutterMatch?.[2] ?? rest;
  const cleanLineNumber = sanitizeSingleLineText(lineNumber);
  const cleanLine = sanitizeSingleLineText(line).replace(/\t/g, "    ");
  return { prefix, lineNumber: cleanLineNumber, line: cleanLine };
}
function computeInlineDiffSpans(leftLine, rightLine) {
  if (leftLine === rightLine) return { left: [], right: [] };
  let start = 0;
  const minLen = Math.min(leftLine.length, rightLine.length);
  while (start < minLen && leftLine[start] === rightLine[start]) start++;
  let leftEnd = leftLine.length;
  let rightEnd = rightLine.length;
  while (leftEnd > start && rightEnd > start && leftLine[leftEnd - 1] === rightLine[rightEnd - 1]) {
    leftEnd--;
    rightEnd--;
  }
  const leftSpan = leftEnd > start ? [{ start, end: leftEnd }] : [];
  const rightSpan = rightEnd > start ? [{ start, end: rightEnd }] : [];
  return { left: leftSpan, right: rightSpan };
}
function buildSplitRows(diff) {
  const rows = [];
  let pendingLeft = [];
  let pendingRight = [];
  let oldCursor;
  let newCursor;
  const flushPending = () => {
    while (pendingLeft.length > 0 || pendingRight.length > 0) {
      const left = pendingLeft.shift();
      const right = pendingRight.shift();
      if (left && right) rows.push({ kind: "changed", left, right });
      else if (left) rows.push({ kind: "removed", left });
      else if (right) rows.push({ kind: "added", right });
    }
  };
  for (const rawLine of diff.split("\n")) {
    const parsed = parseDiffLine(rawLine);
    if (!parsed) continue;
    const parsedNum = parseLineNumber(parsed.lineNumber);
    if (parsed.prefix === "-") {
      const oldNum2 = parsedNum ?? oldCursor;
      if (oldNum2 !== void 0) oldCursor = oldNum2 + 1;
      pendingLeft.push(makeDiffLine("-", oldNum2, parsed.line));
      continue;
    }
    if (parsed.prefix === "+") {
      const newNum2 = parsedNum ?? newCursor;
      if (newNum2 !== void 0) newCursor = newNum2 + 1;
      pendingRight.push(makeDiffLine("+", newNum2, parsed.line));
      continue;
    }
    flushPending();
    const oldNum = parsedNum ?? oldCursor;
    const newNum = newCursor ?? oldNum;
    if (oldNum !== void 0) oldCursor = oldNum + 1;
    if (newNum !== void 0) newCursor = newNum + 1;
    rows.push({
      kind: "context",
      left: makeDiffLine(" ", oldNum, parsed.line),
      right: makeDiffLine(" ", newNum, parsed.line)
    });
  }
  flushPending();
  return rows;
}
function countDiffStats(diff) {
  let additions = 0;
  let removals = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) removals += 1;
  }
  return { additions, removals };
}
function renderDiffMeter(theme, additions, removals, width = 20) {
  const total = additions + removals;
  if (total <= 0) return "";
  const addBlocks = Math.round(additions / total * width);
  const removeBlocks = Math.max(0, width - addBlocks);
  const addBar = addBlocks > 0 ? theme.fg("toolDiffAdded", "\u2501".repeat(addBlocks)) : "";
  const removeBar = removeBlocks > 0 ? theme.fg("toolDiffRemoved", "\u2501".repeat(removeBlocks)) : "";
  return `${theme.fg("dim", "[")}${addBar}${removeBar}${theme.fg("dim", "]")}`;
}
function extractEditedPath(message) {
  const m = message.match(/Successfully replaced (?:text|\d+ block\(s\)|lines L\d+-\d+) in (.+)\.$/);
  return m?.[1];
}
function firstText(content) {
  for (const part of content) {
    if (part.type === "text" && typeof part.text === "string") {
      return part.text;
    }
  }
  return "";
}
var SplitDiffComponent = class {
  constructor(theme, rows, maxRows, language) {
    this.theme = theme;
    this.rows = rows;
    this.maxRows = maxRows;
    this.language = language;
    let maxDigits = 3;
    for (const row of rows) {
      const leftDigits = row.left?.lineNumber.trim().length ?? 0;
      const rightDigits = row.right?.lineNumber.trim().length ?? 0;
      maxDigits = Math.max(maxDigits, leftDigits, rightDigits);
      if (row.kind === "changed" && row.left && row.right) {
        const spans = computeInlineDiffSpans(row.left.line, row.right.line);
        if (spans.left.length > 0) this.inlineHighlights.set(row.left, spans.left);
        if (spans.right.length > 0) this.inlineHighlights.set(row.right, spans.right);
      }
    }
    this.lineNumberWidth = maxDigits;
    this.palette = resolveDiffPalette(theme);
    this.containerBgAnsi = theme.getBgAnsi("toolSuccessBg");
  }
  cacheWidth;
  cacheLines;
  lineNumberWidth;
  highlightCache = /* @__PURE__ */ new Map();
  inlineHighlights = /* @__PURE__ */ new WeakMap();
  palette;
  containerBgAnsi;
  getCellLineKind(kind, side) {
    if (kind === "changed") return side === "left" ? "remove" : "add";
    if (kind === "removed" && side === "left") return "remove";
    if (kind === "added" && side === "right") return "add";
    return "context";
  }
  getVisualLineKind(kind, side, line) {
    const base = this.getCellLineKind(kind, side);
    if ((kind === "added" || kind === "removed") && (line?.line ?? "") === "") {
      return "context";
    }
    return base;
  }
  getNumberColor(lineKind) {
    if (lineKind === "remove") return "toolDiffRemoved";
    if (lineKind === "add") return "toolDiffAdded";
    return "dim";
  }
  getRowBackground(lineKind) {
    if (lineKind === "add") return this.palette.addRowBgAnsi;
    if (lineKind === "remove") return this.palette.removeRowBgAnsi;
    return void 0;
  }
  getEmphasisBackground(lineKind) {
    if (lineKind === "add") return this.palette.addEmphasisBgAnsi;
    if (lineKind === "remove") return this.palette.removeEmphasisBgAnsi;
    return void 0;
  }
  getCellFillBackground(kind, side) {
    switch (kind) {
      case "changed":
        return side === "left" ? this.palette.removeRowBgAnsi : this.palette.addRowBgAnsi;
      case "removed":
        return side === "left" ? this.palette.removeRowBgAnsi : void 0;
      case "added":
        return side === "right" ? this.palette.addRowBgAnsi : void 0;
      default:
        return void 0;
    }
  }
  blankCell(kind, side, columnWidth) {
    const lineKind = this.getCellLineKind(kind, side);
    const markerChar = lineKind === "add" || lineKind === "remove" ? "\u258C" : " ";
    const markerColor = lineKind === "add" ? "toolDiffAdded" : lineKind === "remove" ? "toolDiffRemoved" : "borderMuted";
    const marker = this.theme.fg(markerColor, markerChar);
    const lineNumber = this.theme.fg("dim", " ".repeat(this.lineNumberWidth));
    const divider = this.theme.fg("borderMuted", " \u2502 ");
    const prefix = `${marker} ${lineNumber}${divider}`;
    const prefixPlain = `${markerChar} ${" ".repeat(this.lineNumberWidth)} \u2502 `;
    const tailWidth = Math.max(0, columnWidth - safeVisibleWidth(prefixPlain));
    let rendered = prefix + " ".repeat(tailWidth);
    const bg = this.getCellFillBackground(kind, side);
    if (!bg) return padRenderedLineWidth(rendered, columnWidth);
    rendered = `${bg}${keepBackgroundAcrossResets(rendered, bg)}${this.containerBgAnsi}`;
    return padRenderedLineWidth(rendered, columnWidth);
  }
  syntaxHighlight(line) {
    if (!this.language) return stripInlineBreaksPreserveAnsi(line);
    const safeLine = sanitizeSingleLineText(line);
    const key = `${this.language}
${safeLine}`;
    const cached2 = this.highlightCache.get(key);
    if (cached2) return cached2;
    let highlighted = safeLine;
    try {
      highlighted = highlightCode2(safeLine, this.language)[0] ?? safeLine;
      highlighted = stripInlineBreaksPreserveAnsi(highlighted).replace(BG_ANSI_PATTERN2, "");
    } catch {
      highlighted = safeLine;
    }
    this.highlightCache.set(key, highlighted);
    return highlighted;
  }
  formatCellLines(kind, side, line, columnWidth) {
    if (!line) return [this.blankCell(kind, side, columnWidth)];
    const lineKind = this.getVisualLineKind(kind, side, line);
    const markerChar = lineKind === "add" || lineKind === "remove" ? "\u258C" : " ";
    const markerColor = lineKind === "add" ? "toolDiffAdded" : lineKind === "remove" ? "toolDiffRemoved" : "borderMuted";
    const lineNumber = line.lineNumber.trim().padStart(this.lineNumberWidth, " ");
    const firstPrefixAnsi = this.theme.fg(markerColor, markerChar) + " " + this.theme.fg(this.getNumberColor(lineKind), lineNumber) + this.theme.fg("borderMuted", " \u2502 ");
    const firstPrefixPlain = `${markerChar} ${lineNumber} \u2502 `;
    const contPrefixAnsi = this.theme.fg(markerColor, markerChar) + " " + this.theme.fg("dim", " ".repeat(this.lineNumberWidth)) + this.theme.fg("borderMuted", " \u2502 ");
    const contPrefixPlain = `${markerChar} ${" ".repeat(this.lineNumberWidth)} \u2502 `;
    const codeWidth = Math.max(1, columnWidth - safeVisibleWidth(firstPrefixPlain));
    const rowBg = this.getRowBackground(lineKind);
    const emphasisBg = this.getEmphasisBackground(lineKind);
    const plainSegments = wrapPlainText(line.line, codeWidth);
    const lines = [];
    const spans = this.inlineHighlights.get(line) ?? [];
    let consumed = 0;
    for (let i = 0; i < plainSegments.length; i++) {
      const prefixAnsi = i === 0 ? firstPrefixAnsi : contPrefixAnsi;
      const prefixPlain = i === 0 ? firstPrefixPlain : contPrefixPlain;
      const plainSegment = plainSegments[i] ?? "";
      let segment = this.syntaxHighlight(plainSegment);
      if (spans.length > 0 && emphasisBg) {
        const segmentStart = consumed;
        for (let si = spans.length - 1; si >= 0; si--) {
          const span = spans[si];
          if (!span) continue;
          const localStart = Math.max(0, span.start - segmentStart);
          const localEnd = Math.min(plainSegment.length, span.end - segmentStart);
          if (localEnd > localStart) {
            segment = applyBackgroundToVisibleRange(
              segment,
              localStart,
              localEnd,
              emphasisBg,
              rowBg ?? this.containerBgAnsi
            );
          }
        }
      }
      segment = fitToWidth(segment, codeWidth);
      let rendered = prefixAnsi + segment;
      const expectedWidth = safeVisibleWidth(prefixPlain) + codeWidth;
      const currentWidth = safeVisibleWidth(stripAnsi(rendered));
      if (currentWidth < expectedWidth) {
        rendered += " ".repeat(expectedWidth - currentWidth);
      }
      if (rowBg) {
        rendered = `${rowBg}${keepBackgroundAcrossResets(rendered, rowBg)}${this.containerBgAnsi}`;
      }
      lines.push(padRenderedLineWidth(rendered, columnWidth));
      consumed += plainSegment.length;
    }
    return lines;
  }
  render(width) {
    if (this.cacheWidth === width && this.cacheLines) return this.cacheLines;
    const safeWidth = Math.max(20, width);
    const columnSeparator = this.theme.fg("borderMuted", " \u2502 ");
    const separatorWidth = safeVisibleWidth(stripAnsi(columnSeparator));
    const leftWidth = Math.max(20, Math.floor((safeWidth - separatorWidth) / 2));
    const rightWidth = Math.max(20, safeWidth - separatorWidth - leftWidth);
    const formatBorderCell = (columnWidth, junction) => {
      const safeColumnWidth = Math.max(1, columnWidth);
      const chars = "\u2500".repeat(safeColumnWidth).split("");
      const dividerIndex = this.lineNumberWidth + 3;
      if (dividerIndex >= 0 && dividerIndex < chars.length) {
        chars[dividerIndex] = junction;
      }
      return this.theme.fg("borderMuted", chars.join(""));
    };
    const formatHeaderCell = (label, columnWidth) => {
      const markerPad = "  ";
      const lineNumberLabel = fitToWidth(label, this.lineNumberWidth);
      const prefixAnsi = this.theme.fg("borderMuted", markerPad) + this.theme.fg("dim", lineNumberLabel) + this.theme.fg("borderMuted", " \u2502 ");
      const prefixPlain = `${markerPad}${stripAnsi(lineNumberLabel)} \u2502 `;
      const codeWidth = Math.max(0, columnWidth - safeVisibleWidth(prefixPlain));
      return padRenderedLineWidth(prefixAnsi + " ".repeat(codeWidth), columnWidth);
    };
    const lines = [];
    lines.push(padRenderedLineWidth(formatBorderCell(leftWidth, "\u252C") + this.theme.fg("borderMuted", "\u2500\u252C\u2500") + formatBorderCell(rightWidth, "\u252C"), safeWidth));
    lines.push(padRenderedLineWidth(formatHeaderCell("old", leftWidth) + columnSeparator + formatHeaderCell("new", rightWidth), safeWidth));
    for (const row of this.rows.slice(0, this.maxRows)) {
      const leftCellLines = this.formatCellLines(row.kind, "left", row.left, leftWidth);
      const rightCellLines = this.formatCellLines(row.kind, "right", row.right, rightWidth);
      const rowHeight = Math.max(leftCellLines.length, rightCellLines.length);
      for (let i = 0; i < rowHeight; i++) {
        const leftFallbackKind = row.kind === "changed" ? "context" : row.kind;
        const rightFallbackKind = row.kind === "changed" ? "context" : row.kind;
        const leftCell = leftCellLines[i] ?? this.blankCell(leftFallbackKind, "left", leftWidth);
        const rightCell = rightCellLines[i] ?? this.blankCell(rightFallbackKind, "right", rightWidth);
        const joined = padRenderedLineWidth(leftCell + columnSeparator + rightCell, safeWidth);
        lines.push(joined);
      }
    }
    if (this.rows.length > this.maxRows) {
      lines.push(this.theme.fg("muted", `... ${this.rows.length - this.maxRows} more rows`));
    }
    lines.push(padRenderedLineWidth(formatBorderCell(leftWidth, "\u2534") + this.theme.fg("borderMuted", "\u2500\u2534\u2500") + formatBorderCell(rightWidth, "\u2534"), safeWidth));
    this.cacheWidth = width;
    this.cacheLines = lines;
    return lines;
  }
  invalidate() {
    this.cacheWidth = void 0;
    this.cacheLines = void 0;
    this.highlightCache.clear();
  }
};

// tool-tags/edit.ts
var MAX_HIGHLIGHT_DIFF_CHARS = 12e3;
var MAX_HIGHLIGHT_DIFF_ROWS = 120;
async function importEditCore(specifier) {
  try {
    return await import(specifier);
  } catch {
    return void 0;
  }
}
async function loadEditCore() {
  const packageImport = await importEditCore("pi-ctx-kit/edit-core");
  if (packageImport) return packageImport;
  const installedPaths = [
    join3(getAgentDir(), "git", "github.com", "sting8k", "pi-ctx-kit", "edit-core.ts"),
    join3(process.cwd(), ".pi", "git", "github.com", "sting8k", "pi-ctx-kit", "edit-core.ts"),
    join3(process.cwd(), "..", "pi-ctx-kit", "edit-core.ts")
  ];
  for (const path of installedPaths) {
    if (!existsSync3(path)) continue;
    const editCore = await importEditCore(pathToFileURL(path).href);
    if (editCore) return editCore;
  }
  return void 0;
}
async function registerEditTool(pi) {
  const editCore = await loadEditCore();
  const baseEdit = createEditToolDefinition(process.cwd());
  pi.registerTool({
    name: "edit",
    label: "edit",
    description: editCore?.EDIT_TOOL_DESCRIPTION ?? baseEdit.description,
    parameters: editCore?.EditArgsSchema ?? baseEdit.parameters,
    prepareArguments: editCore ? void 0 : baseEdit.prepareArguments,
    execute: wrapExecuteWithTiming(async (toolCallId, params, signal, onUpdate, ctx) => {
      if (editCore) return editCore.executeEnhancedEdit(toolCallId, params, signal, onUpdate, ctx);
      const tool = createEditToolDefinition(ctx.cwd);
      return tool.execute(toolCallId, params, signal, onUpdate, ctx);
    }),
    renderCall(args, theme, context) {
      const rawPath = String(args?.path ?? args?.file_path ?? "");
      const cwd = typeof context?.cwd === "string" ? context.cwd : process.cwd();
      const relPath = rawPath ? resolveRelativePath(rawPath, cwd) : "";
      const detail = relPath || "(unknown)";
      return renderBoxedToolCall(theme, "Edit", [`${theme.fg("dim", "Path: ")}${detail}`], {
        isError: Boolean(context?.isError),
        isPartial: Boolean(context?.isPartial),
        isPending: Boolean(context?.isPartial && !context?.hasResult)
      });
    },
    renderResult(result, options, theme, context) {
      if (options.isPartial) {
        return renderBoxedToolResult(theme, () => [`${theme.fg("dim", "\u21B3")} ${theme.fg("muted", "Applying edit...")}`], { isPartial: true });
      }
      if (result.isError) {
        const output = getTextOutput(result);
        return renderBoxedToolResult(theme, () => [theme.fg("error", stripAnsi(output).trim() || "Error")], {
          footerLines: [formatBoxedFooter(theme, result)],
          isError: true
        });
      }
      const details = result.details;
      const diff = details?.diff;
      if (!diff) {
        const output = stripAnsi(getTextOutput(result)).trim();
        const fallback = `\u21B3 ${output || "Edit applied"}`;
        return renderBoxedToolResult(theme, () => [theme.fg("dim", fallback)], {
          footerLines: [formatBoxedFooter(theme, result)]
        });
      }
      const message = firstText(result.content);
      const argPath = String(context?.args?.path ?? context?.args?.file_path ?? "");
      const sourcePath = details?.path ?? (argPath || extractEditedPath(message));
      const language = sourcePath ? getLanguageFromPath2(sourcePath) : void 0;
      const rows = buildSplitRows(diff);
      const expanded = isExpanded(options);
      const shouldHighlight = Boolean(language) && diff.length <= MAX_HIGHLIGHT_DIFF_CHARS && rows.length <= MAX_HIGHLIGHT_DIFF_ROWS;
      const { additions, removals } = countDiffStats(diff);
      const meter = renderDiffMeter(theme, additions, removals);
      const summary = `${theme.fg("dim", "\u21B3")} ${theme.fg("muted", "diff")} ${theme.fg("toolDiffAdded", `+${additions}`)} ${theme.fg("toolDiffRemoved", `-${removals}`)} ${theme.fg("muted", "split")}` + (meter ? ` ${meter}` : "");
      const maxRows = expanded ? 160 : 36;
      const split = new SplitDiffComponent(theme, rows, maxRows, shouldHighlight ? language : void 0);
      return renderBoxedToolResult(theme, {
        render(width) {
          const safeWidth = Math.max(20, width);
          const headerLines = new Text(summary, 0, 0).render(safeWidth);
          return [...headerLines, ...split.render(safeWidth)];
        },
        invalidate() {
          split.invalidate();
        }
      }, {
        footerLines: [formatBoxedFooter(theme, result)]
      });
    }
  });
}

// tool-tags/find.ts
import { createFindTool } from "@earendil-works/pi-coding-agent";
function registerFindTool(pi) {
  const baseFind = createFindTool(process.cwd());
  pi.registerTool({
    name: baseFind.name,
    label: baseFind.label,
    description: baseFind.description,
    parameters: { ...baseFind.parameters },
    execute: wrapExecuteWithTiming(async (toolCallId, params, signal, _onUpdate, ctx) => {
      const tool = createFindTool(ctx.cwd);
      return tool.execute(toolCallId, params, signal);
    }),
    renderCall(args, theme, context) {
      const pattern = String(args?.pattern ?? "");
      const rawPath = String(args?.path ?? ".");
      const displayPath = rawPath === "." || rawPath === "" ? "current directory" : shortenPath(rawPath);
      const detail = pattern ? `${pattern} in ${displayPath}` : displayPath;
      return renderCompactBoxedToolCall(theme, "Find", `${theme.fg("dim", "Query: ")}${detail}`, {
        widthKey: boxedToolWidthKey("Find", detail),
        state: context?.state,
        isError: Boolean(context?.isError),
        isPartial: Boolean(context?.isPartial),
        isPending: Boolean(context?.isPartial && !context?.hasResult)
      });
    },
    renderResult(result, options, theme, context) {
      clearCompactBoxedFooter(context?.state);
      const output = stripAnsi(getTextOutput(result)).trimEnd();
      const pattern = String(context?.args?.pattern ?? "");
      const rawPath = String(context?.args?.path ?? ".");
      const displayPath = rawPath === "." || rawPath === "" ? "current directory" : shortenPath(rawPath);
      const detail = pattern ? `${pattern} in ${displayPath}` : displayPath;
      const widthKey = boxedToolWidthKey("Find", detail);
      const referenceLines = [`Query: ${detail}`];
      if (context?.isError) {
        return renderBoxedToolResult(theme, () => [theme.fg("error", output || "Error")], {
          widthKey,
          referenceLines,
          footerLines: [formatBoxedFooter(theme, result)],
          isError: true
        });
      }
      if (!isExpanded(options)) return renderCompactBoxedFooter(theme, result, { state: context?.state, isError: Boolean(context?.isError), isPartial: Boolean(options?.isPartial) });
      let fileCount = 0;
      if (output && output !== "No files found matching pattern") {
        const stripped = stripTrailingNotice(output);
        fileCount = typeof result.details?.truncation?.outputLines === "number" ? result.details.truncation.outputLines : countLines(stripped);
      }
      const summary = `\u21B3 Found ${fileCount} ${fileCount === 1 ? "file" : "files"}.`;
      return renderBoxedToolResult(theme, () => [theme.fg("dim", summary)], {
        widthKey,
        referenceLines,
        footerLines: [formatBoxedFooter(theme, result)]
      });
    }
  });
}

// tool-tags/grep.ts
import { createGrepTool } from "@earendil-works/pi-coding-agent";
var MAX_GREP_PREVIEW_LINES = 10;
function registerGrepTool(pi) {
  const baseGrep = createGrepTool(process.cwd());
  pi.registerTool({
    name: baseGrep.name,
    label: baseGrep.label,
    description: baseGrep.description,
    parameters: { ...baseGrep.parameters },
    execute: wrapExecuteWithTiming(async (toolCallId, params, signal, _onUpdate, ctx) => {
      const tool = createGrepTool(ctx.cwd);
      return tool.execute(toolCallId, params, signal);
    }),
    renderCall(args, theme, context) {
      const pattern = String(args?.pattern ?? "");
      const rawPath = String(args?.path ?? ".");
      const displayPath = rawPath === "." || rawPath === "" ? "current directory" : shortenPath(rawPath);
      const detail = pattern ? `/${pattern}/ in ${displayPath}` : displayPath;
      return renderCompactBoxedToolCall(theme, "Search", `${theme.fg("dim", "Query: ")}${detail}`, {
        widthKey: boxedToolWidthKey("Search", detail),
        state: context?.state,
        isError: Boolean(context?.isError),
        isPartial: Boolean(context?.isPartial),
        isPending: Boolean(context?.isPartial && !context?.hasResult)
      });
    },
    renderResult(result, options, theme, context) {
      clearCompactBoxedFooter(context?.state);
      const output = stripAnsi(getTextOutput(result)).trimEnd();
      const stripped = stripTrailingNotice(output);
      const pattern = String(context?.args?.pattern ?? "");
      const rawPath = String(context?.args?.path ?? ".");
      const displayPath = rawPath === "." || rawPath === "" ? "current directory" : shortenPath(rawPath);
      const detail = pattern ? `/${pattern}/ in ${displayPath}` : displayPath;
      const widthKey = boxedToolWidthKey("Search", detail);
      const referenceLines = [`Query: ${detail}`];
      if (result.isError) {
        return renderBoxedToolResult(theme, (width) => {
          const body = renderLines(theme, stripped || output || "Error", options, {
            maxLines: MAX_GREP_PREVIEW_LINES,
            color: "error",
            width
          });
          return body ? body.split("\n") : [];
        }, {
          widthKey,
          referenceLines,
          footerLines: [formatBoxedFooter(theme, result)],
          isError: true
        });
      }
      if (!isExpanded(options)) return renderCompactBoxedFooter(theme, result, { state: context?.state, isError: Boolean(context?.isError), isPartial: Boolean(options?.isPartial) });
      let matchCount = 0;
      if (stripped && stripped !== "No matches found") {
        const lines = stripped.split("\n");
        matchCount = lines.filter((line) => /:\d+:/.test(line)).length;
        if (matchCount === 0) {
          matchCount = countLines(stripped);
        }
        if (typeof result.details?.matchLimitReached === "number") {
          matchCount = Math.max(matchCount, result.details.matchLimitReached);
        }
      }
      const summary = theme.fg("dim", `\u21B3 Found ${matchCount} ${matchCount === 1 ? "match" : "matches"}.`);
      if (!stripped || stripped === "No matches found") {
        return renderBoxedToolResult(theme, () => [summary], {
          widthKey,
          referenceLines,
          footerLines: [formatBoxedFooter(theme, result)]
        });
      }
      return renderBoxedToolResult(theme, (width) => {
        const body = renderLines(theme, stripped, options, {
          maxLines: MAX_GREP_PREVIEW_LINES,
          color: "toolOutput",
          width
        });
        return [summary, ...body ? body.split("\n") : []];
      }, {
        widthKey,
        referenceLines,
        footerLines: [formatBoxedFooter(theme, result)]
      });
    }
  });
}

// tool-tags/ls.ts
import { createLsTool } from "@earendil-works/pi-coding-agent";
function registerLsTool(pi) {
  const baseLs = createLsTool(process.cwd());
  pi.registerTool({
    name: baseLs.name,
    label: baseLs.label,
    description: baseLs.description,
    parameters: { ...baseLs.parameters },
    execute: wrapExecuteWithTiming(async (toolCallId, params, signal, _onUpdate, ctx) => {
      const tool = createLsTool(ctx.cwd);
      return tool.execute(toolCallId, params, signal);
    }),
    renderCall(args, theme, context) {
      const rawPath = String(args?.path ?? ".");
      const displayPath = rawPath === "." || rawPath === "" ? "current directory" : shortenPath(rawPath);
      return renderCompactBoxedToolCall(theme, "List", `${theme.fg("dim", "Path: ")}${displayPath}`, {
        widthKey: boxedToolWidthKey("List", displayPath),
        state: context?.state,
        isError: Boolean(context?.isError),
        isPartial: Boolean(context?.isPartial),
        isPending: Boolean(context?.isPartial && !context?.hasResult)
      });
    },
    renderResult(result, options, theme, context) {
      clearCompactBoxedFooter(context?.state);
      const output = stripAnsi(getTextOutput(result)).trimEnd();
      const rawPath = String(context?.args?.path ?? ".");
      const displayPath = rawPath === "." || rawPath === "" ? "current directory" : shortenPath(rawPath);
      const widthKey = boxedToolWidthKey("List", displayPath);
      const referenceLines = [`Path: ${displayPath}`];
      if (context?.isError) {
        return renderBoxedToolResult(theme, () => [theme.fg("error", output || "Error")], {
          widthKey,
          referenceLines,
          footerLines: [formatBoxedFooter(theme, result)],
          isError: true
        });
      }
      if (!isExpanded(options)) return renderCompactBoxedFooter(theme, result, { state: context?.state, isError: Boolean(context?.isError), isPartial: Boolean(options?.isPartial) });
      let itemCount = 0;
      if (output && output !== "(empty directory)") {
        const stripped = stripTrailingNotice(output);
        itemCount = typeof result.details?.truncation?.outputLines === "number" ? result.details.truncation.outputLines : countLines(stripped);
      }
      const summary = `\u21B3 Listed ${itemCount} ${itemCount === 1 ? "item" : "items"}.`;
      return renderBoxedToolResult(theme, () => [theme.fg("dim", summary)], {
        widthKey,
        referenceLines,
        footerLines: [formatBoxedFooter(theme, result)]
      });
    }
  });
}

// tool-tags/read.ts
import { createReadTool, getLanguageFromPath as getLanguageFromPath3, highlightCode as highlightCode3 } from "@earendil-works/pi-coding-agent";
var MAX_HIGHLIGHT_OUTPUT_CHARS = 12e3;
var MAX_HIGHLIGHT_OUTPUT_LINES = 300;
function parseReadOutput(text) {
  const fileHashMatch = text.match(/^fileHash: ([^\n]+)\n\n/);
  const body = fileHashMatch ? text.slice(fileHashMatch[0].length) : text;
  const rawLines = body ? body.split("\n") : [];
  const numberedLines = rawLines.map((line) => line.match(/^\s*(\d+)\| ?(.*)$/));
  if (numberedLines.length > 0 && numberedLines.every(Boolean)) {
    return {
      fileHash: fileHashMatch?.[1],
      body: numberedLines.map((match) => match?.[2] ?? "").join("\n"),
      numberedLines: numberedLines.map((match) => ({
        lineNumber: match?.[1] ?? "",
        content: match?.[2] ?? ""
      }))
    };
  }
  return { fileHash: fileHashMatch?.[1], body };
}
function registerReadTool(pi) {
  const baseRead = createReadTool(process.cwd());
  pi.registerTool({
    name: baseRead.name,
    label: baseRead.label,
    description: baseRead.description,
    parameters: { ...baseRead.parameters },
    execute: wrapExecuteWithTiming(async (toolCallId, params, signal, _onUpdate, ctx) => {
      const tool = createReadTool(ctx.cwd);
      return tool.execute(toolCallId, params, signal);
    }),
    renderCall(args, theme, context) {
      const rawPath = String(args?.path ?? args?.file_path ?? "");
      const path = shortenPath(rawPath);
      const offset = args?.offset;
      const limit = args?.limit;
      let range = "";
      if (offset !== void 0 || limit !== void 0) {
        const start = offset ?? 1;
        const end = limit !== void 0 ? start + limit - 1 : "";
        range = `:${start}${end ? `-${end}` : ""}`;
      }
      const detail = path ? `${path}${range}` : "(unknown)";
      return renderCompactBoxedToolCall(theme, "Read", `${theme.fg("dim", "Path: ")}${detail}`, {
        widthKey: boxedToolWidthKey("Read", detail),
        state: context?.state,
        isError: Boolean(context?.isError),
        isPartial: Boolean(context?.isPartial),
        isPending: Boolean(context?.isPartial && !context?.hasResult)
      });
    },
    renderResult(result, options, theme, context) {
      clearCompactBoxedFooter(context?.state);
      const output = stripAnsi(getTextOutput(result)).trimEnd();
      const rawPath = String(context?.args?.path ?? context?.args?.file_path ?? "");
      const path = shortenPath(rawPath);
      const offset = context?.args?.offset;
      const limit = context?.args?.limit;
      let range = "";
      if (offset !== void 0 || limit !== void 0) {
        const start = offset ?? 1;
        const end = limit !== void 0 ? start + limit - 1 : "";
        range = `:${start}${end ? `-${end}` : ""}`;
      }
      const detail = path ? `${path}${range}` : "(unknown)";
      const widthKey = boxedToolWidthKey("Read", detail);
      const referenceLines = [`Path: ${detail}`];
      if (result.isError) {
        return renderBoxedToolResult(theme, () => [theme.fg("error", output || "Error")], {
          widthKey,
          referenceLines,
          footerLines: [formatBoxedFooter(theme, result)],
          isError: true
        });
      }
      const imageCount = Array.isArray(result.content) ? result.content.filter((contentBlock) => contentBlock?.type === "image").length : 0;
      if (imageCount > 0) {
        if (!isExpanded(options)) return renderCompactBoxedFooter(theme, result, { state: context?.state, isError: Boolean(context?.isError), isPartial: Boolean(options?.isPartial) });
        const summary2 = `\u21B3 Read ${imageCount} ${imageCount === 1 ? "image" : "images"}.`;
        return renderBoxedToolResult(theme, () => [theme.fg("dim", summary2)], {
          widthKey,
          referenceLines,
          footerLines: [formatBoxedFooter(theme, result)]
        });
      }
      const stripped = stripTrailingNotice(output);
      const parsed = parseReadOutput(stripped);
      const truncationNotice = extractTrailingNotice(output);
      const linesRead = typeof result.details?.truncation?.outputLines === "number" ? result.details.truncation.outputLines : parsed.numberedLines?.length ?? countLines(parsed.body);
      const summary = theme.fg("dim", `\u21B3 Read ${linesRead} ${linesRead === 1 ? "line" : "lines"}.`);
      if (!isExpanded(options)) return renderCompactBoxedFooter(theme, result, { state: context?.state, isError: Boolean(context?.isError), isPartial: Boolean(options?.isPartial) });
      const filePath = String(context?.args?.path ?? context?.args?.file_path ?? "");
      const lang = getLanguageFromPath3(filePath);
      let cacheKey = "";
      let cacheLines = null;
      const body = {
        invalidate() {
          cacheKey = "";
          cacheLines = null;
        },
        render(width) {
          const renderWidth = Math.max(1, width);
          const cfg = loadConfig();
          const maxLines = cfg.maxExpandedLines;
          const expanded = isExpanded(options);
          const cacheId = `${renderWidth}|${expanded ? 1 : 0}|${maxLines}|${cfg.dimToolOutput ? 1 : 0}`;
          if (cacheLines && cacheKey === cacheId) return cacheLines;
          const footer = [];
          if (truncationNotice) footer.push(theme.fg("warning", truncationNotice));
          footer.push("", summary);
          const budget = maxLines > 0 ? maxLines - footer.length : 0;
          const renderPlain = (text) => {
            const out = [];
            for (const line of text.split("\n")) {
              out.push(safeTruncateToWidth(theme.fg("toolOutput", line), renderWidth, "\u2026"));
            }
            return out;
          };
          const lineCount = parsed.numberedLines?.length ?? countLines(parsed.body);
          const shouldHighlight = expanded && Boolean(lang) && parsed.body.length <= MAX_HIGHLIGHT_OUTPUT_CHARS && lineCount <= MAX_HIGHLIGHT_OUTPUT_LINES;
          const renderBody = () => {
            if (!parsed.numberedLines) return renderPlain(parsed.fileHash ? `fileHash: ${parsed.fileHash}

${parsed.body}` : parsed.body);
            let bodyLines = parsed.body.split("\n").map((line) => theme.fg("toolOutput", line));
            if (shouldHighlight && lang) {
              try {
                bodyLines = highlightCode3(parsed.body, lang);
              } catch {
                bodyLines = parsed.body.split("\n").map((line) => theme.fg("toolOutput", line));
              }
            }
            const out = [];
            if (parsed.fileHash) out.push(theme.fg("muted", `fileHash: ${parsed.fileHash}`), "");
            const numberWidth = Math.max(...parsed.numberedLines.map((line) => line.lineNumber.length));
            const gutterWidth = numberWidth + 3;
            const contentWidth = Math.max(1, renderWidth - gutterWidth);
            for (let i = 0; i < parsed.numberedLines.length; i++) {
              const numberedLine = parsed.numberedLines[i];
              const bodyLine = safeTruncateToWidth(bodyLines[i] ?? "", contentWidth, "\u2026");
              const gutter = theme.fg("dim", `${numberedLine.lineNumber.padStart(numberWidth)} \u2502 `);
              out.push(`${gutter}${bodyLine}`);
            }
            return out;
          };
          const highlighted = renderBody();
          if (maxLines > 0 && highlighted.length > budget) {
            const truncated = highlighted.slice(0, budget);
            const remaining = highlighted.length - budget;
            truncated.push(theme.fg("dim", `\u2026 ${remaining} more lines`));
            truncated.push(...footer);
            cacheKey = cacheId;
            cacheLines = truncated;
            return cacheLines;
          }
          highlighted.push(...footer);
          cacheKey = cacheId;
          cacheLines = highlighted;
          return cacheLines;
        }
      };
      return renderBoxedToolResult(theme, body, {
        widthKey,
        referenceLines,
        footerLines: [formatBoxedFooter(theme, result)]
      });
    }
  });
}

// tool-tags/write.ts
import { createWriteTool } from "@earendil-works/pi-coding-agent";
function parseWriteSummary(output) {
  const normalized = stripTrailingNotice(stripAnsi(output ?? "")).trim();
  if (!normalized) return void 0;
  const byteMatch = normalized.match(/\bwrote\s+(\d+)\s+bytes?\b/i);
  if (byteMatch) {
    const bytes = Number(byteMatch[1]);
    if (Number.isFinite(bytes)) {
      return `\u21B3 Wrote ${bytes} ${bytes === 1 ? "byte" : "bytes"}.`;
    }
  }
  const lineMatch = normalized.match(/\bwrote\s+(\d+)\s+lines?\b/i);
  if (lineMatch) {
    const count = Number(lineMatch[1]);
    if (Number.isFinite(count)) {
      return `\u21B3 Wrote ${count} ${count === 1 ? "line" : "lines"}.`;
    }
  }
  return void 0;
}
function registerWriteTool(pi) {
  const baseWrite = createWriteTool(process.cwd());
  pi.registerTool({
    name: baseWrite.name,
    label: baseWrite.label,
    description: baseWrite.description,
    parameters: { ...baseWrite.parameters },
    execute: wrapExecuteWithTiming(async (toolCallId, params, signal, _onUpdate, ctx) => {
      const tool = createWriteTool(ctx.cwd);
      return tool.execute(toolCallId, params, signal);
    }),
    renderCall(args, theme, context) {
      const rawPath = String(args?.path ?? args?.file_path ?? "");
      const cwd = typeof context?.cwd === "string" ? context.cwd : process.cwd();
      const relPath = rawPath ? resolveRelativePath(rawPath, cwd) : "";
      const detail = relPath || "(unknown)";
      return renderCompactBoxedToolCall(theme, "Write", `${theme.fg("dim", "Path: ")}${detail}`, {
        widthKey: boxedToolWidthKey("Write", detail),
        state: context?.state,
        isError: Boolean(context?.isError),
        isPartial: Boolean(context?.isPartial),
        isPending: Boolean(context?.isPartial && !context?.hasResult)
      });
    },
    renderResult(result, options, theme, context) {
      clearCompactBoxedFooter(context?.state);
      const output = getTextOutput(result);
      const rawPath = String(context?.args?.path ?? context?.args?.file_path ?? "");
      const cwd = typeof context?.cwd === "string" ? context.cwd : process.cwd();
      const relPath = rawPath ? resolveRelativePath(rawPath, cwd) : "";
      const detail = relPath || "(unknown)";
      const widthKey = boxedToolWidthKey("Write", detail);
      const referenceLines = [`Path: ${detail}`];
      if (result.isError) {
        return renderBoxedToolResult(theme, () => [theme.fg("error", stripAnsi(output).trim() || "Error")], {
          widthKey,
          referenceLines,
          footerLines: [formatBoxedFooter(theme, result)],
          isError: true
        });
      }
      if (!isExpanded(options)) return renderCompactBoxedFooter(theme, result, { state: context?.state, isError: Boolean(context?.isError), isPartial: Boolean(options?.isPartial) });
      const content = String(context?.args?.content ?? "");
      const lineCount = content ? content.split("\n").length : 0;
      if (lineCount > 0) {
        const summary2 = `\u21B3 Wrote ${lineCount} ${lineCount === 1 ? "line" : "lines"}.`;
        return renderBoxedToolResult(theme, () => [theme.fg("dim", summary2)], {
          widthKey,
          referenceLines,
          footerLines: [formatBoxedFooter(theme, result)]
        });
      }
      const summary = parseWriteSummary(output);
      if (summary) {
        return renderBoxedToolResult(theme, () => [theme.fg("dim", summary)], {
          widthKey,
          referenceLines,
          footerLines: [formatBoxedFooter(theme, result)]
        });
      }
      const normalized = stripTrailingNotice(stripAnsi(output)).trim();
      const fallback = normalized ? `\u21B3 ${normalized}` : "\u21B3 Wrote file.";
      return renderBoxedToolResult(theme, () => [theme.fg("dim", fallback)], {
        widthKey,
        referenceLines,
        footerLines: [formatBoxedFooter(theme, result)]
      });
    }
  });
}

// tool-tags/register-tool-call-tags.ts
async function registerToolCallTags(pi) {
  await Promise.all([
    registerReadTool(pi),
    registerWriteTool(pi),
    registerEditTool(pi),
    registerLsTool(pi),
    registerFindTool(pi),
    registerGrepTool(pi),
    registerBashTool(pi)
  ]);
}

// startup-ui.ts
import { existsSync as existsSync4, readFileSync as readFileSync3 } from "fs";
import { homedir as homedir4 } from "os";
import { join as join4 } from "path";
import { getAgentDir as getAgentDir2, keyHint, rawKeyHint, VERSION } from "@earendil-works/pi-coding-agent";
import { Spacer, Text as Text2 } from "@earendil-works/pi-tui";
var PATCHED = Symbol.for("pi-droid-styling.startup-ui.patched");
var ORIGINAL_SHOW_LOADED_RESOURCES = Symbol.for("pi-droid-styling.startup-ui.original-show-loaded-resources");
var CONSOLE_LOG_PATCHED = Symbol.for("pi-droid-styling.startup-ui.console-log-patched");
var SYSTEM_CONTEXT_PANEL_MIN_WIDTH = 64;
var TOOLS_PANEL_MIN_WIDTH = 64;
var CORE_TOOL_SOURCE_LABEL = "core";
var MESSAGE_TEXT_INDENT = "   ";
var STARTUP_PANEL_SIDE_PADDING = 2;
var SYSTEM_CONTEXT_TYPE_WIDTH = safeVisibleWidth("System & Context");
var SYSTEM_CONTEXT_METRIC_WIDTH = safeVisibleWidth("Words/Lines");
var RESOURCE_ROW_GAP = "  \xB7  ";
var PI_LOGO_LINES = [
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551",
  "\u2588\u2588\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2588\u2588\u2551",
  "\u2588\u2588\u2588\u2588\u2551   \u2588\u2588\u2588\u2588\u2551",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u256C\u2550\u2550\u2550\u2588\u2588\u2588\u2588\u2557",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551   \u2588\u2588\u2588\u2588\u2551 ",
  "\u2588\u2588\u2588\u2588\u2554\u2550\u2550\u2550\u255D   \u2588\u2588\u2588\u2588\u2551",
  "\u2588\u2588\u2588\u2588\u2551       \u2588\u2588\u2588\u2588\u2551",
  "\u255A\u2550\u2550\u2550\u255D       \u255A\u2550\u2550\u2550\u255D"
];
var activeTheme;
var FALLBACK_THEME = {
  bold: (text) => text,
  fg: (_color, text) => text
};
var FALLBACK_ACCENT_RGB = { r: 80, g: 160, b: 255 };
var LOGO_PALETTE_STEPS = 24;
var LOGO_MAX_DARKEN = 0.18;
var LOGO_MAX_LIGHTEN = 0.18;
var LOGO_ROW_PHASE_STEP = 0.12;
function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
function interpolateRgb(start, end, factor) {
  return {
    r: clampChannel(start.r + (end.r - start.r) * factor),
    g: clampChannel(start.g + (end.g - start.g) * factor),
    b: clampChannel(start.b + (end.b - start.b) * factor)
  };
}
function darkenRgb(rgb, amount) {
  return {
    r: clampChannel(rgb.r * (1 - amount)),
    g: clampChannel(rgb.g * (1 - amount)),
    b: clampChannel(rgb.b * (1 - amount))
  };
}
function lightenRgb(rgb, amount) {
  return {
    r: clampChannel(rgb.r + (255 - rgb.r) * amount),
    g: clampChannel(rgb.g + (255 - rgb.g) * amount),
    b: clampChannel(rgb.b + (255 - rgb.b) * amount)
  };
}
function buildLogoPalette(accent) {
  return Array.from({ length: LOGO_PALETTE_STEPS }, (_, index) => {
    const progress = index / LOGO_PALETTE_STEPS;
    const wave = -Math.cos(progress * Math.PI * 2);
    return wave < 0 ? darkenRgb(accent, LOGO_MAX_DARKEN * -wave) : lightenRgb(accent, LOGO_MAX_LIGHTEN * wave);
  });
}
function sampleLogoGradient(palette, position) {
  const wrapped = (position % 1 + 1) % 1;
  const scaled = wrapped * palette.length;
  const baseIndex = Math.floor(scaled) % palette.length;
  const nextIndex = (baseIndex + 1) % palette.length;
  return interpolateRgb(palette[baseIndex], palette[nextIndex], scaled - Math.floor(scaled));
}
function renderLogoGradientLine(theme, line, palette, phase) {
  const characters = [...line];
  const span = Math.max(characters.length - 1, 1);
  return characters.map((character, index) => {
    if (character === " ") return character;
    const color2 = sampleLogoGradient(palette, index / span + phase);
    return fgHex(theme, rgbToHex(color2), character);
  }).join("");
}
var logoGradientCacheKey;
var logoGradientCacheLines;
function styledLogoLines(theme) {
  const accentAnsi = theme.getFgAnsi?.("accent") ?? "";
  const mode = theme.getColorMode?.() ?? "truecolor";
  const cacheKey = `${mode}|${accentAnsi}`;
  if (cacheKey === logoGradientCacheKey && logoGradientCacheLines) return logoGradientCacheLines;
  const accent = parseFgAnsiToRgb(accentAnsi) ?? FALLBACK_ACCENT_RGB;
  const palette = buildLogoPalette(accent);
  logoGradientCacheLines = PI_LOGO_LINES.map(
    (line, rowIndex) => renderLogoGradientLine(theme, line, palette, rowIndex * LOGO_ROW_PHASE_STEP)
  );
  logoGradientCacheKey = cacheKey;
  return logoGradientCacheLines;
}
var ExpandableText = class extends Text2 {
  constructor(getCollapsedText, getExpandedText, expanded = false, paddingX = 0, paddingY = 0) {
    super(expanded ? getExpandedText() : getCollapsedText(), paddingX, paddingY);
    this.getCollapsedText = getCollapsedText;
    this.getExpandedText = getExpandedText;
  }
  setExpanded(expanded) {
    this.setText(expanded ? this.getExpandedText() : this.getCollapsedText());
  }
};
function readJson(path) {
  if (!existsSync4(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync3(path, "utf-8"));
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}
function isQuietStartup(cwd) {
  const globalSettings = readJson(join4(homedir4(), ".pi", "agent", "settings.json"));
  const projectSettings = readJson(join4(cwd, ".pi", "settings.json"));
  return Boolean(projectSettings.quietStartup ?? globalSettings.quietStartup ?? false);
}
function discoverPromptFile(cwd, agentDir, filename) {
  const projectPath = join4(cwd, ".pi", filename);
  if (existsSync4(projectPath)) return projectPath;
  const globalPath = join4(agentDir, filename);
  if (existsSync4(globalPath)) return globalPath;
  return void 0;
}
function countWords2(text) {
  return text.match(/[\p{L}\p{N}_]+/gu)?.length ?? 0;
}
function countLines2(text) {
  if (text.length === 0) return 0;
  const lines = text.split(/\r\n|\r|\n/).length;
  return /\r\n$|\r$|\n$/.test(text) ? lines - 1 : lines;
}
function indentStartupLines(lines) {
  return lines.map((line) => `${MESSAGE_TEXT_INDENT}${line}`);
}
function startupBodyWidth(width) {
  return Math.max(1, width - safeVisibleWidth(MESSAGE_TEXT_INDENT));
}
function normalizeToolNames(names) {
  return Array.isArray(names) ? names.filter((name) => typeof name === "string" && name.length > 0) : [];
}
function stripKnownExtension(name) {
  return name.replace(/\.(?:mjs|cjs|js|jsx|ts|tsx)$/i, "");
}
function compactSourcePathLabel(path) {
  const trimmed = path.trim();
  if (!trimmed) return "";
  const synthetic = /^<([^:>]+)(?::[^>]*)?>$/.exec(trimmed);
  if (synthetic?.[1]) return synthetic[1];
  const segments = trimmed.replace(/\\/g, "/").split("/").filter((segment) => segment.length > 0 && segment !== "." && segment !== "~");
  const last = segments.at(-1) ?? trimmed;
  if (/^index\.(?:mjs|cjs|js|jsx|ts|tsx)$/i.test(last) && segments.length > 1) return segments[segments.length - 2];
  return stripKnownExtension(last);
}
function compactPackageSourceLabel(source) {
  if (source.startsWith("npm:")) return source.slice("npm:".length) || source;
  if (source.startsWith("git:")) return compactSourcePathLabel(source.replace(/\.git(?:#.*)?$/i, "")) || source;
  return source;
}
function toolSourceLabel(toolInfo) {
  const sourceInfo = toolInfo?.sourceInfo;
  if (!sourceInfo || typeof sourceInfo !== "object") return CORE_TOOL_SOURCE_LABEL;
  const source = typeof sourceInfo.source === "string" ? sourceInfo.source : "";
  if (source === "builtin") return CORE_TOOL_SOURCE_LABEL;
  if (source === "sdk") return "sdk";
  if (source.startsWith("npm:") || source.startsWith("git:")) return compactPackageSourceLabel(source);
  const baseDir = typeof sourceInfo.baseDir === "string" ? sourceInfo.baseDir : "";
  if (baseDir) return compactSourcePathLabel(baseDir) || source || "extension";
  const path = typeof sourceInfo.path === "string" ? sourceInfo.path : "";
  if (path) return compactSourcePathLabel(path) || source || "extension";
  return source || "extension";
}
function getAvailableTools(session) {
  const hasActiveTools = typeof session?.getActiveToolNames === "function";
  const activeNames = normalizeToolNames(hasActiveTools ? session.getActiveToolNames() : void 0);
  const configuredTools = typeof session?.getAllTools === "function" ? session.getAllTools() : [];
  const allTools = Array.isArray(configuredTools) ? configuredTools : [];
  if (allTools.length > 0) {
    const activeSet = new Set(activeNames);
    return allTools.filter((tool) => typeof tool?.name === "string" && (!hasActiveTools || activeSet.has(tool.name))).map((tool) => ({ source: toolSourceLabel(tool), name: tool.name }));
  }
  return activeNames.map((name) => ({ source: CORE_TOOL_SOURCE_LABEL, name }));
}
function groupAvailableTools(tools) {
  const groups = /* @__PURE__ */ new Map();
  for (const tool of tools) {
    const source = tool.source.trim() || "extension";
    const name = tool.name.trim();
    if (!name) continue;
    const names = groups.get(source) ?? /* @__PURE__ */ new Set();
    names.add(name);
    groups.set(source, names);
  }
  return [...groups.entries()].map(([source, names]) => ({ source, tools: [...names].sort((a, b) => a.localeCompare(b)) })).sort((a, b) => {
    if (a.source === CORE_TOOL_SOURCE_LABEL) return -1;
    if (b.source === CORE_TOOL_SOURCE_LABEL) return 1;
    return a.source.localeCompare(b.source);
  });
}
function renderPanelBorder(theme, left, right, panelWidth) {
  return theme.fg("dim", `${left}${"\u2500".repeat(panelWidth + STARTUP_PANEL_SIDE_PADDING * 2)}${right}`);
}
function renderPanelLine(theme, content, panelWidth) {
  const sidePadding = " ".repeat(STARTUP_PANEL_SIDE_PADDING);
  const padding = " ".repeat(Math.max(0, panelWidth - safeVisibleWidth(content)));
  return `${theme.fg("dim", "\u2502")}${sidePadding}${content}${padding}${sidePadding}${theme.fg("dim", "\u2502")}`;
}
function renderToolsPanel(theme, tools, minTotalWidth = 0) {
  const groups = groupAvailableTools(tools);
  if (groups.length === 0) return [];
  const titleLine = theme.bold(theme.fg("accent", "Available Tools"));
  const outerWidth = STARTUP_PANEL_SIDE_PADDING * 2 + 2;
  const sourceHeader = "Source";
  const countHeader = "Count";
  const toolsHeader = "Tools";
  const countWidth = Math.max(countHeader.length, ...groups.map((group) => String(group.tools.length).length));
  const columnDivider = ` ${theme.fg("muted", "|")} `;
  const columnDividerWidth = safeVisibleWidth(columnDivider);
  const panelWidth = Math.max(TOOLS_PANEL_MIN_WIDTH, minTotalWidth - outerWidth, safeVisibleWidth(titleLine));
  const availableTextWidth = Math.max(sourceHeader.length + toolsHeader.length, panelWidth - countWidth - columnDividerWidth * 2);
  const maxSourceWidth = Math.max(sourceHeader.length, ...groups.map((group) => safeVisibleWidth(group.source)));
  const sourceWidth = Math.min(maxSourceWidth, Math.max(sourceHeader.length, Math.floor(availableTextWidth * 0.28)));
  const toolsWidth = Math.max(toolsHeader.length, availableTextWidth - sourceWidth);
  const header = `${theme.fg("text", sourceHeader.padEnd(sourceWidth))}${columnDivider}${theme.fg("text", countHeader.padStart(countWidth))}${columnDivider}${theme.fg("text", toolsHeader.padEnd(toolsWidth))}`;
  const separator = `${theme.fg("dim", "\u2500".repeat(sourceWidth))}${columnDivider}${theme.fg("dim", "\u2500".repeat(countWidth))}${columnDivider}${theme.fg("dim", "\u2500".repeat(toolsWidth))}`;
  const lines = [
    renderPanelBorder(theme, "\u250C", "\u2510", panelWidth),
    renderPanelLine(theme, titleLine, panelWidth),
    renderPanelLine(theme, header, panelWidth),
    renderPanelLine(theme, separator, panelWidth)
  ];
  for (const group of groups) {
    const count = String(group.tools.length);
    const toolList = safeTruncateToWidth(group.tools.join(", "), toolsWidth, "...", true);
    const source = safeTruncateToWidth(group.source, sourceWidth, "...", true);
    const countPadding = " ".repeat(Math.max(0, countWidth - count.length));
    lines.push(renderPanelLine(
      theme,
      `${theme.fg("text", source)}${columnDivider}${countPadding}${theme.bold(theme.fg("success", count))}${columnDivider}${theme.fg("text", toolList)}`,
      panelWidth
    ));
  }
  lines.push(renderPanelBorder(theme, "\u2514", "\u2518", panelWidth));
  return lines;
}
function renderSystemContextPanel(theme, items, minTotalWidth = 0) {
  const sortedItems = [...items].sort((a, b) => a.priority - b.priority);
  const titleLabel = "System & Context";
  const titleLine = theme.bold(theme.fg("accent", titleLabel));
  const outerWidth = STARTUP_PANEL_SIDE_PADDING * 2 + 2;
  if (sortedItems.length === 0) {
    const message = theme.fg("text", "No system or context files loaded");
    const panelWidth2 = Math.max(SYSTEM_CONTEXT_PANEL_MIN_WIDTH, minTotalWidth - outerWidth, safeVisibleWidth(titleLine), safeVisibleWidth(message));
    return [
      renderPanelBorder(theme, "\u250C", "\u2510", panelWidth2),
      renderPanelLine(theme, titleLine, panelWidth2),
      renderPanelLine(theme, message, panelWidth2),
      renderPanelBorder(theme, "\u2514", "\u2518", panelWidth2)
    ];
  }
  const typeHeader = "Type";
  const pathHeader = "Path";
  const metricLabel = "Words/Lines";
  const typeWidth = Math.max(SYSTEM_CONTEXT_TYPE_WIDTH, typeHeader.length, ...sortedItems.map((item) => safeVisibleWidth(item.kind)));
  const columnDivider = ` ${theme.fg("muted", "|")} `;
  const columnDividerWidth = safeVisibleWidth(columnDivider);
  const metricWidth = Math.max(SYSTEM_CONTEXT_METRIC_WIDTH, metricLabel.length, ...sortedItems.map((item) => `${item.words}/${item.lines}`.length));
  const fixedColumnsWidth = typeWidth + columnDividerWidth + columnDividerWidth + metricWidth;
  const panelWidth = Math.max(SYSTEM_CONTEXT_PANEL_MIN_WIDTH, minTotalWidth - outerWidth, safeVisibleWidth(titleLine));
  const pathWidth = Math.max(pathHeader.length, panelWidth - fixedColumnsWidth);
  const header = `${theme.fg("text", typeHeader.padEnd(typeWidth))}${columnDivider}${theme.fg("text", pathHeader.padEnd(pathWidth))}${columnDivider}${theme.fg("text", metricLabel.padStart(metricWidth))}`;
  const separator = `${theme.fg("dim", "\u2500".repeat(typeWidth))}${columnDivider}${theme.fg("dim", "\u2500".repeat(pathWidth))}${columnDivider}${theme.fg("dim", "\u2500".repeat(metricWidth))}`;
  const lines = [
    renderPanelBorder(theme, "\u250C", "\u2510", panelWidth),
    renderPanelLine(theme, titleLine, panelWidth),
    renderPanelLine(theme, header, panelWidth),
    renderPanelLine(theme, separator, panelWidth)
  ];
  for (const item of sortedItems) {
    const metric = `${item.words}/${item.lines}`;
    const typePadding = " ".repeat(Math.max(0, typeWidth - safeVisibleWidth(item.kind)));
    const path = safeTruncateToWidth(item.path, pathWidth, "...", true);
    const metricPadding = " ".repeat(Math.max(0, metricWidth - safeVisibleWidth(metric)));
    lines.push(renderPanelLine(
      theme,
      `${theme.fg("text", item.kind)}${typePadding}${columnDivider}${theme.fg("text", path)}${columnDivider}${metricPadding}${theme.fg("text", metric)}`,
      panelWidth
    ));
  }
  lines.push(renderPanelBorder(theme, "\u2514", "\u2518", panelWidth));
  return lines;
}
function renderResourceChip(theme, row, highlighted) {
  const label = theme.fg(highlighted ? "text" : "muted", row.label);
  const count = theme.bold(theme.fg("success", String(row.items.length)));
  const content = `${label} ${count}`;
  return content;
}
function renderResourceTable(theme, rows, systemContextItems, tools, expanded) {
  const primaryLabel = systemContextItems.some((item) => item.kind === "system") ? "system" : rows[0]?.label;
  const total = rows.map((row) => renderResourceChip(theme, row, row.label === primaryLabel)).join(theme.fg("dim", RESOURCE_ROW_GAP));
  const summary = theme.bold(theme.fg("accent", "\u25C6")) + MESSAGE_TEXT_INDENT.slice(1) + theme.bold(theme.fg("accent", "Resources")) + theme.fg("dim", total ? RESOURCE_ROW_GAP : "") + total;
  if (!expanded) return summary;
  const panelBodyWidth = Math.max(1, safeVisibleWidth(summary) - safeVisibleWidth(MESSAGE_TEXT_INDENT));
  const toolPanel = renderToolsPanel(theme, tools, panelBodyWidth);
  return [
    summary,
    "",
    ...indentStartupLines(renderSystemContextPanel(theme, systemContextItems, panelBodyWidth)),
    ...toolPanel.length > 0 ? ["", ...indentStartupLines(toolPanel)] : []
  ].join("\n");
}
function compactHeader(theme, width) {
  const logoLines = styledLogoLines(theme);
  const logoWidth = Math.max(...PI_LOGO_LINES.map((line) => safeVisibleWidth(line)));
  const gap = "   ";
  const title = theme.bold(theme.fg("accent", "Pi")) + theme.fg("dim", ` v${VERSION}`);
  const hints = [
    theme.bold(rawKeyHint("/", "commands")),
    theme.bold(rawKeyHint("!", "bash")),
    theme.bold(keyHint("app.tools.expand", "more"))
  ].join(theme.fg("muted", " \xB7 "));
  const status = `${theme.fg("success", "\u25CF")} ${theme.bold(theme.fg("success", "ready"))}`;
  const details = [title, hints, status];
  const safeWidth = Math.max(1, width);
  const detailWidth = safeWidth - logoWidth - safeVisibleWidth(gap);
  if (detailWidth >= 12) {
    const detailStartRow = Math.max(0, Math.floor((PI_LOGO_LINES.length - details.length) / 2));
    return logoLines.map((styledLine, index) => {
      const logoPadding = " ".repeat(Math.max(0, logoWidth - safeVisibleWidth(PI_LOGO_LINES[index])));
      const detailIndex = index - detailStartRow;
      const detail = detailIndex >= 0 && detailIndex < details.length ? safeTruncateToWidth(details[detailIndex], detailWidth, "\u2026") : "";
      return `${styledLine}${logoPadding}${detail ? `${gap}${detail}` : ""}`;
    }).join("\n");
  }
  if (safeWidth >= logoWidth) {
    return [
      ...logoLines,
      safeTruncateToWidth(title, safeWidth, "\u2026"),
      safeTruncateToWidth(hints, safeWidth, "\u2026"),
      safeTruncateToWidth(status, safeWidth, "\u2026")
    ].join("\n");
  }
  return [title, status].map((line) => safeTruncateToWidth(line, safeWidth, "\u2026")).join("\n");
}
function setCompactStartupHeader(ui, cwd) {
  if (isQuietStartup(cwd)) return;
  ui.setHeader((_tui, theme) => {
    const headerTheme = theme;
    activeTheme = headerTheme;
    return {
      invalidate() {
      },
      render(width) {
        return indentStartupLines(compactHeader(headerTheme, startupBodyWidth(width)).split("\n"));
      }
    };
  });
}
function suppressStartupModelScopeLog() {
  const consoleState = console;
  if (consoleState[CONSOLE_LOG_PATCHED]) return;
  consoleState[CONSOLE_LOG_PATCHED] = true;
  const originalLog = console.log.bind(console);
  console.log = (...args) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (first.includes("Model scope:") && first.includes("Ctrl+P to cycle")) return;
    originalLog(...args);
  };
}
function installStartupUiPatch(InteractiveModeComponent) {
  const proto = InteractiveModeComponent?.prototype;
  if (!proto || proto[PATCHED]) return;
  proto[PATCHED] = true;
  proto[ORIGINAL_SHOW_LOADED_RESOURCES] ??= proto.showLoadedResources;
  proto.showLoadedResources = function showDroidLoadedResources(options) {
    const original = this[ORIGINAL_SHOW_LOADED_RESOURCES];
    const showListing = options?.force || this.options?.verbose || !this.settingsManager?.getQuietStartup?.();
    if (!showListing) {
      return original.call(this, options);
    }
    const skills = this.session.resourceLoader.getSkills().skills;
    const templates = this.session.promptTemplates ?? [];
    const themes = this.session.resourceLoader.getThemes().themes.filter((loadedTheme) => loadedTheme.sourcePath);
    const extensions = options?.force && options?.extensions ? options.extensions : this.session.resourceLoader.getExtensions().extensions.map((extension) => ({
      path: extension.path,
      sourceInfo: extension.sourceInfo
    }));
    const contextFiles = this.session.resourceLoader.getAgentsFiles().agentsFiles;
    const scopedModels = this.session.scopedModels ?? [];
    const availableTools = getAvailableTools(this.session);
    const cwd = typeof this.sessionManager?.getCwd === "function" ? this.sessionManager.getCwd() : process.cwd();
    const agentDir = getAgentDir2();
    const systemPrompt = this.session.resourceLoader.getSystemPrompt?.();
    const appendSystemPrompts = this.session.resourceLoader.getAppendSystemPrompt?.() ?? [];
    const systemPromptPath = discoverPromptFile(cwd, agentDir, "SYSTEM.md");
    const appendSystemPromptPath = discoverPromptFile(cwd, agentDir, "APPEND_SYSTEM.md");
    const systemContextItems = [];
    if (typeof systemPrompt === "string") {
      const words = countWords2(systemPrompt);
      const lines = countLines2(systemPrompt);
      if (words > 0 && lines > 0) {
        systemContextItems.push({
          priority: 10,
          kind: "system",
          path: systemPromptPath ? this.formatContextPath(systemPromptPath) : "custom system prompt",
          words,
          lines
        });
      }
    }
    appendSystemPrompts.forEach((content, index) => {
      const words = countWords2(content);
      const lines = countLines2(content);
      if (words <= 0 || lines <= 0) return;
      systemContextItems.push({
        priority: 20 + index,
        kind: "append",
        path: appendSystemPromptPath && index === 0 ? this.formatContextPath(appendSystemPromptPath) : `append system prompt ${index + 1}`,
        words,
        lines
      });
    });
    contextFiles.forEach((file, index) => {
      const content = file.content ?? "";
      const words = countWords2(content);
      const lines = countLines2(content);
      if (words <= 0 || lines <= 0) return;
      systemContextItems.push({
        priority: 100 + index,
        kind: "context",
        path: this.formatContextPath(file.path),
        words,
        lines
      });
    });
    const rows = [
      { label: "system", items: systemContextItems.filter((item) => item.kind === "system").map((item) => item.path) },
      { label: "append", items: systemContextItems.filter((item) => item.kind === "append").map((item) => item.path) },
      { label: "context", items: systemContextItems.filter((item) => item.kind === "context").map((item) => item.path) },
      { label: "models", items: scopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`) },
      { label: "tools", items: availableTools.map((tool) => tool.name) },
      { label: "skills", items: skills.map((skill) => skill.name) },
      { label: "prompts", items: templates.map((template) => `/${template.name}`) },
      { label: "extensions", items: this.getCompactExtensionLabels(extensions) },
      { label: "themes", items: themes.map((loadedTheme) => loadedTheme.name ?? this.getCompactPathLabel(loadedTheme.sourcePath, loadedTheme.sourceInfo)) }
    ].filter((row) => row.items.length > 0);
    if (rows.length > 0) {
      this.chatContainer.addChild(new Spacer(1));
      const theme = activeTheme ?? FALLBACK_THEME;
      const expanded = typeof this.getStartupExpansionState === "function" ? this.getStartupExpansionState() : Boolean(this.options?.verbose);
      this.chatContainer.addChild(new ExpandableText(
        () => renderResourceTable(theme, rows, systemContextItems, availableTools, false),
        () => renderResourceTable(theme, rows, systemContextItems, availableTools, true),
        expanded,
        0,
        0
      ));
      this.chatContainer.addChild(new Spacer(1));
    }
    const getQuietStartup = this.settingsManager.getQuietStartup.bind(this.settingsManager);
    this.settingsManager.getQuietStartup = () => true;
    try {
      return original.call(this, { ...options, force: false, showDiagnosticsWhenQuiet: true });
    } finally {
      this.settingsManager.getQuietStartup = getQuietStartup;
    }
  };
}

// performance/virtualize-chat.ts
function normalizeVisibleTail(value) {
  if (!Number.isFinite(value)) return 30;
  return Math.max(0, Math.floor(value));
}
var VIRTUALIZED_CHAT_PATCHED = Symbol.for("pi-droid-styling.virtualized-chat.patched");
var VIRTUALIZED_CHAT_STATE = Symbol.for("pi-droid-styling.virtualized-chat.state");
var VIRTUALIZED_CHAT_HOST = Symbol.for("pi-droid-styling.virtualized-chat.host-chat");
function isContainerLike(value) {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value;
  return Array.isArray(candidate.children) && typeof candidate.addChild === "function" && typeof candidate.clear === "function" && typeof candidate.render === "function";
}
function findChatContainer(tui) {
  const children = Array.isArray(tui.children) ? tui.children : [];
  const hosted = tui[VIRTUALIZED_CHAT_HOST];
  if (isContainerLike(hosted)) return hosted;
  for (const child of children) {
    if (isContainerLike(child) && child[VIRTUALIZED_CHAT_PATCHED]) return child;
  }
  if (isContainerLike(children[1])) return children[1];
  let best = null;
  let bestCount = -1;
  let containersSeen = 0;
  let second = null;
  for (const child of children) {
    if (!isContainerLike(child)) continue;
    containersSeen += 1;
    if (containersSeen === 2) second = child;
    const count = Array.isArray(child.children) ? child.children.length : 0;
    if (count > bestCount) {
      best = child;
      bestCount = count;
    }
  }
  if (best && bestCount > 0) return best;
  return second;
}
function getState2(value) {
  if (typeof value !== "object" || value === null) return void 0;
  return value[VIRTUALIZED_CHAT_STATE];
}
function syncHiddenChildren(chatContainer, state2) {
  const tail = state2.visibleTail;
  if (!Array.isArray(chatContainer.children)) return;
  if (tail === 0) {
    if (state2.hiddenChildren.length === 0) return;
    chatContainer.children = state2.hiddenChildren.concat(chatContainer.children);
    state2.hiddenChildren = [];
    profileCount("chat.virtualize.restore.hidden");
    profileSample("chat.virtualize.children.count", chatContainer.children.length);
    return;
  }
  if (chatContainer.children.length < tail && state2.hiddenChildren.length > 0) {
    const need = Math.min(tail - chatContainer.children.length, state2.hiddenChildren.length);
    const restored = state2.hiddenChildren.splice(state2.hiddenChildren.length - need, need);
    chatContainer.children = restored.concat(chatContainer.children);
    profileCount("chat.virtualize.restore.partial");
    profileSample("chat.virtualize.hiddenChildren.count", state2.hiddenChildren.length);
    profileSample("chat.virtualize.visibleTail.count", tail);
  }
  if (chatContainer.children.length > tail) {
    const removeCount = chatContainer.children.length - tail;
    const removed = chatContainer.children.splice(0, removeCount);
    state2.hiddenChildren.push(...removed);
    profileCount("chat.virtualize.prune");
    profileSample("chat.virtualize.hiddenChildren.count", state2.hiddenChildren.length);
    profileSample("chat.virtualize.visibleTail.count", tail);
  }
}
function ensureMethodPatches(chatContainer, state2) {
  if (state2.methodsPatched) return;
  state2.methodsPatched = true;
  state2.originalAddChild = chatContainer.addChild.bind(chatContainer);
  state2.originalClear = chatContainer.clear.bind(chatContainer);
  if (typeof chatContainer.removeChild === "function") {
    state2.originalRemoveChild = chatContainer.removeChild.bind(chatContainer);
  }
  chatContainer.addChild = (component) => {
    state2.apiMutated = true;
    state2.originalAddChild(component);
    syncHiddenChildren(chatContainer, state2);
  };
  chatContainer.removeChild = (component) => {
    state2.apiMutated = true;
    const hiddenIndex = state2.hiddenChildren.indexOf(component);
    if (hiddenIndex !== -1) {
      state2.hiddenChildren.splice(hiddenIndex, 1);
      return;
    }
    if (state2.originalRemoveChild) {
      state2.originalRemoveChild(component);
      return;
    }
    const index = chatContainer.children.indexOf(component);
    if (index !== -1) chatContainer.children.splice(index, 1);
  };
  chatContainer.clear = () => {
    state2.apiMutated = true;
    state2.hiddenChildren = [];
    state2.originalClear();
  };
}
function virtualizeChatContainerInstance(chatContainer, visibleTail = 30, tui) {
  if (!isContainerLike(chatContainer)) return;
  const existing = getState2(chatContainer);
  const state2 = existing ?? {
    visibleTail: 30,
    hiddenChildren: [],
    methodsPatched: false,
    apiMutated: false,
    originalAddChild: chatContainer.addChild.bind(chatContainer),
    originalClear: chatContainer.clear.bind(chatContainer)
  };
  state2.visibleTail = normalizeVisibleTail(visibleTail);
  chatContainer[VIRTUALIZED_CHAT_STATE] = state2;
  chatContainer[VIRTUALIZED_CHAT_PATCHED] = true;
  if (tui && typeof tui === "object") {
    tui[VIRTUALIZED_CHAT_HOST] = chatContainer;
  }
  ensureMethodPatches(chatContainer, state2);
  syncHiddenChildren(chatContainer, state2);
  chatContainer.render = function(width) {
    syncHiddenChildren(chatContainer, state2);
    const children = chatContainer.children;
    const total = children.length;
    const hidden = state2.hiddenChildren.length;
    const tail = state2.visibleTail;
    profileSample("chat.virtualize.children.count", total);
    profileSample("chat.virtualize.hiddenChildren.count", hidden);
    profileSample("chat.virtualize.visibleTail.count", tail);
    if (tail === 0 || hidden === 0) {
      profileCount("chat.virtualize.render.full");
      const lines2 = [];
      for (let i = 0; i < total; i++) {
        const cl = children[i].render(width);
        for (let j = 0; j < cl.length; j++) lines2.push(cl[j]);
      }
      return lines2;
    }
    profileCount("chat.virtualize.render.capped");
    const indicator = `\x1B[2m  \xB7\xB7\xB7 ${hidden} older messages hidden \xB7\xB7\xB7\x1B[0m`;
    const lines = [indicator, ""];
    for (let i = 0; i < total; i++) {
      const cl = children[i].render(width);
      for (let j = 0; j < cl.length; j++) lines.push(cl[j]);
    }
    return lines;
  };
}
function virtualizeChatContainer(tui, visibleTail = 30) {
  const chatContainer = findChatContainer(tui);
  if (!chatContainer) return;
  virtualizeChatContainerInstance(chatContainer, visibleTail, tui);
}
var INTERACTIVE_CHAT_VIRTUALIZE_PATCHED = Symbol.for("pi-droid-styling.virtualized-chat.interactive-hooks");
var INTERACTIVE_CHAT_VIRTUALIZE_GET_TAIL = Symbol.for("pi-droid-styling.virtualized-chat.interactive-get-tail");
function installInteractiveChatVirtualization(InteractiveModeClass, getVisibleTail) {
  const proto = InteractiveModeClass?.prototype;
  if (!proto) return;
  proto[INTERACTIVE_CHAT_VIRTUALIZE_GET_TAIL] = getVisibleTail;
  if (proto[INTERACTIVE_CHAT_VIRTUALIZE_PATCHED]) return;
  proto[INTERACTIVE_CHAT_VIRTUALIZE_PATCHED] = true;
  const applyFromMode = (mode) => {
    const chat = mode.chatContainer;
    if (!chat) return;
    const existing = getState2(chat);
    if (existing) {
      if (!existing.apiMutated) existing.hiddenChildren = [];
      existing.apiMutated = false;
    }
    const getter = proto[INTERACTIVE_CHAT_VIRTUALIZE_GET_TAIL];
    const raw = typeof getter === "function" ? getter() : 30;
    const tail = normalizeVisibleTail(raw);
    virtualizeChatContainerInstance(chat, tail, mode.ui ?? null);
    profileCount("chat.virtualize.interactiveHook.apply");
  };
  for (const methodName of ["renderInitialMessages", "renderCurrentSessionState"]) {
    const original = proto[methodName];
    if (typeof original !== "function") continue;
    proto[methodName] = function patchedInteractiveChatVirtualize(...args) {
      const prior = this.chatContainer ? getState2(this.chatContainer) : void 0;
      if (prior) prior.apiMutated = false;
      const result = original.apply(this, args);
      try {
        applyFromMode(this);
      } catch {
        profileCount("chat.virtualize.interactiveHook.error");
      }
      return result;
    };
  }
}

// performance/render-frame-debug.ts
import { appendFileSync as appendFileSync2, mkdirSync as mkdirSync2 } from "node:fs";
import { tmpdir } from "node:os";
import { join as join5 } from "node:path";

// performance/tui-proxy-original.ts
var METHOD_CHAIN = Symbol.for("pi-droid-styling.tui-proxy-original.method-chain");
function readChain(tui) {
  const chain = tui?.[METHOD_CHAIN];
  return chain && typeof chain === "object" ? chain : void 0;
}
function writeChain(tui, chain) {
  if (tui == null) return;
  tui[METHOD_CHAIN] = chain;
}
function getOriginalTuiMethod(tui, name) {
  const key = String(name);
  const current = tui?.[name];
  if (typeof current === "function") {
    let stable = false;
    try {
      stable = tui?.[name] === current;
    } catch {
      stable = false;
    }
    if (stable) return current;
  }
  const remembered = readChain(tui)?.[key];
  if (typeof remembered === "function") return remembered;
  let proto = tui == null ? void 0 : Object.getPrototypeOf(tui);
  while (typeof proto === "object" && proto !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (descriptor) {
      const value = typeof descriptor.get === "function" ? descriptor.get.call(tui) : descriptor.value;
      if (typeof value === "function") return value;
      break;
    }
    proto = Object.getPrototypeOf(proto);
  }
  return current;
}
function rememberTuiMethodWrapper(tui, name, wrapper) {
  if (typeof wrapper !== "function") return;
  const key = String(name);
  const chain = readChain(tui) ?? {};
  chain[key] = wrapper;
  writeChain(tui, chain);
}

// performance/render-frame-debug.ts
var PATCHED2 = Symbol.for("pi-droid-styling.render-frame-debug.patched");
var FRAME_COUNTER = Symbol.for("pi-droid-styling.render-frame-debug.frame");
var PHYSICAL_SYNC_DEBUG_EVENTS = Symbol.for("pi-droid-styling.render-physical-sync.debug-events");
var DEBUG_MARKER_STATE = Symbol.for("pi-droid-styling.render-frame-debug.marker-state");
var DEBUG_MARKER_HANDLER_INSTALLED = Symbol.for("pi-droid-styling.render-frame-debug.marker-handler-installed");
var DEFAULT_MAX_TEXT_BYTES = 12e4;
var DEFAULT_CONTEXT_LINES = 8;
function installRenderFrameDebug(tui) {
  if (process.env.PI_DROID_RENDER_DEBUG !== "1") return;
  if (!tui || tui[PATCHED2] || typeof tui.doRender !== "function" || typeof tui.render !== "function") return;
  const terminal = tui.terminal;
  if (!terminal || typeof terminal.write !== "function") return;
  const originalDoRender = getOriginalTuiMethod(tui, "doRender");
  const logPath = getLogPath();
  const markerState = installDebugMarker(logPath);
  let screenSimulation;
  tui[PATCHED2] = true;
  tui[FRAME_COUNTER] = 0;
  writeJsonLine(logPath, {
    type: "session",
    pid: process.pid,
    startedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  const frameLoggedDoRender = function frameLoggedDoRender2(...args) {
    const frame = (this[FRAME_COUNTER] ?? 0) + 1;
    this[FRAME_COUNTER] = frame;
    markerState.frame = frame;
    const startedAt = Date.now();
    const before = readRenderState(this);
    const previousLines = readStringLines(this.previousLines);
    const writes = [];
    const capturedRenders = [];
    const activeTerminal = this.terminal;
    const activeWrite = activeTerminal?.write;
    const activeRender = this.render;
    if (typeof activeWrite !== "function" || typeof activeRender !== "function") return originalDoRender.call(this, ...args);
    activeTerminal.write = function capturedWrite(data) {
      writes.push(String(data));
      return activeWrite.call(this, data);
    };
    this.render = function capturedRender(width) {
      const lines = activeRender.call(this, width);
      capturedRenders.push({
        width,
        lineCount: lines.length,
        viewportSample: sampleViewport(lines, readNumber(this.previousViewportTop), readNumber(this.previousHeight)),
        duplicateRuns: collectAdjacentDuplicates(lines, readNumber(this.previousViewportTop), readNumber(this.previousHeight))
      });
      return lines;
    };
    let error;
    try {
      return originalDoRender.call(this, ...args);
    } catch (caught) {
      error = caught;
      throw caught;
    } finally {
      activeTerminal.write = activeWrite;
      this.render = activeRender;
      const after = readRenderState(this);
      const nextLines = readStringLines(this.previousLines);
      const changed = summarizeLineChanges(previousLines, nextLines);
      const viewportStart = Math.max(0, after.previousViewportTop);
      const rowCoverage = summarizeRowCoverage(writes, before, after, changed);
      const screenSimulationResult = summarizeScreenSimulation(writes, previousLines, nextLines, before, after, screenSimulation);
      screenSimulation = screenSimulationResult.state;
      writeJsonLine(logPath, {
        type: "frame",
        frame,
        startedAt,
        durationMs: Date.now() - startedAt,
        before,
        after,
        changed,
        viewportMoved: after.previousViewportTop !== before.previousViewportTop,
        viewportSample: sampleViewport(nextLines, viewportStart, after.previousHeight),
        duplicateRuns: collectAdjacentDuplicates(nextLines, viewportStart, after.previousHeight),
        capturedRenders,
        writes: summarizeWrites(writes),
        rowCoverage,
        screenSimulation: screenSimulationResult.summary,
        physicalSync: summarizePhysicalSyncDebug(this),
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error === void 0 ? void 0 : String(error)
      });
    }
  };
  tui.doRender = frameLoggedDoRender;
  rememberTuiMethodWrapper(tui, "doRender", frameLoggedDoRender);
}
function getLogPath() {
  const debugDir = process.env.PI_DROID_RENDER_DEBUG_DIR || join5(tmpdir(), "pi-droid-render-debug");
  mkdirSync2(debugDir, { recursive: true });
  return join5(debugDir, `render-frame-${process.pid}.jsonl`);
}
function writeJsonLine(path, value) {
  try {
    appendFileSync2(path, `${JSON.stringify(value)}
`);
  } catch {
  }
}
function readRenderState(tui) {
  return {
    previousLinesLength: readStringLines(tui.previousLines).length,
    previousViewportTop: readNumber(tui.previousViewportTop),
    previousWidth: readNumber(tui.previousWidth),
    previousHeight: readNumber(tui.previousHeight),
    hardwareCursorRow: readNumber(tui.hardwareCursorRow),
    cursorRow: readNumber(tui.cursorRow),
    maxLinesRendered: readNumber(tui.maxLinesRendered),
    terminalColumns: readNumber(tui.terminal?.columns),
    terminalRows: readNumber(tui.terminal?.rows),
    overlayCount: Array.isArray(tui.overlayStack) ? tui.overlayStack.length : 0
  };
}
function readNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
}
function readStringLines(value) {
  return Array.isArray(value) ? value.map((line) => String(line)) : [];
}
function summarizeLineChanges(previousLines, nextLines) {
  let firstChanged = -1;
  let lastChanged = -1;
  const max = Math.max(previousLines.length, nextLines.length);
  for (let index = 0; index < max; index++) {
    if ((previousLines[index] ?? "") === (nextLines[index] ?? "")) continue;
    if (firstChanged === -1) firstChanged = index;
    lastChanged = index;
  }
  return {
    previousLineCount: previousLines.length,
    nextLineCount: nextLines.length,
    appended: nextLines.length > previousLines.length,
    deleted: nextLines.length < previousLines.length,
    firstChanged,
    lastChanged,
    changedSample: firstChanged >= 0 ? sampleLines(nextLines, Math.max(0, firstChanged - DEFAULT_CONTEXT_LINES), DEFAULT_CONTEXT_LINES * 2 + 1) : []
  };
}
function sampleViewport(lines, viewportTop, height) {
  const safeHeight = Math.max(1, height || DEFAULT_CONTEXT_LINES * 2);
  const start = Math.max(0, viewportTop - DEFAULT_CONTEXT_LINES);
  const count = Math.min(lines.length - start, safeHeight + DEFAULT_CONTEXT_LINES * 2);
  return sampleLines(lines, start, count);
}
function sampleLines(lines, start, count) {
  const samples = [];
  const end = Math.min(lines.length, start + Math.max(0, count));
  for (let index = Math.max(0, start); index < end; index++) {
    const text = truncateText(lines[index] ?? "", 800);
    samples.push({ index, text, plain: truncateText(stripAnsi2(text), 800) });
  }
  return samples;
}
function collectAdjacentDuplicates(lines, viewportTop, height) {
  const runs = [];
  const start = Math.max(1, viewportTop - DEFAULT_CONTEXT_LINES);
  const end = Math.min(lines.length, Math.max(start, viewportTop + Math.max(1, height) + DEFAULT_CONTEXT_LINES));
  for (let index = start; index < end; index++) {
    const previous = normalizeComparableLine(lines[index - 1] ?? "");
    const current = normalizeComparableLine(lines[index] ?? "");
    if (!current || current !== previous) continue;
    runs.push({ first: index - 1, second: index, plain: truncateText(current, 800) });
    if (runs.length >= 12) break;
  }
  return runs;
}
function normalizeComparableLine(line) {
  return stripAnsi2(line).replace(/[ \t]+$/g, "").trim();
}
function summarizeRowCoverage(writes, before, after, changed) {
  const height = Math.max(1, after.previousHeight || after.terminalRows || before.previousHeight || before.terminalRows || 1);
  const columns = Math.max(1, after.terminalColumns || before.terminalColumns || 1);
  const initialRow = clamp(before.hardwareCursorRow - before.previousViewportTop + 1, 1, height);
  const state2 = {
    row: initialRow,
    col: 1,
    savedRow: initialRow,
    savedCol: 1,
    height,
    columns,
    autowrap: true,
    pendingWrap: false,
    cursorRowMoves: 0,
    wrapAdvances: 0,
    scrollEvents: 0,
    clearScreen: false
  };
  const touchedRows = /* @__PURE__ */ new Set();
  const textRows = /* @__PURE__ */ new Set();
  const clearRows = /* @__PURE__ */ new Set();
  for (const write of writes) parseTouchedRows(write, state2, touchedRows, textRows, clearRows);
  const expectedRows = computeExpectedRows(before, after, changed, height);
  const touchedRowList = sortedRows(touchedRows);
  const missedRows = expectedRows.filter((row) => !touchedRows.has(row));
  return {
    height,
    columns,
    initialRow,
    finalRow: state2.row,
    expectedRows,
    touchedRows: touchedRowList,
    missedRows,
    expectedRanges: rowsToRanges(expectedRows),
    touchedRanges: rowsToRanges(touchedRowList),
    missedRanges: rowsToRanges(missedRows),
    textRows: sortedRows(textRows),
    clearRows: sortedRows(clearRows),
    cursorRowMoves: state2.cursorRowMoves,
    wrapAdvances: state2.wrapAdvances,
    scrollEvents: state2.scrollEvents,
    clearScreen: state2.clearScreen
  };
}
function computeExpectedRows(before, after, changed, height) {
  const viewportRemapped = before.previousViewportTop !== after.previousViewportTop || before.previousHeight !== after.previousHeight;
  if (viewportRemapped) return rangeRows(1, height);
  if (changed.firstChanged < 0) return [];
  const viewportTop = Math.max(0, after.previousViewportTop);
  const visibleStart = viewportTop;
  const visibleEnd = viewportTop + height - 1;
  const lineCountChanged = changed.previousLineCount !== changed.nextLineCount;
  const shiftsExistingRows = changed.deleted || lineCountChanged && changed.firstChanged < changed.previousLineCount;
  const firstLine = Math.max(visibleStart, changed.firstChanged);
  const lastLine = Math.min(visibleEnd, shiftsExistingRows ? visibleEnd : changed.lastChanged);
  if (firstLine > visibleEnd || lastLine < visibleStart || firstLine > lastLine) return [];
  return rangeRows(firstLine - viewportTop + 1, lastLine - viewportTop + 1);
}
function parseTouchedRows(text, state2, touchedRows, textRows, clearRows) {
  for (let index = 0; index < text.length; ) {
    const code = text.charCodeAt(index);
    if (code === 27) {
      index = parseEscape(text, index, state2, touchedRows, clearRows);
      continue;
    }
    if (code === 13) {
      state2.col = 1;
      state2.pendingWrap = false;
      index++;
      continue;
    }
    if (code === 10) {
      lineFeed(state2, touchedRows);
      index++;
      continue;
    }
    if (code >= 32 && code !== 127) {
      writePrintable(text, index, state2, touchedRows, textRows);
      index += text.codePointAt(index) > 65535 ? 2 : 1;
      continue;
    }
    index++;
  }
}
function parseEscape(text, index, state2, touchedRows, clearRows) {
  const next = text[index + 1];
  if (next === "[") return parseCsi(text, index + 2, state2, touchedRows, clearRows);
  if (next === "]") return skipUntilStringTerminator(text, index + 2);
  if (next === "P" || next === "_" || next === "^" || next === "X") return skipUntilStringTerminator(text, index + 2);
  if (next === "s") {
    state2.savedRow = state2.row;
    state2.savedCol = state2.col;
    state2.pendingWrap = false;
    return index + 2;
  }
  if (next === "u") {
    state2.row = state2.savedRow;
    state2.col = state2.savedCol;
    state2.pendingWrap = false;
    return index + 2;
  }
  return Math.min(text.length, index + 2);
}
function parseCsi(text, index, state2, touchedRows, clearRows) {
  let end = index;
  while (end < text.length) {
    const code = text.charCodeAt(end);
    if (code >= 64 && code <= 126) break;
    end++;
  }
  if (end >= text.length) return text.length;
  const body = text.slice(index, end);
  const final = text[end];
  handleCsi(body, final, state2, touchedRows, clearRows);
  return end + 1;
}
function handleCsi(body, final, state2, touchedRows, clearRows) {
  const privateMode = body.startsWith("?");
  const params = parseCsiParams(privateMode ? body.slice(1) : body);
  const first = params[0] ?? 1;
  if (privateMode && first === 7 && (final === "h" || final === "l")) {
    state2.autowrap = final === "h";
    state2.pendingWrap = false;
    return;
  }
  switch (final) {
    case "H":
    case "f":
      setCursor(state2, params[0] ?? 1, params[1] ?? 1);
      break;
    case "A":
      moveCursorRows(state2, -first);
      break;
    case "B":
    case "e":
      moveCursorRows(state2, first);
      break;
    case "C":
    case "a":
      state2.col = clamp(state2.col + first, 1, state2.columns);
      state2.pendingWrap = false;
      break;
    case "D":
      state2.col = clamp(state2.col - first, 1, state2.columns);
      state2.pendingWrap = false;
      break;
    case "E":
      moveCursorRows(state2, first);
      state2.col = 1;
      break;
    case "F":
      moveCursorRows(state2, -first);
      state2.col = 1;
      break;
    case "G":
    case "`":
      state2.col = clamp(first, 1, state2.columns);
      state2.pendingWrap = false;
      break;
    case "d":
      setCursor(state2, first, state2.col);
      break;
    case "K":
      markRow(state2.row, touchedRows);
      markRow(state2.row, clearRows);
      break;
    case "J":
      state2.clearScreen = true;
      markAllRows(state2, touchedRows);
      break;
    case "S":
    case "T":
      state2.scrollEvents++;
      markAllRows(state2, touchedRows);
      break;
    case "s":
      state2.savedRow = state2.row;
      state2.savedCol = state2.col;
      break;
    case "u":
      state2.row = state2.savedRow;
      state2.col = state2.savedCol;
      break;
  }
}
function parseCsiParams(body) {
  const parameterText = body.replace(/[ -/].*$/u, "");
  if (!parameterText) return [];
  return parameterText.split(";").map((part) => {
    const parsed = Number(part);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : void 0;
  });
}
function skipUntilStringTerminator(text, index) {
  for (let cursor = index; cursor < text.length; cursor++) {
    if (text.charCodeAt(cursor) === 7) return cursor + 1;
    if (text.charCodeAt(cursor) === 27 && text[cursor + 1] === "\\") return cursor + 2;
  }
  return text.length;
}
function writePrintable(text, index, state2, touchedRows, textRows) {
  if (state2.pendingWrap) {
    advanceRowForWrap(state2, touchedRows);
    state2.col = 1;
    state2.pendingWrap = false;
  }
  markRow(state2.row, touchedRows);
  markRow(state2.row, textRows);
  const width = estimateCodePointWidth(text.codePointAt(index) ?? 0);
  advanceColumns(state2, Math.max(1, width), touchedRows);
}
function advanceColumns(state2, width, touchedRows) {
  for (let step = 0; step < width; step++) {
    if (state2.autowrap && state2.col >= state2.columns) {
      state2.pendingWrap = true;
      continue;
    }
    state2.col = clamp(state2.col + 1, 1, state2.columns);
  }
}
function lineFeed(state2, touchedRows) {
  state2.pendingWrap = false;
  if (state2.row >= state2.height) {
    state2.scrollEvents++;
    markAllRows(state2, touchedRows);
    return;
  }
  state2.row++;
  state2.cursorRowMoves++;
}
function advanceRowForWrap(state2, touchedRows) {
  state2.wrapAdvances++;
  if (state2.row >= state2.height) {
    state2.scrollEvents++;
    markAllRows(state2, touchedRows);
    return;
  }
  state2.row++;
  state2.cursorRowMoves++;
}
function moveCursorRows(state2, delta) {
  state2.row = clamp(state2.row + delta, 1, state2.height);
  state2.pendingWrap = false;
  state2.cursorRowMoves++;
}
function setCursor(state2, row, col) {
  state2.row = clamp(row, 1, state2.height);
  state2.col = clamp(col, 1, state2.columns);
  state2.pendingWrap = false;
}
function markRow(row, rows) {
  if (Number.isFinite(row) && row >= 1) rows.add(Math.floor(row));
}
function markAllRows(state2, rows) {
  for (let row = 1; row <= state2.height; row++) rows.add(row);
}
function estimateCodePointWidth(codePoint) {
  if (codePoint === 0) return 0;
  if (codePoint >= 768 && codePoint <= 879) return 0;
  if (codePoint >= 4352 && (codePoint <= 4447 || codePoint === 9001 || codePoint === 9002 || codePoint >= 11904 && codePoint <= 42191 || codePoint >= 44032 && codePoint <= 55203 || codePoint >= 63744 && codePoint <= 64255 || codePoint >= 65040 && codePoint <= 65049 || codePoint >= 65072 && codePoint <= 65135 || codePoint >= 65280 && codePoint <= 65376 || codePoint >= 65504 && codePoint <= 65510 || codePoint >= 127744 && codePoint <= 129791)) return 2;
  return 1;
}
function sortedRows(rows) {
  return Array.from(rows).filter((row) => Number.isFinite(row)).sort((left, right) => left - right);
}
function rangeRows(start, end) {
  const rows = [];
  for (let row = Math.max(1, start); row <= end; row++) rows.push(row);
  return rows;
}
function rowsToRanges(rows) {
  const sorted = [...rows].sort((left, right) => left - right);
  const ranges = [];
  for (const row of sorted) {
    const previous = ranges[ranges.length - 1];
    if (!previous || row > previous.end + 1) {
      ranges.push({ start: row, end: row });
      continue;
    }
    previous.end = row;
  }
  return ranges;
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
function installDebugMarker(logPath) {
  const state2 = { logPath, frame: 0, count: 0 };
  const markerProcess = process;
  markerProcess[DEBUG_MARKER_STATE] = state2;
  if (markerProcess[DEBUG_MARKER_HANDLER_INSTALLED]) return state2;
  markerProcess[DEBUG_MARKER_HANDLER_INSTALLED] = true;
  process.on("SIGUSR2", () => {
    const current = process[DEBUG_MARKER_STATE];
    if (!current) return;
    current.count++;
    writeJsonLine(current.logPath, {
      type: "marker",
      marker: current.count,
      frame: current.frame,
      at: Date.now(),
      signal: "SIGUSR2"
    });
  });
  return state2;
}
function summarizeScreenSimulation(writes, previousLines, nextLines, before, after, previousState) {
  const height = Math.max(1, after.previousHeight || after.terminalRows || before.previousHeight || before.terminalRows || 1);
  const columns = Math.max(1, after.terminalColumns || before.terminalColumns || 1);
  const beforeViewportTop = Math.max(0, before.previousViewportTop);
  let state2 = previousState;
  let resynced;
  if (!state2) {
    state2 = createScreenSimulationState(previousLines, beforeViewportTop, height, columns, before);
    resynced = "initial";
  } else if (state2.height !== height || state2.columns !== columns) {
    state2 = createScreenSimulationState(previousLines, beforeViewportTop, height, columns, before);
    resynced = "resize";
  } else if (state2.viewportTop !== beforeViewportTop) {
    state2 = createScreenSimulationState(previousLines, beforeViewportTop, height, columns, before);
    resynced = "viewportMismatch";
  }
  resetScreenSimulationFrameCounters(state2);
  for (const write of writes) parseScreenWrite(write, state2);
  const afterViewportTop = Math.max(0, after.previousViewportTop);
  const expectedRows = buildLogicalScreenRows(nextLines, afterViewportTop, height, columns);
  const mismatchRows = [];
  const mismatchSample = [];
  for (let index = 0; index < height; index++) {
    const expected = normalizeScreenCompare(expectedRows[index] ?? "");
    const actual = normalizeScreenCompare(state2.rows[index] ?? "");
    if (expected === actual) continue;
    const row = index + 1;
    mismatchRows.push(row);
    if (mismatchSample.length < DEFAULT_CONTEXT_LINES) mismatchSample.push({ row, expected: truncateText(expected, 240), actual: truncateText(actual, 240) });
  }
  state2.viewportTop = afterViewportTop;
  return {
    summary: {
      height,
      columns,
      viewportTop: afterViewportTop,
      resynced,
      comparedRows: height,
      mismatchRows,
      mismatchRanges: rowsToRanges(mismatchRows),
      mismatchSample,
      cursorRow: state2.row,
      cursorCol: state2.col,
      wrapAdvances: state2.wrapAdvances,
      scrollEvents: state2.scrollEvents,
      clearScreen: state2.clearScreen
    },
    state: state2
  };
}
function createScreenSimulationState(lines, viewportTop, height, columns, renderState) {
  const initialRow = clamp(renderState.hardwareCursorRow - renderState.previousViewportTop + 1, 1, height);
  return {
    row: initialRow,
    col: 1,
    savedRow: initialRow,
    savedCol: 1,
    height,
    columns,
    autowrap: true,
    pendingWrap: false,
    cursorRowMoves: 0,
    wrapAdvances: 0,
    scrollEvents: 0,
    clearScreen: false,
    rows: buildLogicalScreenRows(lines, viewportTop, height, columns),
    viewportTop
  };
}
function resetScreenSimulationFrameCounters(state2) {
  state2.cursorRowMoves = 0;
  state2.wrapAdvances = 0;
  state2.scrollEvents = 0;
  state2.clearScreen = false;
}
function buildLogicalScreenRows(lines, viewportTop, height, columns) {
  const rows = [];
  for (let row = 0; row < height; row++) rows.push(normalizeScreenRow(stripAnsi2(lines[viewportTop + row] ?? ""), columns));
  return rows;
}
function parseScreenWrite(text, state2) {
  for (let index = 0; index < text.length; ) {
    const code = text.charCodeAt(index);
    if (code === 27) {
      index = parseScreenEscape(text, index, state2);
      continue;
    }
    if (code === 13) {
      state2.col = 1;
      state2.pendingWrap = false;
      index++;
      continue;
    }
    if (code === 10) {
      screenLineFeed(state2);
      index++;
      continue;
    }
    if (code >= 32 && code !== 127) {
      writeScreenPrintable(text, index, state2);
      index += text.codePointAt(index) > 65535 ? 2 : 1;
      continue;
    }
    index++;
  }
}
function parseScreenEscape(text, index, state2) {
  const next = text[index + 1];
  if (next === "[") return parseScreenCsi(text, index + 2, state2);
  if (next === "]") return skipUntilStringTerminator(text, index + 2);
  if (next === "P" || next === "_" || next === "^" || next === "X") return skipUntilStringTerminator(text, index + 2);
  if (next === "s") {
    state2.savedRow = state2.row;
    state2.savedCol = state2.col;
    state2.pendingWrap = false;
    return index + 2;
  }
  if (next === "u") {
    state2.row = state2.savedRow;
    state2.col = state2.savedCol;
    state2.pendingWrap = false;
    return index + 2;
  }
  return Math.min(text.length, index + 2);
}
function parseScreenCsi(text, index, state2) {
  let end = index;
  while (end < text.length) {
    const code = text.charCodeAt(end);
    if (code >= 64 && code <= 126) break;
    end++;
  }
  if (end >= text.length) return text.length;
  const body = text.slice(index, end);
  const final = text[end];
  handleScreenCsi(body, final, state2);
  return end + 1;
}
function handleScreenCsi(body, final, state2) {
  const privateMode = body.startsWith("?");
  const params = parseCsiParams(privateMode ? body.slice(1) : body);
  const first = params[0] ?? 1;
  if (privateMode && first === 7 && (final === "h" || final === "l")) {
    state2.autowrap = final === "h";
    state2.pendingWrap = false;
    return;
  }
  switch (final) {
    case "H":
    case "f":
      setCursor(state2, params[0] ?? 1, params[1] ?? 1);
      break;
    case "A":
      moveCursorRows(state2, -first);
      break;
    case "B":
    case "e":
      moveCursorRows(state2, first);
      break;
    case "C":
    case "a":
      state2.col = clamp(state2.col + first, 1, state2.columns);
      state2.pendingWrap = false;
      break;
    case "D":
      state2.col = clamp(state2.col - first, 1, state2.columns);
      state2.pendingWrap = false;
      break;
    case "E":
      moveCursorRows(state2, first);
      state2.col = 1;
      break;
    case "F":
      moveCursorRows(state2, -first);
      state2.col = 1;
      break;
    case "G":
    case "`":
      state2.col = clamp(first, 1, state2.columns);
      state2.pendingWrap = false;
      break;
    case "d":
      setCursor(state2, first, state2.col);
      break;
    case "K":
      clearScreenRow(state2, params[0] ?? 0);
      break;
    case "J":
      clearScreenRows(state2, params[0] ?? 0);
      break;
    case "S":
      scrollScreenUp(state2, first);
      break;
    case "T":
      scrollScreenDown(state2, first);
      break;
    case "s":
      state2.savedRow = state2.row;
      state2.savedCol = state2.col;
      break;
    case "u":
      state2.row = state2.savedRow;
      state2.col = state2.savedCol;
      break;
  }
}
function writeScreenPrintable(text, index, state2) {
  if (state2.pendingWrap) {
    screenAdvanceRowForWrap(state2);
    state2.col = 1;
    state2.pendingWrap = false;
  }
  const codePoint = text.codePointAt(index) ?? 0;
  const value = String.fromCodePoint(codePoint);
  const width = Math.max(1, estimateCodePointWidth(codePoint));
  writeScreenCell(state2, value, width);
  advanceScreenColumns(state2, width);
}
function writeScreenCell(state2, value, width) {
  const rowIndex = clamp(state2.row, 1, state2.height) - 1;
  const colIndex = clamp(state2.col, 1, state2.columns) - 1;
  const cells = screenRowToCells(state2.rows[rowIndex] ?? "", state2.columns);
  cells[colIndex] = value;
  for (let offset = 1; offset < width && colIndex + offset < cells.length; offset++) cells[colIndex + offset] = " ";
  state2.rows[rowIndex] = cells.join("").slice(0, state2.columns);
}
function advanceScreenColumns(state2, width) {
  for (let step = 0; step < width; step++) {
    if (state2.autowrap && state2.col >= state2.columns) {
      state2.pendingWrap = true;
      continue;
    }
    state2.col = clamp(state2.col + 1, 1, state2.columns);
  }
}
function screenLineFeed(state2) {
  state2.pendingWrap = false;
  if (state2.row >= state2.height) {
    scrollScreenUp(state2, 1);
    return;
  }
  state2.row++;
  state2.cursorRowMoves++;
}
function screenAdvanceRowForWrap(state2) {
  state2.wrapAdvances++;
  if (state2.row >= state2.height) {
    scrollScreenUp(state2, 1);
    return;
  }
  state2.row++;
  state2.cursorRowMoves++;
}
function clearScreenRow(state2, mode) {
  const rowIndex = clamp(state2.row, 1, state2.height) - 1;
  const cells = screenRowToCells(state2.rows[rowIndex] ?? "", state2.columns);
  if (mode === 1) {
    for (let index = 0; index < state2.col; index++) cells[index] = " ";
  } else if (mode === 2) {
    for (let index = 0; index < cells.length; index++) cells[index] = " ";
  } else {
    for (let index = Math.max(0, state2.col - 1); index < cells.length; index++) cells[index] = " ";
  }
  state2.rows[rowIndex] = cells.join("");
}
function clearScreenRows(state2, mode) {
  state2.clearScreen = true;
  if (mode === 1) {
    for (let row = 0; row < state2.row - 1; row++) state2.rows[row] = blankScreenRow(state2.columns);
    clearScreenRow(state2, 1);
    return;
  }
  if (mode === 2 || mode === 3) {
    for (let row = 0; row < state2.height; row++) state2.rows[row] = blankScreenRow(state2.columns);
    return;
  }
  clearScreenRow(state2, 0);
  for (let row = state2.row; row < state2.height; row++) state2.rows[row] = blankScreenRow(state2.columns);
}
function scrollScreenUp(state2, count) {
  const amount = clamp(count, 1, state2.height);
  state2.scrollEvents += amount;
  state2.rows.splice(0, amount);
  while (state2.rows.length < state2.height) state2.rows.push(blankScreenRow(state2.columns));
}
function scrollScreenDown(state2, count) {
  const amount = clamp(count, 1, state2.height);
  state2.scrollEvents += amount;
  state2.rows.splice(Math.max(0, state2.height - amount), amount);
  while (state2.rows.length < state2.height) state2.rows.unshift(blankScreenRow(state2.columns));
}
function screenRowToCells(row, columns) {
  const cells = Array.from(row);
  while (cells.length < columns) cells.push(" ");
  return cells.slice(0, columns);
}
function normalizeScreenRow(row, columns) {
  const cells = [];
  for (let index = 0; index < row.length && cells.length < columns; ) {
    const codePoint = row.codePointAt(index) ?? 0;
    const value = String.fromCodePoint(codePoint);
    const width = Math.max(1, estimateCodePointWidth(codePoint));
    cells.push(value);
    for (let offset = 1; offset < width && cells.length < columns; offset++) cells.push(" ");
    index += codePoint > 65535 ? 2 : 1;
  }
  while (cells.length < columns) cells.push(" ");
  return cells.join("");
}
function blankScreenRow(columns) {
  return " ".repeat(Math.max(1, columns));
}
function normalizeScreenCompare(line) {
  return stripAnsi2(line).replace(/[ \t]+$/gu, "");
}
function summarizePhysicalSyncDebug(tui) {
  const events = tui[PHYSICAL_SYNC_DEBUG_EVENTS];
  if (!Array.isArray(events)) return void 0;
  let selfHeal;
  let anchorRewriteCount = 0;
  let rawLeadingRelativeCount = 0;
  const writeKindCounts = {};
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const type = String(event.type ?? "");
    if (type === "selfHeal") selfHeal = event;
    if (type !== "writeRewrite") continue;
    const rawKind = String(event.rawKind ?? "unknown");
    const finalKind = String(event.finalKind ?? "unknown");
    writeKindCounts[`${rawKind}->${finalKind}`] = (writeKindCounts[`${rawKind}->${finalKind}`] ?? 0) + 1;
    if (event.rewritten === true) anchorRewriteCount++;
    if (rawKind === "leadingRelativeUp" || rawKind === "leadingRelativeDown") rawLeadingRelativeCount++;
  }
  return {
    events,
    selfHeal,
    writeRewriteCount: events.filter((event) => event?.type === "writeRewrite").length,
    anchorRewriteCount,
    rawLeadingRelativeCount,
    writeKindCounts
  };
}
function summarizeWrites(writes) {
  const maxBytes = readPositiveEnvNumber("PI_DROID_RENDER_DEBUG_MAX_TEXT_BYTES", DEFAULT_MAX_TEXT_BYTES);
  const combined = writes.join("");
  return {
    count: writes.length,
    bytes: Buffer.byteLength(combined, "utf8"),
    text: truncateText(combined, maxBytes),
    chunks: writes.map((write, index) => ({
      index,
      bytes: Buffer.byteLength(write, "utf8"),
      text: truncateText(write, Math.min(12e3, maxBytes))
    }))
  };
}
function readPositiveEnvNumber(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\u2026<truncated ${text.length - maxLength} chars>`;
}
function stripAnsi2(text) {
  return text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b_G[^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

// editor/box-editor.ts
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { homedir as homedir5, hostname, userInfo } from "node:os";
var CLI_DOCK_STATUS_INSET = 2;
var NVIM_MIN_MODEL_WIDTH = 8;
var NVIM_MODEL_ID_MAX = 40;
var NVIM_BRANCH_MAX = 24;
function isBorderLine(line) {
  const clean = stripAnsi(line).replace(/\s/g, "");
  return clean.replace(/─/g, "").replace(/[↑↓]\s*\d+\s*more/g, "") === "";
}
function findLastBorderIndex(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isBorderLine(lines[i] ?? "")) return i;
  }
  return -1;
}
function normalizeSingleLine(text) {
  return text.replace(/[\r\n]+/g, " ").trim();
}
function clamp2(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function isHexColor3(value) {
  return /^#?[0-9a-fA-F]{3}$/.test(value) || /^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value);
}
function backgroundAnsiToForegroundAnsi(ansi) {
  return ansi.replace(/\x1b\[([0-9;]*)m/g, (_sequence, rawCodes) => {
    const codes = rawCodes.split(";").filter((code) => code.length > 0);
    if (codes.length === 0) return "\x1B[0m";
    const rebuilt = [];
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      const numeric = Number(code);
      if (numeric === 38 || numeric === 48) {
        rebuilt.push(numeric === 48 ? "38" : code);
        const mode = codes[i + 1];
        const parameterCount = mode === "2" ? 4 : mode === "5" ? 2 : 0;
        for (let j = 1; j <= parameterCount && i + j < codes.length; j++) rebuilt.push(codes[i + j]);
        i += parameterCount;
        continue;
      }
      if (numeric === 49) {
        rebuilt.push("39");
        continue;
      }
      if (numeric >= 40 && numeric <= 47) {
        rebuilt.push(String(numeric - 10));
        continue;
      }
      if (numeric >= 100 && numeric <= 107) {
        rebuilt.push(String(numeric - 10));
        continue;
      }
      rebuilt.push(code);
    }
    return `\x1B[${rebuilt.join(";")}m`;
  });
}
function firstCodePoint(text) {
  const next = text[Symbol.iterator]().next();
  return next.done ? "" : next.value;
}
function currentUsername() {
  try {
    return userInfo().username || process.env.USER || process.env.LOGNAME || "user";
  } catch {
    return process.env.USER || process.env.LOGNAME || "user";
  }
}
function currentUserHost() {
  const user = currentUsername();
  const host = hostname().split(".")[0] || "host";
  return `${user}@${host}`;
}
var BoxEditor = class extends CustomEditor {
  constructor(tui, editorTheme, kb, fullTheme, sessionCwd, getContextUsage, getModelInfo, getBranch, getResponseSpeed, getFooterStatus, getMetadataPlacement, userZoneStyle = resolveUserZoneStyle(void 0), inputBoxStyle, getFooterTokenUsage) {
    super(tui, editorTheme, kb);
    this.editorTheme = editorTheme;
    this.fullTheme = fullTheme;
    this.sessionCwd = sessionCwd;
    this.getContextUsage = getContextUsage;
    this.getModelInfo = getModelInfo;
    this.getBranch = getBranch;
    this.getResponseSpeed = getResponseSpeed;
    this.getFooterStatus = getFooterStatus;
    this.getMetadataPlacement = getMetadataPlacement;
    this.userZoneStyle = userZoneStyle;
    this.inputBoxStyle = inputBoxStyle;
    this.getFooterTokenUsage = getFooterTokenUsage;
  }
  color(hex, text) {
    return this.fullTheme ? fgHex(this.fullTheme, hex, text) : text;
  }
  styleFg(color2, text) {
    return isHexColor3(color2) ? this.color(color2, text) : this.tone(color2, text);
  }
  styleBackgroundAsFg(color2, text) {
    if (isHexColor3(color2)) return this.color(color2, text);
    try {
      if (typeof this.fullTheme?.getBgAnsi === "function") {
        const bgAnsi = this.fullTheme.getBgAnsi(color2);
        if (typeof bgAnsi === "string" && bgAnsi.length > 0) {
          return `${backgroundAnsiToForegroundAnsi(bgAnsi)}${text}\x1B[39m`;
        }
      }
    } catch {
    }
    return this.styleFg(color2, text);
  }
  themeExtraColor(key, fallback) {
    return getThemeExtra(this.fullTheme, key) || fallback;
  }
  metadataInSidebar() {
    return this.getMetadataPlacement?.() === "sidebar";
  }
  getSlashAutocompleteModel() {
    const editorState = this?.state;
    if (!editorState || !Array.isArray(editorState.lines)) return null;
    const cursorLine = typeof editorState.cursorLine === "number" ? editorState.cursorLine : 0;
    const cursorCol = typeof editorState.cursorCol === "number" ? editorState.cursorCol : 0;
    const currentLine = editorState.lines[cursorLine] ?? "";
    const textBeforeCursor = currentLine.slice(0, Math.max(0, cursorCol));
    const trimmedBeforeCursor = textBeforeCursor.trimStart();
    if (cursorLine !== 0 || !trimmedBeforeCursor.startsWith("/")) return null;
    const autocompleteState = this?.autocompleteState;
    const autocompleteList = this?.autocompleteList;
    if (!autocompleteState || !autocompleteList) return null;
    const items = Array.isArray(autocompleteList.filteredItems) ? autocompleteList.filteredItems : [];
    const selectedIndex = clamp2(
      typeof autocompleteList.selectedIndex === "number" ? autocompleteList.selectedIndex : 0,
      0,
      Math.max(0, items.length - 1)
    );
    const maxVisible = clamp2(
      typeof autocompleteList.maxVisible === "number" ? autocompleteList.maxVisible : 6,
      1,
      20
    );
    return {
      items,
      selectedIndex,
      maxVisible,
      showSlashPrefix: !trimmedBeforeCursor.includes(" ")
    };
  }
  formatSlashAutocompleteRow(item, isSelected, width, showSlashPrefix) {
    const rawCommand = normalizeSingleLine(item.label || item.value || "");
    const command = showSlashPrefix && rawCommand.length > 0 && !rawCommand.startsWith("/") ? `/${rawCommand}` : rawCommand;
    const description = typeof item.description === "string" ? normalizeSingleLine(item.description) : "";
    const prefix = isSelected ? "> " : "  ";
    const prefixWidth = safeVisibleWidth(prefix);
    if (description && width > 40) {
      const maxCommandWidth = Math.min(30, Math.max(8, width - prefixWidth - 10));
      const commandText = safeTruncateToWidth(command, maxCommandWidth, "");
      const spacing = " ".repeat(Math.max(1, 32 - safeVisibleWidth(commandText)));
      const remaining = width - prefixWidth - safeVisibleWidth(commandText) - safeVisibleWidth(spacing);
      if (remaining > 8) {
        const descriptionText = safeTruncateToWidth(description, remaining, "");
        if (isSelected) {
          return this.color(getThemeExtra(this.fullTheme, "slashSelectedColor"), `${prefix}${commandText}${spacing}${descriptionText}`);
        }
        const commandColored = this.color(getThemeExtra(this.fullTheme, "slashCommandColor"), commandText);
        const descriptionColored = this.color(getThemeExtra(this.fullTheme, "slashDescriptionColor"), `${spacing}${descriptionText}`);
        return `${prefix}${commandColored}${descriptionColored}`;
      }
    }
    const commandOnly = safeTruncateToWidth(command, Math.max(1, width - prefixWidth), "");
    if (isSelected) return this.color(getThemeExtra(this.fullTheme, "slashSelectedColor"), `${prefix}${commandOnly}`);
    return `${prefix}${this.color(getThemeExtra(this.fullTheme, "slashCommandColor"), commandOnly)}`;
  }
  renderSlashAutocomplete(width, border) {
    const model = this.getSlashAutocompleteModel();
    if (!model) return null;
    const totalItems = model.items.length;
    const innerWidth = Math.max(1, width - 2);
    const startIndex = totalItems > 0 ? Math.max(
      0,
      Math.min(
        model.selectedIndex - Math.floor(model.maxVisible / 2),
        Math.max(0, totalItems - model.maxVisible)
      )
    ) : 0;
    const endIndex = Math.min(startIndex + model.maxVisible, totalItems);
    const visibleItems = model.items.slice(startIndex, endIndex);
    const lines = [];
    lines.push(" ".repeat(width));
    lines.push(border(`\u250C${"\u2500".repeat(innerWidth)}\u2510`));
    if (visibleItems.length === 0) {
      const noMatch = this.color(getThemeExtra(this.fullTheme, "slashDescriptionColor"), "  No matching commands");
      const paddedNoMatch = `${noMatch}${" ".repeat(Math.max(0, innerWidth - safeVisibleWidth(noMatch)))}`;
      lines.push(`${border("\u2502")}${paddedNoMatch}${border("\u2502")}`);
    } else {
      for (let i = 0; i < visibleItems.length; i++) {
        const item = visibleItems[i];
        if (!item) continue;
        const itemIndex = startIndex + i;
        const row = this.formatSlashAutocompleteRow(
          item,
          itemIndex === model.selectedIndex,
          innerWidth,
          model.showSlashPrefix
        );
        const paddedRow = `${row}${" ".repeat(Math.max(0, innerWidth - safeVisibleWidth(row)))}`;
        lines.push(`${border("\u2502")}${paddedRow}${border("\u2502")}`);
      }
    }
    lines.push(border(`\u2514${"\u2500".repeat(innerWidth)}\u2518`));
    const shownStart = visibleItems.length > 0 ? startIndex + 1 : 0;
    const shownEnd = startIndex + visibleItems.length;
    const hint = ` Use \u2191\u2193 to navigate, Tab/Enter to select, Esc to cancel  Showing ${shownStart}-${shownEnd} of ${totalItems}`;
    const coloredHint = this.color(getThemeExtra(this.fullTheme, "slashHintColor"), hint);
    const truncatedHint = safeVisibleWidth(coloredHint) > width ? safeTruncateToWidth(coloredHint, width, "") : coloredHint;
    lines.push(`${truncatedHint}${" ".repeat(Math.max(0, width - safeVisibleWidth(truncatedHint)))}`);
    return lines;
  }
  tone(color2, text) {
    try {
      return typeof this.fullTheme?.fg === "function" ? this.fullTheme.fg(color2, text) : text;
    } catch {
      return text;
    }
  }
  bg(color2, text) {
    try {
      return typeof this.fullTheme?.bg === "function" ? this.fullTheme.bg(color2, text) : text;
    } catch {
      return text;
    }
  }
  bold(text) {
    return typeof this.fullTheme?.bold === "function" ? this.fullTheme.bold(text) : text;
  }
  pad(content, width) {
    const truncated = safeVisibleWidth(content) > width ? safeTruncateToWidth(content, width, "") : content;
    return `${truncated}${" ".repeat(Math.max(0, width - safeVisibleWidth(truncated)))}`;
  }
  formatCompactTokens(count) {
    if (count < 1e3) return count.toString();
    if (count < 1e4) return `${(count / 1e3).toFixed(1)}k`;
    if (count < 1e6) return `${Math.round(count / 1e3)}k`;
    if (count < 1e7) return `${(count / 1e6).toFixed(1)}M`;
    return `${Math.round(count / 1e6)}M`;
  }
  contextUsage() {
    const usage = this.getContextUsage?.();
    if (!usage || !usage.contextWindow) return null;
    const percent = typeof usage.percent === "number" && Number.isFinite(usage.percent) ? usage.percent : typeof usage.tokens === "number" && usage.contextWindow > 0 ? usage.tokens / usage.contextWindow * 100 : null;
    return { tokens: usage.tokens, contextWindow: usage.contextWindow, percent };
  }
  formatTokenBar(percent) {
    if (percent === null || !Number.isFinite(percent)) return "";
    const total = 12;
    const filled = Math.max(0, Math.min(total, Math.round(percent / 100 * total)));
    const fillColor = percent > 75 ? "error" : percent >= 50 ? "warning" : "accent";
    const full = filled > 0 ? this.tone(fillColor, "\u2501".repeat(filled)) : "";
    const empty = filled < total ? this.tone("borderMuted", "\u2501".repeat(total - filled)) : "";
    return `${full}${empty}`;
  }
  formatTokenMeter(showLabel = true) {
    const usage = this.contextUsage();
    if (!usage || usage.percent === null) return null;
    const tokenCount = typeof usage.tokens === "number" && Number.isFinite(usage.tokens) ? this.formatCompactTokens(usage.tokens) : "";
    const usageText = `${usage.percent.toFixed(1)}%/${this.formatCompactTokens(usage.contextWindow)}`;
    const detail = tokenCount ? `${this.tone("muted", tokenCount)} ${this.tone("bashMode", "\u25CF")} ${this.tone("muted", usageText)}` : this.tone("muted", usageText);
    const meter = `${this.formatTokenBar(usage.percent)} ${detail}`;
    return showLabel ? `${this.tone("dim", "Tokens:")}  ${meter}` : meter;
  }
  formatResponseSpeedBadge() {
    const speed = this.getResponseSpeed?.();
    if (typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0) return null;
    const rounded = speed >= 100 ? Math.round(speed).toString() : speed.toFixed(1).replace(/\.0$/, "");
    return `${rounded} words/s`;
  }
  formatModelBadge() {
    const info = this.getModelInfo?.();
    if (!info || !info.id) return null;
    const provider = info.provider ? `[${String(info.provider).toUpperCase()}] ` : "";
    const level = info.reasoning && info.thinkingLevel ? info.thinkingLevel === "off" ? " (thinking off)" : ` (${info.thinkingLevel})` : "";
    const plain = `${provider}${info.id}${level}`;
    return {
      plain,
      rendered: this.bg("selectedBg", ` ${this.tone("muted", provider)}${this.tone("text", `${info.id}${level}`)} `)
    };
  }
  formatGeminiModelBadge() {
    const info = this.getModelInfo?.();
    if (!info || !info.id) return null;
    const provider = typeof info.provider === "string" && info.provider.trim().length > 0 ? info.provider.trim().toLowerCase() : "";
    const id = String(info.id).trim();
    if (!id) return null;
    const level = info.reasoning && typeof info.thinkingLevel === "string" && info.thinkingLevel.trim().length > 0 ? info.thinkingLevel.trim() : "";
    const plain = `${provider ? `${provider} ` : ""}${id}${level ? ` \xB7 ${level}` : ""}`;
    const rendered = [
      provider ? `${this.tone("dim", provider)} ` : "",
      this.tone("muted", id),
      level ? `${this.tone("muted", " \xB7 ")}${this.tone("accent", level)}` : ""
    ].join("");
    return { plain, rendered };
  }
  formatCwd() {
    const home = homedir5().replace(/\\/g, "/");
    const normalized = (this.sessionCwd || process.cwd()).replace(/\\/g, "/");
    const display = normalized.startsWith(home) ? `~${normalized.slice(home.length)}` : normalized;
    const parts = display.split("/").filter(Boolean);
    if (display.startsWith("~")) parts[0] = "~";
    if (parts.length <= 3) return parts.join("/") || ".";
    return `${parts[0]}.../${parts.slice(-2).join("/")}`;
  }
  panelContentWidth(width) {
    const paddingX = this.userZoneStyle.editor.panelPaddingX;
    const sidePadding = Math.min(paddingX, Math.floor(Math.max(0, width - 1) / 2));
    return Math.max(1, width - sidePadding * 2);
  }
  formatBranchBadge() {
    const info = this.getBranch?.();
    if (!info?.branch) return null;
    return this.buildBranchBadge(info.branch, info.insertions, info.deletions, true);
  }
  // Single source of the `⎇ branch [+N] [-M]` FORMAT (token order, spaces, brackets), shared by the
  // existing non-nvim branch-badge call sites (droid's renderTopRow and gemini's status row --
  // cli-dock renders no branch) and the nvim input-frame top-rule label (US-023).
  // Colour is CALLER-decided: each `tones` entry is a theme tone NAME, a custom colorizer FUNCTION
  // (the nvim rule passes the rule's own colorizer so ⎇ and the name melt into the rule), or `null`
  // for terminal-default fg. Omitting `tones` keeps the historic footer styling byte-identical.
  // `withDiff: false` drops the LOC tail -- the nvim label's middle degrade rung, where churn yields
  // to identity; zero insertions/deletions self-hide.
  buildBranchBadge(branch, insertions, deletions, withDiff, tones, style = "brackets") {
    if (!branch) return null;
    const toneMap = tones ?? { icon: "bashMode", name: "mdLinkUrl", ins: "success", del: "error" };
    const seg = (tone, text) => {
      if (typeof tone === "function") return tone(text);
      return tone ? this.tone(tone, text) : text;
    };
    const insText = style === "bare" ? `+${insertions}` : `[+${insertions}]`;
    const delText = style === "bare" ? `-${deletions}` : `[-${deletions}]`;
    const icon = "\u2387";
    const diffPlain = withDiff ? [
      insertions ? insText : "",
      deletions ? delText : ""
    ].filter(Boolean) : [];
    const plain = [icon, branch, ...diffPlain].join(" ");
    const renderedDiff = withDiff ? [
      insertions ? seg(toneMap.ins, insText) : "",
      deletions ? seg(toneMap.del, delText) : ""
    ].filter(Boolean).join(" ") : "";
    const rendered = [
      seg(toneMap.icon, icon),
      seg(toneMap.name, branch),
      renderedDiff
    ].filter(Boolean).join(" ");
    return { plain, rendered };
  }
  renderPanelLine(content, width) {
    const paddingX = this.userZoneStyle.editor.panelPaddingX;
    const sidePadding = Math.min(paddingX, Math.floor(Math.max(0, width - 1) / 2));
    const sidePad = " ".repeat(sidePadding);
    const contentWidth = Math.max(1, width - sidePadding * 2);
    return `${sidePad}${this.pad(content, contentWidth)}${sidePad}`;
  }
  renderTopBorder(width) {
    const style = this.userZoneStyle.editor;
    const borderColor = this.themeExtraColor("inputBorderColor", style.hostBorderColor);
    const prefix = this.styleFg(style.hostPrefixColor, `== [${currentUserHost()}] == `);
    const remaining = Math.max(0, width - safeVisibleWidth(prefix));
    const fill = style.hostBorderFill || " ";
    return `${prefix}${this.styleFg(borderColor, fill.repeat(remaining))}`;
  }
  renderDivider(width) {
    const style = this.userZoneStyle.editor;
    const dividerColor = this.themeExtraColor("inputBorderColor", style.dividerColor);
    const divider = this.styleFg(dividerColor, (style.dividerChar || " ").repeat(Math.max(1, width)));
    return style.dividerBold ? this.bold(divider) : divider;
  }
  formatCellLabel(label) {
    return ` ${this.pad(this.tone("accent", `[${label}]`), 7)} `;
  }
  renderTopRow(width) {
    const sep = this.tone("borderMuted", "\u2502");
    const model = this.formatModelBadge();
    const showFooterMetadata = !this.metadataInSidebar();
    const path = showFooterMetadata ? `${this.formatCellLabel("env")}${this.tone("accent", this.formatCwd())}` : null;
    const leftParts = [path, model?.rendered].filter(Boolean);
    let left = leftParts.join(` ${sep} `);
    const branch = showFooterMetadata ? this.formatBranchBadge() : null;
    const right = branch ? `${sep} ${branch.rendered}` : "";
    const rightPlainWidth = branch ? safeVisibleWidth(`\u2502 ${branch.plain}`) : 0;
    const available = Math.max(1, width - rightPlainWidth - (right ? 1 : 0));
    const trimmedMain = safeVisibleWidth(left) > available ? safeTruncateToWidth(left, available, "\u2026") : left;
    const gap = right ? " ".repeat(Math.max(1, width - safeVisibleWidth(trimmedMain) - rightPlainWidth)) : "";
    return this.pad(`${trimmedMain}${gap}${right}`, width);
  }
  renderInputContentLines(text, width) {
    const logicalLines = text.length > 0 ? text.split("\n") : [""];
    const cursor = this.getCursor();
    const cursorLine = clamp2(cursor.line, 0, logicalLines.length - 1);
    const rendered = [];
    for (let i = 0; i < logicalLines.length; i++) {
      const rawLine = logicalLines[i] ?? "";
      const isCursorLine = i === cursorLine;
      let line = rawLine;
      if (isCursorLine) {
        const displayCursorCol = clamp2(cursor.col, 0, rawLine.length);
        const before = rawLine.slice(0, displayCursorCol);
        const after = rawLine.slice(displayCursorCol);
        const cursorGlyph = firstCodePoint(after);
        const atCursor = cursorGlyph || " ";
        const rest = cursorGlyph ? after.slice(cursorGlyph.length) : after;
        const marker = this.focused ? CURSOR_MARKER : "";
        line = `${before}${marker}\x1B[7m${atCursor}\x1B[27m${rest}`;
      }
      const wrapped = safeWrapTextWithAnsi(line, width);
      rendered.push(...wrapped.length > 0 ? wrapped : [""]);
    }
    return rendered.length > 0 ? rendered : [`${this.focused ? CURSOR_MARKER : ""}\x1B[7m \x1B[27m`];
  }
  formatRuntimeParts(showTokenLabel = true) {
    const bullet = this.tone("bashMode", "\u25CF");
    const tokenMeter = this.formatTokenMeter(showTokenLabel);
    const speedBadge = this.formatResponseSpeedBadge();
    return [
      tokenMeter,
      speedBadge ? `${bullet} ${this.tone("muted", speedBadge)}` : null
    ].filter((part) => Boolean(part));
  }
  renderSplitRow(left, right, rightPlain, width) {
    if (!rightPlain) return this.pad(left, width);
    const rightWidth = safeVisibleWidth(rightPlain);
    const availableLeft = Math.max(1, width - rightWidth - 2);
    const trimmedLeft = safeVisibleWidth(left) > availableLeft ? safeTruncateToWidth(left, availableLeft, "\u2026") : left;
    const gap = " ".repeat(Math.max(2, width - safeVisibleWidth(trimmedLeft) - rightWidth));
    return this.pad(`${trimmedLeft}${gap}${right}`, width);
  }
  formatFooterTokenUsage() {
    return normalizeSingleLine(stripAnsi(this.getFooterTokenUsage?.() ?? ""));
  }
  renderRuntimeRow(width) {
    const usageParts = this.formatRuntimeParts();
    const left = usageParts.length > 0 ? `${this.formatCellLabel("stat")}${usageParts.join("  ")}` : this.formatCellLabel("stat").trimEnd();
    const footerStatus = this.metadataInSidebar() ? "" : this.getFooterStatus?.() ?? "";
    const tokenUsage = this.formatFooterTokenUsage();
    const rightPlain = [tokenUsage, normalizeSingleLine(stripAnsi(footerStatus))].filter(Boolean).join("  ");
    const right = this.tone("dim", rightPlain);
    return this.renderSplitRow(left, right, rightPlain, width);
  }
  renderGeminiStatusRow(width) {
    const runtime = this.formatRuntimeParts(false).join("  ");
    const model = this.formatGeminiModelBadge();
    const sep = this.tone("borderMuted", "\u2502");
    const left = [model?.rendered, runtime].filter((part) => Boolean(part && stripAnsi(part).trim().length > 0)).join(` ${sep} `);
    const branch = this.metadataInSidebar() ? null : this.formatBranchBadge();
    const rightPlain = branch?.plain ?? "";
    const right = branch?.rendered ?? "";
    return this.renderSplitRow(left, right, rightPlain, width);
  }
  renderGeminiDivider(width) {
    const style = this.userZoneStyle.editor;
    const divider = this.styleFg(style.dividerColor || "border", "\u2500".repeat(Math.max(1, width)));
    return style.dividerBold ? this.bold(divider) : divider;
  }
  resolveInputFrame() {
    const presetFrame = this.userZoneStyle.editor.inputFrame;
    const frame = this.inputBoxStyle && this.inputBoxStyle !== "auto" ? this.inputBoxStyle : presetFrame;
    if (this.userZoneStyle.name === "cli-dock") return "outline";
    if (frame === "line" && this.userZoneStyle.name === "droid") return "none";
    if (frame === "line" || frame === "halfblock" || frame === "none" || frame === "solid" || frame === "outline") return frame;
    return process.env.NO_COLOR ? "line" : "halfblock";
  }
  // The colorizer the nvim `line` frame's rule runs use -- ONE source for the rule segments AND the
  // US-023 top-rule label, so the label's ⎇ and branch name always melt into the rule's exact tone
  // (user round-3: plain default-fg outshone the rule; the label must share the rule's colour, never
  // a guessed token). Exposed as a closure so the branch-badge formatter can consume it verbatim.
  inputRuleColorizer() {
    const style = this.userZoneStyle.editor;
    return (text) => this.styleBackgroundAsFg(style.inputBackgroundColor, text);
  }
  renderInputLineBorder(width, topLabel) {
    const style = this.userZoneStyle.editor;
    const char = style.dividerChar || "\u2500";
    const ruleFg = this.inputRuleColorizer();
    if (!topLabel) {
      return ruleFg(char.repeat(Math.max(1, width)));
    }
    const labelWidth = safeVisibleWidth(topLabel.plain);
    const leftCount = Math.max(2, width - labelWidth - 3);
    return `${ruleFg(char.repeat(leftCount))} ${topLabel.rendered} ${ruleFg(char.repeat(1))}`;
  }
  renderInputBoxFrame(inputLines, width, topLabel) {
    const style = this.userZoneStyle.editor;
    const inputFrame = this.resolveInputFrame();
    if (inputFrame === "line") {
      const top = this.renderInputLineBorder(width, topLabel);
      const bottom = this.renderInputLineBorder(width);
      return [top, ...inputLines.map((line) => this.pad(line, width)), bottom];
    }
    if (inputFrame === "none") return inputLines;
    if (inputFrame === "outline") {
      const borderColor = this.userZoneStyle.name === "cli-dock" ? style.slashBorderColor || style.dividerColor : this.themeExtraColor("inputBorderColor", style.slashBorderColor || style.dividerColor);
      const border = (value) => this.styleFg(borderColor, value);
      const innerWidth = Math.max(1, width - 2);
      if (width <= 2) return inputLines.map((line) => this.pad(line, width));
      return [
        border(`\u250C${"\u2500".repeat(innerWidth)}\u2510`),
        ...inputLines.map((line) => `${border("\u2502")}${this.pad(line, innerWidth)}${border("\u2502")}`),
        border(`\u2514${"\u2500".repeat(innerWidth)}\u2518`)
      ];
    }
    const renderLine = (line) => this.bg(style.inputBackgroundColor, this.pad(line, width));
    const inputRows = inputLines.map(renderLine);
    if (inputFrame === "solid") {
      const bottomPadding2 = this.bg(style.inputBackgroundColor, " ".repeat(Math.max(1, width)));
      return [...inputRows, bottomPadding2];
    }
    const topPadding = this.styleBackgroundAsFg(style.inputBackgroundColor, "\u2584".repeat(Math.max(1, width)));
    const bottomPadding = this.styleBackgroundAsFg(style.inputBackgroundColor, "\u2580".repeat(Math.max(1, width)));
    return [topPadding, ...inputRows, bottomPadding];
  }
  formatCliDockModelBadge() {
    const info = this.getModelInfo?.();
    const displayName = String(info?.name || info?.id || "").trim();
    if (!displayName) return null;
    const level = info?.reasoning && typeof info?.thinkingLevel === "string" && info.thinkingLevel.trim().length > 0 ? info.thinkingLevel.trim() : "";
    const levelLabel = level ? ` \xB7 ${level}` : "";
    return {
      plain: `${displayName}${levelLabel}`,
      rendered: `${this.tone("accent", displayName)}${level ? `${this.tone("muted", " \xB7 ")}${this.tone("accent", level)}` : ""}`
    };
  }
  formatCliDockFooterStatus() {
    const plain = normalizeSingleLine(stripAnsi(this.getFooterStatus?.() ?? ""));
    if (!plain) return null;
    const rendered = plain.split(/(✓)/g).map((part) => part === "\u2713" ? this.tone("success", part) : this.tone("muted", part)).join("");
    return { plain, rendered };
  }
  formatCliDockProjectName() {
    const normalized = (this.sessionCwd || process.cwd()).replace(/\\/g, "/").replace(/\/+$/, "");
    return normalized.split("/").filter(Boolean).pop() || ".";
  }
  renderCliDockStatusLine(width) {
    const parts = [];
    const model = this.formatCliDockModelBadge();
    if (model) {
      parts.push({ plain: model.plain, rendered: model.rendered });
    }
    const usage = this.contextUsage();
    if (usage?.contextWindow) {
      const used = typeof usage.tokens === "number" && Number.isFinite(usage.tokens) ? usage.tokens : 0;
      const ctxPlain = `Ctx: ${this.formatCompactTokens(used)}/${this.formatCompactTokens(usage.contextWindow)}`;
      parts.push({ plain: ctxPlain, rendered: this.tone("warning", ctxPlain) });
    }
    const branch = this.getBranch?.();
    if (branch?.branch) {
      parts.push({ plain: `\u{1F33F} ${branch.branch}`, rendered: this.tone("success", `\u{1F33F} ${branch.branch}`) });
    }
    const project = this.formatCliDockProjectName();
    parts.push({ plain: `\u{1F4C1} ${project}`, rendered: this.tone("mdLinkUrl", `\u{1F4C1} ${project}`) });
    const separator = ` ${this.tone("dim", "|")} `;
    const rendered = parts.map((part) => part.rendered).join(separator);
    const tokenUsage = this.formatFooterTokenUsage();
    const status = this.formatCliDockFooterStatus();
    const rightPlain = [tokenUsage, status?.plain].filter(Boolean).join("  ");
    if (!rightPlain) return safeVisibleWidth(rendered) > width ? safeTruncateToWidth(rendered, width, "\u2026") : this.pad(rendered, width);
    const right = [tokenUsage ? this.tone("dim", tokenUsage) : null, status?.rendered].filter(Boolean).join(this.tone("dim", "  "));
    return this.renderSplitRow(rendered, right, rightPlain, width);
  }
  renderGeminiFooter(width, contentWidth) {
    const style = this.userZoneStyle.editor;
    const footerStatus = this.metadataInSidebar() ? "" : normalizeSingleLine(stripAnsi(this.getFooterStatus?.() ?? ""));
    const tokenUsage = this.formatFooterTokenUsage();
    const affordance = [tokenUsage, footerStatus].filter(Boolean).join("  ");
    const cwd = this.formatCwd();
    if (!affordance && !cwd) return [];
    const maxRightWidth = Math.max(1, contentWidth - 3);
    const rightPlain = safeVisibleWidth(affordance) > maxRightWidth ? safeTruncateToWidth(affordance, maxRightWidth, "\u2026") : affordance;
    const left = cwd ? this.tone(style.footerValueColor, cwd) : "";
    const right = rightPlain ? this.tone(style.footerValueColor, rightPlain) : "";
    return [this.renderPanelLine(this.renderSplitRow(left, right, rightPlain, contentWidth), width)];
  }
  appendAutocomplete(lines, autocompleteLines, width) {
    const slashBorderColor = this.themeExtraColor("inputBorderColor", this.userZoneStyle.editor.slashBorderColor);
    const customSlashAutocomplete = this.renderSlashAutocomplete(width, (value) => this.styleFg(slashBorderColor, value));
    if (customSlashAutocomplete) return [...lines, ...customSlashAutocomplete];
    const paddedAutocomplete = autocompleteLines.map((line) => `${line}${" ".repeat(Math.max(0, width - safeVisibleWidth(line)))}`);
    return [...lines, ...paddedAutocomplete];
  }
  probeThemeFn(name) {
    const editorTheme = this.editorTheme;
    if (typeof editorTheme?.[name] === "function") return editorTheme[name].bind(editorTheme);
    const fullTheme = this.fullTheme;
    if (typeof fullTheme?.[name] === "function") return fullTheme[name].bind(fullTheme);
    return null;
  }
  colorizeNvimBashBadge(block) {
    const getBashColor = this.probeThemeFn("getBashModeBorderColor");
    const colorize = getBashColor?.();
    return typeof colorize === "function" ? colorize(block) : block;
  }
  formatNvimBadge() {
    const isBashMode = this.getText().trimStart().startsWith("!");
    const info = this.getModelInfo?.();
    if (!isBashMode && !(info?.reasoning && info.thinkingLevel)) return null;
    const label = isBashMode ? "BASH" : String(info.thinkingLevel).toUpperCase();
    const block = ` ${label} `;
    const colored = isBashMode ? this.colorizeNvimBashBadge(block) : this.tone("accent", block);
    const rerender = (t) => `\x1B[7m${isBashMode ? this.colorizeNvimBashBadge(t) : this.tone("accent", t)}\x1B[27m`;
    return { plain: block, rendered: `\x1B[7m${colored}\x1B[27m`, rerender };
  }
  formatNvimCacheHitPercent() {
    const raw = stripAnsi(this.getFooterTokenUsage?.() ?? "");
    const match = raw.match(/CH([\d.]+)%/);
    return match ? `${Math.round(Number(match[1]))}%` : "";
  }
  renderNvimStatusline(width) {
    const badge = this.formatNvimBadge();
    const badgePlain = badge?.plain ?? "";
    const badgeRendered = badge?.rendered ?? "";
    const info = this.getModelInfo?.();
    const provider = typeof info?.provider === "string" ? info.provider.trim().toLowerCase() : "";
    const modelId = typeof info?.id === "string" ? this.truncatePlain(info.id.trim(), NVIM_MODEL_ID_MAX, "\u2026") : "";
    const badgeGap = badge && modelId ? " " : "";
    const leftWithProviderPlain = modelId ? `${badgePlain}${badgeGap}${provider ? `${provider} \xB7 ${modelId}` : modelId}` : badgePlain;
    const leftWithProviderRendered = modelId ? `${badgeRendered}${badgeGap}${provider ? `${this.tone("dim", provider)}${this.tone("dim", " \xB7 ")}` : ""}${this.tone("muted", modelId)}` : badgeRendered;
    const leftModelOnlyPlain = modelId ? `${badgePlain}${badgeGap}${modelId}` : badgePlain;
    const leftModelOnlyRendered = modelId ? `${badgeRendered}${badgeGap}${this.tone("muted", modelId)}` : badgeRendered;
    const usage = this.contextUsage();
    const ctxPercent = usage && typeof usage.percent === "number" && Number.isFinite(usage.percent) ? `${Math.round(usage.percent)}%` : "";
    const tokensPart = usage && typeof usage.tokens === "number" && Number.isFinite(usage.tokens) ? `${this.formatCompactTokens(usage.tokens)}/${this.formatCompactTokens(usage.contextWindow)}` : "";
    const chPercent = this.formatNvimCacheHitPercent();
    const tokensCtx = [tokensPart, ctxPercent].filter(Boolean).join(" ");
    const chromeFullPlain = [tokensCtx, chPercent ? `CH ${chPercent}` : ""].filter(Boolean).join(" \xB7 ");
    const candidates = [
      { leftPlain: leftWithProviderPlain, left: leftWithProviderRendered, chromePlain: chromeFullPlain },
      { leftPlain: leftModelOnlyPlain, left: leftModelOnlyRendered, chromePlain: chromeFullPlain },
      { leftPlain: leftModelOnlyPlain, left: leftModelOnlyRendered, chromePlain: tokensCtx },
      { leftPlain: leftModelOnlyPlain, left: leftModelOnlyRendered, chromePlain: ctxPercent },
      { leftPlain: leftModelOnlyPlain, left: leftModelOnlyRendered, chromePlain: "" }
    ];
    const status = normalizeSingleLine(stripAnsi(this.getFooterStatus?.() ?? ""));
    let chosen = candidates[candidates.length - 1];
    let statusShown = "";
    let bestWidth = -1;
    for (const c of candidates) {
      const avail = Math.max(0, width - safeVisibleWidth(c.leftPlain) - 2);
      const chromeW = safeVisibleWidth(c.chromePlain);
      if (chromeW > avail) continue;
      const budget = avail - chromeW - (c.chromePlain ? 2 : 0);
      const candidateShown = this.reserveNvimStatus(status, budget);
      const candidateWidth = safeVisibleWidth(candidateShown);
      if (candidateWidth > bestWidth) {
        bestWidth = candidateWidth;
        chosen = c;
        statusShown = candidateShown;
      }
    }
    const rightPlain = [chosen.chromePlain, statusShown].filter(Boolean).join("  ");
    const rightWidth = safeVisibleWidth(rightPlain);
    const leftMax = Math.max(0, width - rightWidth - (rightPlain ? 2 : 0));
    let leftPlain = chosen.leftPlain;
    let leftRendered = chosen.left;
    if (safeVisibleWidth(leftPlain) > leftMax) {
      const withProvider = Boolean(modelId) && chosen.leftPlain === leftWithProviderPlain;
      const rec = this.recomposeNvimLeft(badgePlain, badge?.rerender, provider, modelId, badgeGap, withProvider, leftMax);
      leftPlain = rec.plain;
      leftRendered = rec.render;
    }
    const chromeRendered = chosen.chromePlain ? this.tone("muted", chosen.chromePlain) : "";
    const statusRendered = statusShown ? this.tone("dim", statusShown) : "";
    const right = [chromeRendered, statusRendered].filter(Boolean).join("  ");
    const middle = rightPlain ? Math.max(2, width - safeVisibleWidth(leftPlain) - rightWidth) : 0;
    const rowBody = `${leftRendered}${" ".repeat(middle)}${right}`;
    const row = `${rowBody}${" ".repeat(Math.max(0, width - safeVisibleWidth(rowBody)))}`;
    return this.bg(this.userZoneStyle.editor.inputBackgroundColor, row);
  }
  // Width-based truncation of a PLAIN string is not guaranteed to return plain output: pi-tui's
  // truncateToWidth (the fallback safeTruncateToWidth uses for anything outside the fast ASCII path --
  // CJK, emoji, any multi-byte grapheme) always wraps its ellipsis in \x1b[0m, even for plain input with
  // no ANSI at all. That contract is undocumented, so probe-and-strip rather than trust the name: the
  // input here is always plain, so every escape the truncator emits is junk it invented, and because an
  // escape has zero visible width, stripping it cannot change the width the truncator computed.
  truncatePlain(text, maxWidth, ellipsis = "\u2026") {
    return stripAnsi(safeTruncateToWidth(text, maxWidth, ellipsis));
  }
  // Reserve room for the extension status: the full string if it fits, a truncated-but-legible prefix
  // if only that fits, or nothing at all -- a lone ellipsis is worse than no status, since it carries
  // zero information and reads like a render error.
  reserveNvimStatus(status, budget) {
    if (!status || budget <= 0) return "";
    if (safeVisibleWidth(status) <= budget) return status;
    const truncated = this.truncatePlain(status, budget, "\u2026");
    return truncated === "\u2026" ? "" : truncated;
  }
  // Re-colour a truncated nvim left cluster from its plain segments, so width-based truncation runs
  // on plain text only; the reverse-video badge and provider/model accents are re-applied last.
  recomposeNvimLeft(badgePlain, badgeRerender, provider, modelId, badgeGap, withProvider, maxWidth) {
    const segs = [];
    if (badgePlain) segs.push({ plain: badgePlain, color: "", badgeRerender });
    if (withProvider) {
      if (badgeGap) segs.push({ plain: badgeGap, color: "" });
      const afterBadgeGap = Math.max(0, maxWidth - safeVisibleWidth(badgePlain) - safeVisibleWidth(badgeGap));
      const modelReserve = Math.min(safeVisibleWidth(modelId), NVIM_MIN_MODEL_WIDTH, afterBadgeGap);
      const separatorWidth = provider && modelId ? safeVisibleWidth(" \xB7 ") : 0;
      const providerBudget = Math.max(0, afterBadgeGap - modelReserve - separatorWidth);
      const providerShown = provider ? this.truncatePlain(provider, providerBudget, "") : "";
      if (providerShown) {
        segs.push({ plain: providerShown, color: "dim" });
        segs.push({ plain: " \xB7 ", color: "dim" });
      }
      if (modelId) segs.push({ plain: modelId, color: "muted" });
    } else {
      if (badgeGap) segs.push({ plain: badgeGap, color: "" });
      if (modelId) segs.push({ plain: modelId, color: "muted" });
    }
    let plain = "";
    let render = "";
    let remaining = maxWidth;
    for (const seg of segs) {
      if (remaining <= 0) break;
      const segWidth = safeVisibleWidth(seg.plain);
      const fits = segWidth <= remaining;
      const keep = fits ? seg.plain : this.truncatePlain(seg.plain, remaining, "");
      if (fits) remaining -= segWidth;
      else remaining = 0;
      plain += keep;
      if (seg.badgeRerender) {
        render += seg.badgeRerender(keep);
      } else if (seg.color) {
        render += this.tone(seg.color, keep);
      } else {
        render += keep;
      }
    }
    return { plain, render };
  }
  // US-023: the nvim layout's top-rule branch label, degraded by width in two monotonic rungs -- full
  // `⎇ name +N -M`, then `⎇ name` (LOC first: churn yields to identity), then null (plain rule).
  // Name comes from the same provider the statusline used, normalized like status text and capped at
  // NVIM_BRANCH_MAX; the string itself is the shared buildBranchBadge output, colours included.
  nvimTopRuleLabel(width) {
    const info = this.getBranch?.();
    const branch = info?.branch ? normalizeSingleLine(stripAnsi(info.branch)) : "";
    if (!branch) return null;
    const name = this.truncatePlain(branch, NVIM_BRANCH_MAX, "\u2026");
    const insertions = info?.insertions;
    const deletions = info?.deletions;
    const fits = (badge) => Boolean(badge && safeVisibleWidth(badge.plain) + 5 <= width);
    const nvimTones = { icon: "muted", name: "muted", ins: "success", del: "error" };
    const full = this.buildBranchBadge(name, insertions, deletions, true, nvimTones, "bare");
    if (fits(full)) return full;
    const nameOnly = this.buildBranchBadge(name, insertions, deletions, false, nvimTones, "bare");
    if (fits(nameOnly)) return nameOnly;
    return null;
  }
  renderNvimLayout(inputLines, autocompleteLines, width, _contentInnerWidth) {
    const lines = [...this.renderInputBoxFrame(inputLines, width, this.nvimTopRuleLabel(width)), this.renderNvimStatusline(width)];
    return this.appendAutocomplete(lines, autocompleteLines, width);
  }
  renderDroidLayout(inputLines, autocompleteLines, width, contentInnerWidth) {
    const editorStyle = this.userZoneStyle.editor;
    const lines = [];
    if (editorStyle.showHostBorder) lines.push(this.renderTopBorder(width));
    if (editorStyle.showMetadataRow) lines.push(this.renderPanelLine(this.renderTopRow(contentInnerWidth), width));
    if (editorStyle.showRuntimeRow) lines.push(this.renderPanelLine(this.renderRuntimeRow(contentInnerWidth), width));
    if (editorStyle.showDivider) lines.push(this.renderDivider(width));
    lines.push(...this.renderInputBoxFrame(inputLines, width));
    if (editorStyle.showTrailingBlankLine) lines.push(this.renderPanelLine("", width));
    return this.appendAutocomplete(lines, autocompleteLines, width);
  }
  renderGeminiLayout(inputLines, autocompleteLines, width, contentInnerWidth) {
    const lines = [];
    if (this.userZoneStyle.editor.showDivider) lines.push(this.renderGeminiDivider(width));
    if (this.userZoneStyle.editor.showRuntimeRow) lines.push(this.renderPanelLine(this.renderGeminiStatusRow(contentInnerWidth), width));
    lines.push(...this.renderInputBoxFrame(inputLines, width));
    lines.push(...this.renderGeminiFooter(width, contentInnerWidth));
    return this.appendAutocomplete(lines, autocompleteLines, width);
  }
  renderCliDockLayout(inputLines, autocompleteLines, width, contentInnerWidth) {
    const lines = [];
    lines.push(...this.renderInputBoxFrame(inputLines, contentInnerWidth).map((line) => this.renderPanelLine(line, width)));
    const statusInset = Math.min(CLI_DOCK_STATUS_INSET, Math.floor(Math.max(0, contentInnerWidth - 1) / 2));
    const statusPad = " ".repeat(statusInset);
    const statusLine = this.renderCliDockStatusLine(Math.max(1, contentInnerWidth - statusInset * 2));
    lines.push(this.renderPanelLine(`${statusPad}${statusLine}${statusPad}`, width));
    return this.appendAutocomplete(lines, autocompleteLines, width);
  }
  render(width) {
    const editorStyle = this.userZoneStyle.editor;
    const contentInnerWidth = this.panelContentWidth(width);
    const text = this.getText();
    const promptColor = editorStyle.prompt === "\u276F" ? this.themeExtraColor("userPrefixColor", editorStyle.promptColor) : editorStyle.layout === "cli-dock" ? editorStyle.promptColor : this.themeExtraColor("bashPromptColor", editorStyle.promptColor);
    const promptText = this.styleFg(promptColor, editorStyle.prompt);
    const prompt = editorStyle.promptBold ? this.bold(promptText) : promptText;
    const promptPrefix = `${editorStyle.layout === "cli-dock" ? " " : ""}${prompt}${" ".repeat(Math.max(0, editorStyle.promptGap))}`;
    const prefixWidth = safeVisibleWidth(promptPrefix);
    const inputInnerWidth = Math.max(1, contentInnerWidth - (editorStyle.layout === "cli-dock" ? 2 : 0));
    const contentWidth = Math.max(1, inputInnerWidth - prefixWidth);
    const parentLines = super.render(contentWidth);
    if (parentLines.length === 0) return parentLines;
    const bottomBorderIndex = findLastBorderIndex(parentLines);
    const autocompleteLines = bottomBorderIndex >= 0 ? parentLines.slice(bottomBorderIndex + 1) : [];
    const displayLines = this.renderInputContentLines(text, contentWidth);
    if (editorStyle.placeholder && text.length === 0 && displayLines[0] !== void 0) {
      const placeholder = this.tone("dim", editorStyle.placeholder);
      const available = Math.max(0, contentWidth - safeVisibleWidth(displayLines[0]));
      displayLines[0] = `${displayLines[0]}${safeVisibleWidth(placeholder) > available ? safeTruncateToWidth(placeholder, available, "") : placeholder}`;
    }
    const inputLines = displayLines.map((line, index) => {
      const prefix = index === 0 ? promptPrefix : " ".repeat(prefixWidth);
      const available = Math.max(1, inputInnerWidth - safeVisibleWidth(prefix));
      const row = `${prefix}${this.pad(line, available)}`;
      return editorStyle.layout === "cli-dock" ? this.pad(row, inputInnerWidth) : this.renderPanelLine(row, width);
    });
    const layoutRenderers = {
      "cli-dock": (il, al, w, ciw) => this.renderCliDockLayout(il, al, w, ciw),
      "gemini": (il, al, w, ciw) => this.renderGeminiLayout(il, al, w, ciw),
      "droid": (il, al, w, ciw) => this.renderDroidLayout(il, al, w, ciw),
      "nvim": (il, al, w, ciw) => this.renderNvimLayout(il, al, w, ciw)
    };
    const renderer = layoutRenderers[editorStyle.layout] ?? layoutRenderers.droid;
    return renderer(inputLines, autocompleteLines, width, contentInnerWidth);
  }
};

// core/assistant-speed.ts
var SPEED_UPDATE_INTERVAL_MS = 5e3;
var MIN_SPEED_SAMPLE_MS = 150;
function countWords3(text) {
  return text.match(/[\p{L}\p{N}_]+/gu)?.length ?? 0;
}
function countTextWords(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return 0;
  return content.reduce((sum, block) => {
    if (block?.type !== "text" || typeof block.text !== "string") return sum;
    return sum + countWords3(block.text);
  }, 0);
}
function computeSpeed(words, startMs, endMs = Date.now()) {
  const elapsedMs = endMs - startMs;
  if (elapsedMs < MIN_SPEED_SAMPLE_MS) return null;
  return words / (elapsedMs / 1e3);
}
function normalizeSpeed(wordsPerSecond) {
  return wordsPerSecond >= 100 ? Math.round(wordsPerSecond) : Math.round(wordsPerSecond * 10) / 10;
}
function createAssistantSpeedTracker() {
  let assistantResponseStartMs = null;
  let assistantTextStartMs = null;
  let assistantLastTextMs = null;
  let currentAssistantWordsPerSecond = null;
  let lastAssistantWordsPerSecond = null;
  let lastAssistantWordCount = 0;
  let lastSpeedUpdateMs = 0;
  function resetCurrentMessage() {
    assistantResponseStartMs = null;
    assistantTextStartMs = null;
    assistantLastTextMs = null;
    currentAssistantWordsPerSecond = null;
    lastAssistantWordCount = 0;
    lastSpeedUpdateMs = 0;
  }
  return {
    handleMessageStart(message) {
      if (message.role !== "assistant") return;
      assistantResponseStartMs = Date.now();
      assistantTextStartMs = null;
      assistantLastTextMs = null;
      currentAssistantWordsPerSecond = null;
      lastAssistantWordsPerSecond = null;
      lastAssistantWordCount = 0;
      lastSpeedUpdateMs = 0;
    },
    handleMessageUpdate(message) {
      if (message.role !== "assistant") return;
      if (!assistantResponseStartMs) return;
      const words = countTextWords(message);
      if (words <= 0) return;
      const now = Date.now();
      if (assistantTextStartMs === null) {
        assistantTextStartMs = now;
        assistantLastTextMs = now;
        lastAssistantWordCount = words;
        lastSpeedUpdateMs = now;
        return;
      }
      if (words <= lastAssistantWordCount) return;
      assistantLastTextMs = now;
      lastAssistantWordCount = words;
      const nextSpeed = computeSpeed(words, assistantTextStartMs, assistantLastTextMs);
      if (nextSpeed === null) return;
      const normalizedSpeed = normalizeSpeed(nextSpeed);
      if (now - lastSpeedUpdateMs < SPEED_UPDATE_INTERVAL_MS) return;
      lastSpeedUpdateMs = now;
      if (currentAssistantWordsPerSecond !== normalizedSpeed) {
        currentAssistantWordsPerSecond = normalizedSpeed;
      }
    },
    handleMessageEnd(message) {
      if (message.role !== "assistant") return;
      const startedAt = assistantTextStartMs ?? assistantResponseStartMs;
      const endedAt = assistantLastTextMs ?? Date.now();
      resetCurrentMessage();
      if (!startedAt) return;
      const words = countTextWords(message);
      if (words <= 0) return;
      const finalSpeed = computeSpeed(words, startedAt, endedAt);
      if (finalSpeed === null) {
        lastAssistantWordsPerSecond = null;
        return;
      }
      lastAssistantWordsPerSecond = finalSpeed;
    },
    resetSession() {
      resetCurrentMessage();
      lastAssistantWordsPerSecond = null;
    },
    getWordsPerSecond() {
      return currentAssistantWordsPerSecond ?? lastAssistantWordsPerSecond;
    }
  };
}

// core/git-status.ts
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join as join6 } from "node:path";
var BRANCH_FETCH_INTERVAL_MS = 5e3;
var GIT_COMMAND_TIMEOUT_MS = 1e3;
var MAX_UNTRACKED_STAT_BYTES = 1024 * 1024;
var MAX_UNTRACKED_INSERTION_STATS = 10;
function gitCommandMetric(args) {
  if (args[0] === "rev-parse") return "revParseBranch";
  if (args[0] === "status") return "statusPorcelain";
  if (args[0] === "diff" && args.includes("--cached") && args.includes("--numstat")) return "diffCachedNumstat";
  if (args[0] === "diff" && args.includes("--numstat")) return "diffNumstat";
  if (args[0] === "diff" && args.includes("--cached") && args.includes("--shortstat")) return "diffCachedShortstat";
  if (args[0] === "diff" && args.includes("--shortstat")) return "diffShortstat";
  return "other";
}
function sameFileList(a, b) {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every((value, index) => {
    const other = right[index];
    return value.path === other?.path && value.insertions === other?.insertions && value.deletions === other?.deletions;
  });
}
function runGit(cwd, args) {
  const metric = gitCommandMetric(args);
  const start = profileNow();
  profileCount(`git.command.${metric}.calls`);
  return new Promise((resolve3) => {
    let settled = false;
    let timeout;
    const finish = (output) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      profileDuration(`git.command.${metric}.ms`, start);
      profileTextBytes(`git.command.${metric}.output.bytes`, output);
      resolve3(output);
    };
    try {
      const p = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
      const chunks = [];
      p.stdout.on("data", (d) => {
        chunks.push(d.toString("utf8"));
      });
      p.on("close", (code) => {
        if (code !== 0) profileCount(`git.command.${metric}.nonzero`);
        finish(code === 0 ? chunks.join("") : "");
      });
      p.on("error", () => {
        profileCount(`git.command.${metric}.error`);
        finish("");
      });
      timeout = setTimeout(() => {
        profileCount(`git.command.${metric}.timeout`);
        try {
          p.kill();
        } catch {
        }
        finish("");
      }, GIT_COMMAND_TIMEOUT_MS);
    } catch {
      profileCount(`git.command.${metric}.spawnError`);
      finish("");
    }
  });
}
function parseShortstat(statText) {
  const insMatch = statText.match(/(\d+) insertion/);
  const delMatch = statText.match(/(\d+) deletion/);
  return {
    insertions: insMatch ? parseInt(insMatch[1], 10) : 0,
    deletions: delMatch ? parseInt(delMatch[1], 10) : 0
  };
}
function addDiffStats(map, path, stats) {
  const previous = map.get(path);
  map.set(path, {
    insertions: (previous?.insertions ?? 0) + stats.insertions,
    deletions: (previous?.deletions ?? 0) + stats.deletions
  });
}
function parseNumstatPath(pathText) {
  const raw = pathText.trim();
  const arrowIndex = raw.lastIndexOf(" -> ");
  if (arrowIndex !== -1) return unquoteGitPath(raw.slice(arrowIndex + 4));
  return unquoteGitPath(raw);
}
function parseNumstatMap(output) {
  const statsByPath = /* @__PURE__ */ new Map();
  for (const line of output.split("\n")) {
    const match = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/);
    if (!match || match[1] === "-" || match[2] === "-") continue;
    const path = parseNumstatPath(match[3] ?? "");
    if (!path) continue;
    addDiffStats(statsByPath, path, {
      insertions: parseInt(match[1], 10) || 0,
      deletions: parseInt(match[2], 10) || 0
    });
  }
  return statsByPath;
}
function unquoteGitPath(path) {
  const trimmed = path.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed.slice(1, -1);
  }
}
function parseStatusPath(line) {
  const raw = line.slice(3).trim();
  const arrowIndex = raw.lastIndexOf(" -> ");
  return unquoteGitPath(arrowIndex === -1 ? raw : raw.slice(arrowIndex + 4));
}
async function fileModifiedAt(cwd, path) {
  try {
    return (await stat(join6(cwd, path))).mtimeMs;
  } catch {
    return 0;
  }
}
async function countUntrackedInsertions(cwd, path) {
  const start = profileNow();
  profileCount("git.untrackedStats.calls");
  try {
    const fullPath = join6(cwd, path);
    const stats = await stat(fullPath);
    if (!stats.isFile() || stats.size > MAX_UNTRACKED_STAT_BYTES) {
      profileCount("git.untrackedStats.skipLargeOrNonFile");
      return void 0;
    }
    profileSample("git.untrackedStats.fileBytes", stats.size);
    const text = await readFile(fullPath, "utf8");
    if (text.length === 0) return { insertions: 0, deletions: 0 };
    const newlineCount = text.match(/\n/g)?.length ?? 0;
    const insertions = newlineCount + (text.endsWith("\n") ? 0 : 1);
    return { insertions, deletions: 0 };
  } catch {
    profileCount("git.untrackedStats.error");
    return void 0;
  } finally {
    profileDuration("git.untrackedStats.ms", start);
  }
}
function diffStatsForEntry(entry, unstagedStatsByPath, stagedStatsByPath) {
  if (entry.xy === "??") return void 0;
  const staged = entry.xy[0] !== " " && entry.xy[0] !== "?";
  const unstaged = entry.xy[1] !== " " && entry.xy[1] !== "?";
  let insertions = 0;
  let deletions = 0;
  let matched = false;
  const add = (stats) => {
    if (!stats) return;
    insertions += stats.insertions;
    deletions += stats.deletions;
    matched = true;
  };
  if (staged) add(stagedStatsByPath.get(entry.path));
  if (unstaged || !staged) add(unstagedStatsByPath.get(entry.path));
  return matched ? { insertions, deletions } : void 0;
}
async function parseStatusEntries(cwd, status) {
  const lines = status.split("\n").map((line) => line.trimEnd()).filter(Boolean);
  const entries = await Promise.all(lines.map(async (line, order) => {
    const xy = line.slice(0, 2);
    const path = parseStatusPath(line);
    if (!path) return null;
    return {
      xy,
      path,
      modifiedAt: await fileModifiedAt(cwd, path),
      order
    };
  }));
  return entries.filter((entry) => entry !== null).sort((a, b) => b.modifiedAt - a.modifiedAt || a.order - b.order);
}
async function parseModifiedFilesWithStats(cwd, status, unstagedNumstat, stagedNumstat) {
  const start = profileNow();
  try {
    const entries = await parseStatusEntries(cwd, status);
    profileSample("git.status.entries.count", entries.length);
    const unstagedStatsByPath = parseNumstatMap(unstagedNumstat);
    const stagedStatsByPath = parseNumstatMap(stagedNumstat);
    const modifiedFiles = [];
    let untrackedStatsRemaining = MAX_UNTRACKED_INSERTION_STATS;
    for (const entry of entries) {
      let stats = diffStatsForEntry(entry, unstagedStatsByPath, stagedStatsByPath);
      if (entry.xy === "??" && untrackedStatsRemaining > 0) {
        untrackedStatsRemaining--;
        stats = await countUntrackedInsertions(cwd, entry.path);
      }
      modifiedFiles.push({
        path: entry.path,
        insertions: stats?.insertions || void 0,
        deletions: stats?.deletions || void 0
      });
    }
    profileSample("git.modifiedFiles.count", modifiedFiles.length);
    return modifiedFiles;
  } finally {
    profileDuration("git.modifiedFiles.parse.ms", start);
  }
}
function createGitBranchFetcher(cwd, onUpdate) {
  let cachedBranch = null;
  let branchLastFetch = 0;
  let branchFetchInFlight = false;
  function setCachedBranch(next) {
    const previous = cachedBranch;
    cachedBranch = next;
    if (previous?.branch !== next?.branch || previous?.insertions !== next?.insertions || previous?.deletions !== next?.deletions || !sameFileList(previous?.modifiedFiles, next?.modifiedFiles)) {
      profileCount("git.cache.changed");
      onUpdate?.();
      return;
    }
    profileCount("git.cache.unchanged");
  }
  async function refreshBranch() {
    profileCount("git.refresh.start");
    const start = profileNow();
    try {
      const [branchOutput, unstagedStat, stagedStat, status] = await Promise.all([
        runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
        runGit(cwd, ["diff", "--shortstat"]),
        runGit(cwd, ["diff", "--cached", "--shortstat"]),
        runGit(cwd, ["status", "--porcelain=v1"])
      ]);
      const branch = branchOutput.trim();
      if (!branch) {
        profileCount("git.refresh.noBranch");
        setCachedBranch(null);
        return;
      }
      const unstaged = parseShortstat(unstagedStat);
      const staged = parseShortstat(stagedStat);
      const hasModifiedFiles = status.trim().length > 0;
      profileSample("git.status.bytes", status.length);
      const [unstagedNumstat, stagedNumstat] = hasModifiedFiles ? await Promise.all([
        runGit(cwd, ["diff", "--numstat"]),
        runGit(cwd, ["diff", "--cached", "--numstat"])
      ]) : ["", ""];
      const modifiedFiles = hasModifiedFiles ? await parseModifiedFilesWithStats(cwd, status, unstagedNumstat, stagedNumstat) : [];
      const insertions = unstaged.insertions + staged.insertions;
      const deletions = unstaged.deletions + staged.deletions;
      profileSample("git.diff.insertions.count", insertions);
      profileSample("git.diff.deletions.count", deletions);
      setCachedBranch({
        branch,
        insertions: insertions || void 0,
        deletions: deletions || void 0,
        modifiedFiles
      });
    } finally {
      branchFetchInFlight = false;
      profileDuration("git.refresh.ms", start);
    }
  }
  return () => {
    profileCount("git.fetch.calls");
    const now = Date.now();
    if (branchFetchInFlight) {
      profileCount("git.fetch.inFlightSkip");
      return cachedBranch;
    }
    if (now - branchLastFetch < BRANCH_FETCH_INTERVAL_MS) {
      profileCount("git.fetch.cacheHit");
      return cachedBranch;
    }
    profileCount("git.fetch.scheduleRefresh");
    branchFetchInFlight = true;
    branchLastFetch = now;
    void refreshBranch();
    return cachedBranch;
  };
}

// messages/assistant-prefix.ts
import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
var activeTheme2 = null;
var PATCHED3 = Symbol.for("pi-droid-styling.assistant-prefix.patched");
function buildPrefixSegment() {
  const prefix = getThemeExtra(activeTheme2, "assistantPrefix");
  const color2 = getThemeExtra(activeTheme2, "assistantPrefixColor");
  return activeTheme2 ? fgHex(activeTheme2, color2, prefix) : prefix;
}
function buildDividerLine(width) {
  if (width <= 0) return "";
  const char = getThemeExtra(activeTheme2, "dividerChar");
  const color2 = getThemeExtra(activeTheme2, "dividerColor");
  const line = char.repeat(width);
  return activeTheme2 ? fgHex(activeTheme2, color2, line) : line;
}
function composePrefixedLine(line) {
  const prefix = buildPrefixSegment();
  const design = getPresentationDesign();
  if (design.compactLayout) {
    if (!line) return `${prefix}${design.markerGap}`;
    return startsWithVisibleSpace(line) ? `${prefix}${line}` : `${prefix}${design.markerGap}${line}`;
  }
  if (!line) return `${prefix}  `;
  return startsWithVisibleSpace(line) ? `${prefix} ${line}` : `${prefix}  ${line}`;
}
function isVisibleTextBlock(contentBlock) {
  return contentBlock?.type === "text" && typeof contentBlock.text === "string" && contentBlock.text.trim().length > 0;
}
function isVisibleThinkingBlock(contentBlock) {
  return contentBlock?.type === "thinking" && typeof contentBlock.thinking === "string" && contentBlock.thinking.trim().length > 0;
}
function compactReasonixLines(lines) {
  let first = 0;
  while (first < lines.length && stripAnsi(lines[first] ?? "").trim() === "") first++;
  let last = lines.length - 1;
  while (last >= first && stripAnsi(lines[last] ?? "").trim() === "") last--;
  return first <= last ? [...lines.slice(first, last + 1), ""] : [];
}
function hasVisibleAssistantContent(contentBlocks) {
  return contentBlocks.some((contentBlock) => isVisibleTextBlock(contentBlock) || isVisibleThinkingBlock(contentBlock));
}
function stripItalicAnsi(text) {
  return text.replace(/\x1b\[3m/g, "").replace(/\x1b\[23m/g, "");
}
function styleThinkingLine(text) {
  if (!getPresentationDesign().compactLayout) return stripItalicAnsi(text);
  const plain = stripAnsi(text);
  if (plain.trim().length === 0 || typeof activeTheme2?.fg !== "function") return plain;
  const colored = activeTheme2.fg("thinkingText", plain);
  return typeof activeTheme2.italic === "function" ? activeTheme2.italic(colored) : colored;
}
function getAssistantBodyWidth(width) {
  return Math.max(1, width - safeVisibleWidth(composePrefixedLine("")) - 1);
}
function addAssistantGutter(lines) {
  const indent = " ".repeat(safeVisibleWidth(composePrefixedLine("")));
  return lines.map((line) => {
    if (stripAnsi(line).trim().length === 0) return line;
    return `${indent}${dropLeadingColumns(line, 1)}`;
  });
}
function makeThinkingChildPlain(child, mode) {
  if (!child || typeof child.render !== "function" || child.__plainThinkingPatched) return;
  child.__plainThinkingPatched = true;
  const baseRender = child.render.bind(child);
  child.render = (width) => {
    const bodyWidth = mode === "plain" ? width : getAssistantBodyWidth(width);
    const lines = baseRender(bodyWidth).map(styleThinkingLine);
    if (mode === "prefix") return prefixFirstNonEmptyLine(lines, width);
    if (mode === "gutter") return addAssistantGutter(lines);
    return lines;
  };
}
function patchThinkingChildren(component, contentBlocks) {
  const hasVisibleContent = hasVisibleAssistantContent(contentBlocks);
  let childIndex = hasVisibleContent ? 1 : 0;
  let turnMarkerUsed = false;
  for (let i = 0; i < contentBlocks.length; i++) {
    const contentBlock = contentBlocks[i];
    if (isVisibleTextBlock(contentBlock)) {
      childIndex += 1;
    } else if (isVisibleThinkingBlock(contentBlock)) {
      const hasTextAfter = contentBlocks.slice(i + 1).some((nextBlock) => isVisibleTextBlock(nextBlock));
      const mode = hasTextAfter ? turnMarkerUsed ? "gutter" : "prefix" : "plain";
      makeThinkingChildPlain(component?.contentContainer?.children?.[childIndex], mode);
      if (mode === "prefix") turnMarkerUsed = true;
      childIndex += 1;
      const hasVisibleContentAfter = contentBlocks.slice(i + 1).some((nextBlock) => isVisibleTextBlock(nextBlock) || isVisibleThinkingBlock(nextBlock));
      if (hasVisibleContentAfter) childIndex += 1;
    }
  }
}
function alignContinuationLines(lines, targetIndex) {
  const indent = " ".repeat(safeVisibleWidth(composePrefixedLine("")));
  for (let i = targetIndex + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (stripAnsi(line).trim().length === 0) continue;
    lines[i] = `${indent}${dropLeadingColumns(line, 1)}`;
  }
}
function prefixFirstNonEmptyLine(lines, width) {
  if (width <= 0 || lines.length === 0) return lines;
  const compactPrefixBase = composePrefixedLine("");
  const compactPrefix = safeVisibleWidth(compactPrefixBase) > width ? safeTruncateToWidth(compactPrefixBase, width, "") : compactPrefixBase;
  const output = [...lines];
  let targetIndex = -1;
  for (let i = 0; i < output.length; i++) {
    const clean = stripAnsi(output[i] ?? "");
    if (clean.trim().length > 0) {
      targetIndex = i;
      break;
    }
  }
  if (targetIndex === -1) return [compactPrefix];
  const remainder = dropLeadingColumns(output[targetIndex] ?? "", 1);
  output[targetIndex] = composePrefixedLine(remainder);
  alignContinuationLines(output, targetIndex);
  return output.map(
    (renderedLine) => safeVisibleWidth(renderedLine) > width ? safeTruncateToWidth(renderedLine, width, "") : renderedLine
  );
}
function installAssistantMessagePrefix(theme) {
  activeTheme2 = theme;
  const proto = AssistantMessageComponent.prototype;
  if (proto[PATCHED3] || proto.render?.name === "patchedAssistantMessageRender") {
    proto[PATCHED3] = true;
    return;
  }
  proto[PATCHED3] = true;
  const baseUpdateContent = proto.updateContent;
  if (typeof baseUpdateContent === "function") {
    proto.updateContent = function patchedAssistantUpdateContent(message) {
      baseUpdateContent.call(this, message);
      this.__assistantResponsePrefixChildMode = false;
      if (!message || !Array.isArray(message.content)) return;
      const contentBlocks = message.content;
      patchThinkingChildren(this, contentBlocks);
      const firstTextIndex = contentBlocks.findIndex((contentBlock) => isVisibleTextBlock(contentBlock));
      if (firstTextIndex === -1) return;
      const hasThinkingBeforeText = contentBlocks.slice(0, firstTextIndex).some((contentBlock) => isVisibleThinkingBlock(contentBlock));
      if (!hasThinkingBeforeText) return;
      this.__assistantResponsePrefixChildMode = true;
      const hasVisibleContent = contentBlocks.some(
        (contentBlock) => isVisibleTextBlock(contentBlock) || isVisibleThinkingBlock(contentBlock)
      );
      let childIndex = hasVisibleContent ? 1 : 0;
      let targetChild = void 0;
      for (let i = 0; i < contentBlocks.length; i++) {
        const contentBlock = contentBlocks[i];
        if (isVisibleTextBlock(contentBlock)) {
          if (i === firstTextIndex) {
            targetChild = this?.contentContainer?.children?.[childIndex];
            break;
          }
          childIndex += 1;
        } else if (isVisibleThinkingBlock(contentBlock)) {
          childIndex += 1;
          const hasVisibleContentAfter = contentBlocks.slice(i + 1).some((nextBlock) => isVisibleTextBlock(nextBlock) || isVisibleThinkingBlock(nextBlock));
          if (hasVisibleContentAfter) childIndex += 1;
        }
      }
      if (!targetChild || typeof targetChild.render !== "function") return;
      const childState = targetChild;
      if (childState.__assistantResponsePrefixPatched) return;
      childState.__assistantResponsePrefixPatched = true;
      const baseChildRender = targetChild.render.bind(targetChild);
      targetChild.render = (width) => addAssistantGutter(baseChildRender(getAssistantBodyWidth(width)));
    };
  }
  const baseRender = proto.render;
  proto.render = function patchedAssistantMessageRender(width) {
    if (width <= 0) return baseRender.call(this, width);
    const lines = baseRender.call(this, this.__assistantResponsePrefixChildMode ? width : getAssistantBodyWidth(width));
    const design = getPresentationDesign();
    const compactPrefixBase = composePrefixedLine("");
    const compactPrefix = safeVisibleWidth(compactPrefixBase) > width ? safeTruncateToWidth(compactPrefixBase, width, "") : compactPrefixBase;
    const divider = buildDividerLine(width);
    if (lines.length === 0) {
      return lines;
    }
    if (this.__assistantResponsePrefixChildMode) {
      const result2 = lines.map(
        (renderedLine) => safeVisibleWidth(renderedLine) > width ? safeTruncateToWidth(renderedLine, width, "") : renderedLine
      );
      if (design.compactLayout) return compactReasonixLines(result2);
      const showDivider2 = getThemeExtra(activeTheme2, "showDivider") !== "false";
      return showDivider2 ? [divider, ...result2, ""] : [...result2, ""];
    }
    const output = [...lines];
    const startIndex = lines.length > 1 ? 1 : 0;
    let targetIndex = -1;
    for (let i = startIndex; i < output.length; i++) {
      const clean = stripAnsi(output[i] ?? "");
      if (clean.trim().length > 0) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === -1) {
      return lines;
    }
    const line = output[targetIndex] ?? "";
    const remainder = dropLeadingColumns(line, 1);
    output[targetIndex] = composePrefixedLine(remainder);
    alignContinuationLines(output, targetIndex);
    const result = output.map(
      (renderedLine) => safeVisibleWidth(renderedLine) > width ? safeTruncateToWidth(renderedLine, width, "") : renderedLine
    );
    if (design.compactLayout) return compactReasonixLines(result);
    const showDivider = getThemeExtra(activeTheme2, "showDivider") !== "false";
    return showDivider ? [divider, ...result, ""] : [...result, ""];
  };
}

// messages/markdown-codeblock-renderer.ts
import { Markdown, visibleWidth, wrapTextWithAnsi as wrapTextWithAnsi2 } from "@earendil-works/pi-tui";
var PATCHED4 = Symbol.for("pi-droid-styling.markdown-codeblock-renderer.patched");
var DEFAULT_CODE_BLOCK_RAIL = "\u2503 ";
function getCodeLanguage(token) {
  const raw = typeof token.lang === "string" ? token.lang.trim() : "";
  if (!raw) return void 0;
  return raw.split(/\s+/, 1)[0];
}
function styleCodeLine(component, line) {
  const codeBlock = component.theme?.codeBlock;
  return typeof codeBlock === "function" ? codeBlock(line) : line;
}
function styleCodeBlockRail(component) {
  const codeBlockBorder = component.theme?.codeBlockBorder;
  return typeof codeBlockBorder === "function" ? codeBlockBorder(DEFAULT_CODE_BLOCK_RAIL) : DEFAULT_CODE_BLOCK_RAIL;
}
function styleCodeBlockLanguage(component, language) {
  const italic = component.theme?.italic;
  const codeBlockBorder = component.theme?.codeBlockBorder;
  const label = `#${language}`;
  const styledLabel = typeof italic === "function" ? italic(label) : label;
  return typeof codeBlockBorder === "function" ? codeBlockBorder(styledLabel) : styledLabel;
}
function renderHighlightedCode(component, code, language) {
  const highlightCode4 = component.theme?.highlightCode;
  if (typeof highlightCode4 === "function") {
    try {
      const highlighted = highlightCode4(code, language);
      if (Array.isArray(highlighted)) return highlighted;
    } catch {
    }
  }
  return code.split("\n").map((line) => styleCodeLine(component, line));
}
function renderCodeBlockLine(rail, line, width) {
  const contentWidth = Math.max(1, width - visibleWidth(rail));
  return wrapTextWithAnsi2(line, contentWidth).map((wrappedLine) => `${rail}${wrappedLine}`);
}
function renderCodeBlock(component, token, width, nextTokenType) {
  const lines = [];
  const language = getCodeLanguage(token);
  const code = typeof token.text === "string" ? token.text : "";
  const rail = styleCodeBlockRail(component);
  if (language) {
    lines.push(...renderCodeBlockLine(rail, styleCodeBlockLanguage(component, language), width));
  }
  for (const line of renderHighlightedCode(component, code, language)) {
    lines.push(...renderCodeBlockLine(rail, line, width));
  }
  if (nextTokenType && nextTokenType !== "space") {
    lines.push("");
  }
  return lines;
}
function installMarkdownCodeBlockRenderer(MarkdownClass = Markdown) {
  const proto = MarkdownClass?.prototype;
  if (!proto || proto[PATCHED4]) return;
  const baseRenderToken = proto.renderToken;
  if (typeof baseRenderToken !== "function") return;
  proto[PATCHED4] = true;
  proto.renderToken = function patchedMarkdownCodeBlockRenderer(token, width, nextTokenType, styleContext) {
    if (token?.type === "code") {
      return renderCodeBlock(this, token, width, nextTokenType);
    }
    return baseRenderToken.call(this, token, width, nextTokenType, styleContext);
  };
}

// messages/streaming-markdown-cache.ts
import { Markdown as Markdown2 } from "@earendil-works/pi-tui";
var PATCHED5 = Symbol.for("pi-droid-styling.streaming-markdown-cache.patched");
var STATE_KEY = Symbol("streaming-markdown-cache-state");
var WRAPPED_KEY = Symbol("streaming-markdown-cache-wrapped");
var objectIds = /* @__PURE__ */ new WeakMap();
var nextObjectId = 1;
function getObjectId(value) {
  if (!value || typeof value !== "object") return String(value);
  let id = objectIds.get(value);
  if (!id) {
    id = nextObjectId++;
    objectIds.set(value, id);
  }
  return String(id);
}
function stableJson(value) {
  const seen = /* @__PURE__ */ new WeakSet();
  const normalize = (input) => {
    if (!input || typeof input !== "object") return input;
    if (seen.has(input)) return "<circular>";
    seen.add(input);
    if (Array.isArray(input)) return input.map(normalize);
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, normalize(input[key])]));
  };
  try {
    return JSON.stringify(normalize(value ?? null));
  } catch {
    return "<unserializable>";
  }
}
function getDefaultStyleFingerprint(style) {
  if (!style) return "none";
  return stableJson({
    bold: Boolean(style.bold),
    italic: Boolean(style.italic),
    strikethrough: Boolean(style.strikethrough),
    underline: Boolean(style.underline),
    color: typeof style.color === "function",
    bgColor: typeof style.bgColor === "function"
  });
}
function getConfigFingerprint(config) {
  return [
    `px:${config.paddingX}`,
    `py:${config.paddingY}`,
    `theme:${getObjectId(config.theme)}`,
    `style:${getDefaultStyleFingerprint(config.defaultTextStyle)}`,
    `options:${stableJson(config.options)}`
  ].join("|");
}
function isVisibleTextBlock2(contentBlock) {
  return contentBlock?.type === "text" && typeof contentBlock.text === "string" && contentBlock.text.trim().length > 0;
}
function isVisibleThinkingBlock2(contentBlock) {
  return contentBlock?.type === "thinking" && typeof contentBlock.thinking === "string" && contentBlock.thinking.trim().length > 0;
}
function hasVisibleAssistantContent2(contentBlocks) {
  return contentBlocks.some((contentBlock) => isVisibleTextBlock2(contentBlock) || isVisibleThinkingBlock2(contentBlock));
}
function isMarkdownChild(child) {
  return child instanceof Markdown2 || child && typeof child.render === "function" && typeof child.text === "string" && typeof child.paddingX === "number" && typeof child.paddingY === "number" && child.theme;
}
function getMarkdownConfig(child, text) {
  return {
    text,
    paddingX: typeof child.paddingX === "number" ? child.paddingX : 1,
    paddingY: typeof child.paddingY === "number" ? child.paddingY : 0,
    theme: child.theme,
    defaultTextStyle: child.defaultTextStyle,
    options: child.options
  };
}
function renderMarkdown(config, text, width) {
  return new Markdown2(
    text,
    config.paddingX,
    config.paddingY,
    config.theme,
    config.defaultTextStyle,
    config.options
  ).render(width);
}
function hasOpenFence(text) {
  let fence;
  for (const line of text.split("\n")) {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!match) continue;
    const marker = match[1];
    const markerChar = marker[0];
    if (!fence) {
      fence = marker;
    } else if (markerChar === fence[0] && marker.length >= fence.length) {
      fence = void 0;
    }
  }
  return Boolean(fence);
}
function getLastMarkdownBlock(prefix) {
  const blocks = prefix.trimEnd().split(/\n{2,}/);
  return blocks.at(-1) ?? "";
}
function isAmbiguousStableBlock(block) {
  const lines = block.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return true;
  if (lines.some((line) => /^ {4,}\S/.test(line))) return true;
  if (lines.some((line) => /^ {0,3}>/.test(line))) return true;
  if (lines.some((line) => /^ {0,3}(?:[-+*]|\d+[.)])\s+/.test(line))) return true;
  if (lines.some((line) => /^ {0,3}\[[^\]]+\]:/.test(line))) return true;
  if (lines.some((line) => /^ {0,3}<[A-Za-z][^>]*>?\s*$/.test(line))) return true;
  if (lines.some((line) => /\|/.test(line)) && lines.some((line) => /^ {0,3}\|?\s*:?-{3,}:?/.test(line))) return true;
  if (lines.some((line) => /^ {0,3}(?:=+|-+)\s*$/.test(line))) return true;
  return false;
}
function isSafeStablePrefix(prefix) {
  if (prefix.trim().length === 0) return false;
  if (hasOpenFence(prefix)) return false;
  return !isAmbiguousStableBlock(getLastMarkdownBlock(prefix));
}
function findStableMarkdownBoundary(text) {
  let boundary = -1;
  let searchFrom = 0;
  while (true) {
    const index = text.indexOf("\n\n", searchFrom);
    if (index === -1) break;
    const candidate = index + 2;
    const prefix = text.slice(0, candidate);
    if (isSafeStablePrefix(prefix)) boundary = candidate;
    searchFrom = candidate;
  }
  return boundary;
}
function resetStableState(state2, reason) {
  state2.stablePrefix = "";
  state2.stableLines = [];
  state2.stableWidth = void 0;
  profileCount("assistant.markdownStable.reset");
  profileCount(`assistant.markdownStable.reset.${reason}`);
}
var StableStreamingMarkdown = class {
  state;
  blockKey;
  config;
  constructor(state2, blockKey, config) {
    this.state = state2;
    this.blockKey = blockKey;
    this.config = config;
    this[WRAPPED_KEY] = true;
  }
  invalidate() {
    resetStableState(this.state, "invalidate");
  }
  render(width) {
    const start = profileNow();
    try {
      return this.renderCached(width);
    } finally {
      profileDuration("assistant.markdownStable.render.ms", start);
    }
  }
  renderCached(width) {
    profileCount("assistant.markdownStable.render");
    profileCount(`assistant.markdownStable.render.${this.blockKey}`);
    const text = this.config.text;
    const state2 = this.state;
    const configFingerprint = getConfigFingerprint(this.config);
    if (state2.configFingerprint !== void 0 && state2.configFingerprint !== configFingerprint) {
      resetStableState(state2, "config");
    }
    state2.configFingerprint = configFingerprint;
    if (state2.stableWidth !== void 0 && state2.stableWidth !== width) {
      resetStableState(state2, "width");
    }
    state2.stableWidth = width;
    if (state2.stablePrefix && !text.startsWith(state2.stablePrefix)) {
      resetStableState(state2, "nonPrefix");
    }
    const boundary = findStableMarkdownBoundary(text);
    if (boundary > state2.stablePrefix.length) {
      const previousLength = state2.stablePrefix.length;
      const stablePrefix = text.slice(0, boundary);
      const stableChunk = text.slice(previousLength, boundary);
      const promoteStart = profileNow();
      const chunkLines = renderMarkdown(this.config, stableChunk, width);
      profileDuration("assistant.markdownStable.promote.ms", promoteStart);
      state2.stableLines = previousLength > 0 ? [...state2.stableLines, ...chunkLines] : chunkLines;
      state2.stablePrefix = stablePrefix;
      profileCount("assistant.markdownStable.promote");
      profileSample("assistant.markdownStable.stableChars.count", stablePrefix.length);
      profileSample("assistant.markdownStable.promotedChars.count", stableChunk.length);
    }
    if (!state2.stablePrefix) {
      profileCount("assistant.markdownStable.fullFallback");
      state2.lastText = text;
      return renderMarkdown(this.config, text, width);
    }
    profileCount("assistant.markdownStable.hit");
    const tail = text.slice(state2.stablePrefix.length);
    profileSample("assistant.markdownStable.tailChars.count", tail.length);
    state2.lastText = text;
    if (tail.trim().length === 0) return state2.stableLines;
    return [...state2.stableLines, ...renderMarkdown(this.config, tail, width)];
  }
};
function getStableStates(component) {
  let states = component[STATE_KEY];
  if (!states) {
    states = /* @__PURE__ */ new Map();
    component[STATE_KEY] = states;
  }
  return states;
}
function getState3(states, blockKey) {
  let state2 = states.get(blockKey);
  if (!state2) {
    state2 = { stablePrefix: "", stableLines: [] };
    states.set(blockKey, state2);
  }
  return state2;
}
function replaceMarkdownChild(component, childIndex, blockKey, text, seen) {
  const children = component?.contentContainer?.children;
  const child = children?.[childIndex];
  if (!Array.isArray(children) || !isMarkdownChild(child)) return;
  seen.add(blockKey);
  const states = getStableStates(component);
  const state2 = getState3(states, blockKey);
  children[childIndex] = new StableStreamingMarkdown(state2, blockKey, getMarkdownConfig(child, text));
  profileCount("assistant.markdownStable.replaced");
}
function replaceStreamingMarkdownChildren(component, message) {
  if (!message || !Array.isArray(message.content)) return;
  const contentBlocks = message.content;
  const states = getStableStates(component);
  const seen = /* @__PURE__ */ new Set();
  const hasVisibleContent = hasVisibleAssistantContent2(contentBlocks);
  let childIndex = hasVisibleContent ? 1 : 0;
  for (let i = 0; i < contentBlocks.length; i++) {
    const contentBlock = contentBlocks[i];
    if (isVisibleTextBlock2(contentBlock)) {
      replaceMarkdownChild(component, childIndex, `${i}:text`, contentBlock.text.trim(), seen);
      childIndex += 1;
    } else if (isVisibleThinkingBlock2(contentBlock)) {
      if (!component?.hideThinkingBlock) {
        replaceMarkdownChild(component, childIndex, `${i}:thinking`, contentBlock.thinking.trim(), seen);
      }
      childIndex += 1;
      const hasVisibleContentAfter = contentBlocks.slice(i + 1).some((nextBlock) => isVisibleTextBlock2(nextBlock) || isVisibleThinkingBlock2(nextBlock));
      if (hasVisibleContentAfter) childIndex += 1;
    }
  }
  for (const key of states.keys()) {
    if (!seen.has(key)) states.delete(key);
  }
}
function installAssistantStreamingMarkdownCache(AssistantMessageClass) {
  const proto = AssistantMessageClass?.prototype;
  if (!proto || proto[PATCHED5]) return;
  proto[PATCHED5] = true;
  const baseUpdateContent = proto.updateContent;
  if (typeof baseUpdateContent !== "function") return;
  proto.updateContent = function patchedAssistantStreamingMarkdownCache(message) {
    baseUpdateContent.call(this, message);
    if (message?.stopReason !== void 0 && message?.stopReason !== null) {
      const states = this[STATE_KEY];
      states?.clear();
      profileCount("assistant.markdownStable.finalBypass");
      return;
    }
    replaceStreamingMarkdownChildren(this, message);
  };
}

// messages/user-prefix.ts
import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
var activeTheme3 = null;
var PATCHED6 = Symbol.for("pi-droid-styling.user-prefix.patched");
function usesLegacyQuotePrefix() {
  return getThemeExtra(activeTheme3, "quoteStyle") === "true" && getThemeExtra(activeTheme3, "userPrefix") === "\u2502";
}
function colorUserPrefix(text) {
  const color2 = usesLegacyQuotePrefix() ? "accent" : getThemeExtra(activeTheme3, "userPrefixColor");
  if (!activeTheme3 || !color2) return text;
  if (isHexColor(color2)) return fgHex(activeTheme3, color2, text);
  try {
    return typeof activeTheme3.fg === "function" ? activeTheme3.fg(color2, text) : text;
  } catch {
    return text;
  }
}
function buildPrefixSegment2() {
  const configuredChar = getThemeExtra(activeTheme3, "userPrefix");
  const char = usesLegacyQuotePrefix() ? "\u276F" : configuredChar;
  const prefix = colorUserPrefix(char);
  const design = getPresentationDesign();
  if (!design.stripsBackground && typeof activeTheme3?.bg === "function") {
    return activeTheme3.bg("userMessageBg", `${prefix}  `);
  }
  return `${prefix}${design.markerGap}`;
}
function buildDividerLine2(width) {
  if (width <= 0) return "";
  const char = getThemeExtra(activeTheme3, "dividerChar");
  const color2 = getThemeExtra(activeTheme3, "dividerColor");
  const line = char.repeat(width);
  return activeTheme3 ? fgHex(activeTheme3, color2, line) : line;
}
function stripBackgroundAnsi(text) {
  return text.replace(/\x1b\[(?:4[0-9]|10[0-7])(?:;[0-9;]*)?m/g, "");
}
function stripEmphasisAnsi(text) {
  return text.replace(/\x1b\[(?:(?:1|3|22|23);)*(?:1|3|22|23)m/g, "");
}
function buildContinuationSegment() {
  const char = getThemeExtra(activeTheme3, "quoteChar") || "\u2506";
  const prefix = colorUserPrefix(char);
  const design = getPresentationDesign();
  if (!design.stripsBackground && typeof activeTheme3?.bg === "function") {
    return activeTheme3.bg("userMessageBg", `${prefix}  `);
  }
  return `${prefix}${design.markerGap}`;
}
function alignContinuationLines2(lines, targetIndex) {
  const continuationSegment = buildContinuationSegment();
  for (let i = targetIndex + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const clean = stripAnsi(line);
    if (clean.trim().length === 0) {
      lines[i] = continuationSegment.trimEnd();
      continue;
    }
    lines[i] = `${continuationSegment}${dropLeadingColumns(line, 1)}`;
  }
}
function installUserMessagePrefix(theme) {
  activeTheme3 = theme;
  const proto = UserMessageComponent.prototype;
  if (proto[PATCHED6] || proto.render?.name === "patchedUserMessageRender") {
    proto[PATCHED6] = true;
    return;
  }
  proto[PATCHED6] = true;
  const baseRender = proto.render;
  proto.render = function patchedUserMessageRender(width) {
    const lines = baseRender.call(this, width);
    if (lines.length === 0 || width <= 0) return lines;
    let first = 0;
    while (first < lines.length && stripAnsi(lines[first] ?? "").trim() === "") first++;
    let last = lines.length - 1;
    while (last > first && stripAnsi(lines[last] ?? "").trim() === "") last--;
    const trimmed = lines.slice(first, last + 1);
    if (trimmed.length === 0) return lines;
    const output = [...trimmed];
    const design = getPresentationDesign();
    let targetIndex = 0;
    for (let i = 0; i < output.length; i++) {
      const clean = stripAnsi(output[i] ?? "");
      if (clean.trim().length > 0) {
        targetIndex = i;
        break;
      }
    }
    const prefixSegment = buildPrefixSegment2();
    const line = output[targetIndex] ?? "";
    const presentationLine = design.stripsBackground ? stripBackgroundAnsi(line) : line;
    const remainder = stripEmphasisAnsi(dropLeadingColumns(presentationLine, 1));
    output[targetIndex] = `${prefixSegment}${remainder}`;
    alignContinuationLines2(output, targetIndex);
    const result = output.map((renderedLine) => {
      const presentationLine2 = design.stripsBackground ? stripBackgroundAnsi(renderedLine) : renderedLine;
      const plainLine = stripEmphasisAnsi(presentationLine2);
      return safeVisibleWidth(plainLine) > width ? safeTruncateToWidth(plainLine, width, "") : plainLine;
    });
    if (design.compactLayout) return [...result, ""];
    const divider = buildDividerLine2(width);
    const showDivider = getThemeExtra(activeTheme3, "showDivider") !== "false";
    return showDivider ? [divider, "", ...result, ""] : ["", ...result, ""];
  };
}

// messages/core-message-blocks.ts
import { Markdown as Markdown3 } from "@earendil-works/pi-tui";

// messages/boxed-message-block.ts
function formatMessageBlockTitle(theme, kind, title, icon = "\u2794") {
  const rawTitle = title ? `${icon} ${kind} | ${title}` : `${icon} ${kind}`;
  const coloredTitle = theme.fg("accent", rawTitle);
  return typeof theme?.bold === "function" ? theme.bold(coloredTitle) : coloredTitle;
}
function renderBoxedMessageBlock(theme, options) {
  const {
    kind,
    title,
    right,
    body,
    icon = "\u2794",
    hasDivider = true,
    cache: shouldCache = true
  } = options;
  let cache = null;
  return {
    invalidate() {
      cache = null;
    },
    render(width) {
      if (shouldCache && cache?.width === width) return cache.lines;
      const renderedWidth = boxWidth(width);
      const contentWidth = boxInnerWidth(renderedWidth);
      const titleLine = formatMessageBlockTitle(theme, kind, title, icon);
      const lines = [];
      lines.push(boxBorder(theme, "\u250C", "\u2510", renderedWidth));
      if (right) {
        const rightStyled = theme.fg("dim", right);
        lines.push(boxLineWithRight(theme, titleLine, rightStyled, renderedWidth));
      } else {
        lines.push(boxLine(theme, titleLine, renderedWidth));
      }
      const bodyLines = body(contentWidth);
      const showDivider = hasDivider === "auto" ? bodyLines.length > 0 : hasDivider;
      if (showDivider) {
        lines.push(boxInsetDivider(theme, renderedWidth));
      }
      for (const line of bodyLines) {
        lines.push(boxLine(theme, line, renderedWidth));
      }
      lines.push(boxBorder(theme, "\u2514", "\u2518", renderedWidth));
      if (shouldCache) cache = { width, lines };
      return lines;
    }
  };
}

// messages/core-message-blocks.ts
var PATCH_FLAG = "__droidCoreMessageBlocksPatched__";
var cachedTheme = null;
function setCoreMessageBlockTheme(theme) {
  cachedTheme = theme;
  setFullTheme(theme);
}
function installCoreMessageBlockStyling(ctors) {
  const globalState = globalThis;
  if (globalState[PATCH_FLAG]) return;
  globalState[PATCH_FLAG] = true;
  patchCompaction(ctors.CompactionSummaryMessageComponent);
  patchSkill(ctors.SkillInvocationMessageComponent);
  patchBranch(ctors.BranchSummaryMessageComponent);
  patchCustomMessage(ctors.CustomMessageComponent);
}
function setMessageBlockBackground(component, theme) {
  if (typeof component?.setBgFn !== "function") return;
  component.setBgFn((text) => boxBg(theme, text, "customMessageBg"));
}
function withMessageBlockBackground(component, theme) {
  return {
    invalidate() {
      if (typeof component?.invalidate === "function") component.invalidate();
    },
    render(width) {
      return boxBgLines(theme, component.render(width), "customMessageBg");
    }
  };
}
function attachCustomMessageBlock(instance, theme, block) {
  if (instance.box && typeof instance.box.clear === "function" && typeof instance.box.addChild === "function") {
    setMessageBlockBackground(instance.box, theme);
    instance.addChild(instance.box);
    instance.box.clear();
    instance.box.addChild(block);
  } else {
    instance.customComponent = withMessageBlockBackground(block, theme);
    instance.addChild(instance.customComponent);
  }
}
function createMarkdownBody(text, markdownTheme, theme) {
  const md = new Markdown3(text || "", 0, 0, markdownTheme, {
    color: (t) => theme.fg("customMessageText", t)
  });
  return (contentWidth) => md.render(contentWidth);
}
function patchCompaction(ctor) {
  const proto = ctor?.prototype;
  if (!proto || typeof proto.updateDisplay !== "function") return;
  const base = proto.updateDisplay;
  proto.updateDisplay = function patchedCompactionUpdateDisplay() {
    const theme = cachedTheme;
    if (!theme || this.message == null) return base.call(this);
    const tokensBefore = this.message.tokensBefore;
    if (tokensBefore == null) return base.call(this);
    setMessageBlockBackground(this, theme);
    this.clear();
    const expanded = Boolean(this.expanded);
    const summary = typeof this.message.summary === "string" ? this.message.summary : "";
    const markdownTheme = this.markdownTheme;
    const body = expanded && summary && markdownTheme ? createMarkdownBody(summary, markdownTheme, theme) : () => [];
    const tokenStr = tokensBefore.toLocaleString();
    try {
      const block = renderBoxedMessageBlock(theme, {
        kind: "Compaction",
        title: `${tokenStr} tokens`,
        right: expanded ? void 0 : "(Ctrl+O to expand)",
        body,
        icon: "\u229F",
        hasDivider: expanded
      });
      this.addChild(block);
    } catch {
      return base.call(this);
    }
  };
}
function patchSkill(ctor) {
  const proto = ctor?.prototype;
  if (!proto || typeof proto.updateDisplay !== "function") return;
  const base = proto.updateDisplay;
  proto.updateDisplay = function patchedSkillUpdateDisplay() {
    const theme = cachedTheme;
    if (!theme || this.skillBlock == null) return base.call(this);
    const skillName = this.skillBlock.name;
    if (!skillName) return base.call(this);
    setMessageBlockBackground(this, theme);
    this.clear();
    const expanded = Boolean(this.expanded);
    const content = typeof this.skillBlock.content === "string" ? this.skillBlock.content : "";
    const markdownTheme = this.markdownTheme;
    const body = expanded && content && markdownTheme ? createMarkdownBody(content, markdownTheme, theme) : () => [];
    try {
      const block = renderBoxedMessageBlock(theme, {
        kind: "Skill",
        title: skillName,
        right: expanded ? void 0 : "(Ctrl+O to expand)",
        body,
        icon: "\u229F",
        hasDivider: expanded
      });
      this.addChild(block);
    } catch {
      return base.call(this);
    }
  };
}
function patchBranch(ctor) {
  const proto = ctor?.prototype;
  if (!proto || typeof proto.updateDisplay !== "function") return;
  const base = proto.updateDisplay;
  proto.updateDisplay = function patchedBranchUpdateDisplay() {
    const theme = cachedTheme;
    if (!theme || this.message == null) return base.call(this);
    setMessageBlockBackground(this, theme);
    this.clear();
    const expanded = Boolean(this.expanded);
    const summary = typeof this.message?.summary === "string" ? this.message.summary : "";
    const markdownTheme = this.markdownTheme;
    const body = expanded && summary && markdownTheme ? createMarkdownBody(summary, markdownTheme, theme) : () => [];
    try {
      const block = renderBoxedMessageBlock(theme, {
        kind: "Branch",
        right: expanded ? void 0 : "(Ctrl+O to expand)",
        body,
        icon: "\u229F",
        hasDivider: expanded
      });
      this.addChild(block);
    } catch {
      return base.call(this);
    }
  };
}
function patchCustomMessage(ctor) {
  const proto = ctor?.prototype;
  if (!proto || typeof proto.rebuild !== "function") return;
  const base = proto.rebuild;
  proto.rebuild = function patchedCustomMessageRebuild() {
    if (this.customComponent) {
      this.removeChild(this.customComponent);
      this.customComponent = void 0;
    }
    this.removeChild(this.box);
    const theme = cachedTheme;
    if (!theme) return base.call(this);
    const customType = this.message?.customType || "Custom";
    if (this.customRenderer) {
      try {
        const component = this.customRenderer(this.message, { expanded: this._expanded }, theme);
        if (component && typeof component.render === "function") {
          const block = renderBoxedMessageBlock(theme, {
            kind: "Custom",
            title: customType,
            body: (contentWidth) => component.render(contentWidth),
            icon: "\u229F",
            hasDivider: "auto",
            cache: false
          });
          attachCustomMessageBlock(this, theme, block);
          return;
        }
      } catch {
      }
    }
    let text;
    if (typeof this.message.content === "string") {
      text = this.message.content;
    } else if (Array.isArray(this.message.content)) {
      text = this.message.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    } else {
      text = "";
    }
    const markdownTheme = this.markdownTheme;
    const body = text && markdownTheme ? createMarkdownBody(text, markdownTheme, theme) : () => [];
    try {
      const block = renderBoxedMessageBlock(theme, {
        kind: "Custom",
        title: customType,
        body,
        icon: "\u229F",
        hasDivider: Boolean(text)
      });
      attachCustomMessageBlock(this, theme, block);
    } catch {
      return base.call(this);
    }
  };
}

// performance/debounce-update.ts
var PATCHED7 = Symbol.for("pi-droid-styling.debounce-update-content.patched");
var STREAM_FLUSH_MS = 33;
var TARGET_CATCHUP_FRAMES = 8;
var MIN_REVEAL_CHARS = 12;
var MAX_REVEAL_CHARS = 120;
var TIMER_KEY = Symbol("presentation-timer");
var SOURCE_KEY = Symbol("presentation-source");
var DISPLAYED_LENGTHS_KEY = Symbol("presentation-displayed-lengths");
var LAST_SOURCE_TEXTS_KEY = Symbol("presentation-last-source-texts");
var LAST_PRESENTATION_AT_KEY = Symbol("presentation-last-at");
var LAST_PRESENTATION_CHARS_KEY = Symbol("presentation-last-chars");
var REQUESTER_GENERATION_KEY = Symbol("presentation-requester-generation");
var requestRender;
var requestRenderGeneration = 0;
var Segmenter = Intl.Segmenter;
var graphemeSegmenter = typeof Segmenter === "function" ? new Segmenter(void 0, { granularity: "grapheme" }) : void 0;
function setAssistantUpdateRenderRequester(requester) {
  requestRender = requester;
  requestRenderGeneration++;
}
function getGraphemes(text) {
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(text), (part) => String(part.segment));
  }
  return Array.from(text);
}
function countGraphemes(text) {
  return getGraphemes(text).length;
}
function sliceGraphemes(text, length) {
  if (length <= 0) return "";
  const graphemes = getGraphemes(text);
  if (length >= graphemes.length) return text;
  return graphemes.slice(0, length).join("");
}
function collectTextEntries(message) {
  const content = message?.content;
  if (Array.isArray(content)) {
    const entries = [];
    for (let index = 0; index < content.length; index++) {
      const block = content[index];
      if (typeof block?.text === "string") entries.push({ key: `content:${index}:text`, text: block.text });
      if (typeof block?.thinking === "string") entries.push({ key: `content:${index}:thinking`, text: block.thinking });
    }
    return entries;
  }
  return typeof message?.text === "string" ? [{ key: "message:text", text: message.text }] : [];
}
function getDisplayedLengths(component) {
  let lengths = component[DISPLAYED_LENGTHS_KEY];
  if (!lengths) {
    lengths = /* @__PURE__ */ new Map();
    component[DISPLAYED_LENGTHS_KEY] = lengths;
  }
  return lengths;
}
function clearPresentationState(component) {
  const timer = component[TIMER_KEY];
  if (timer) {
    clearTimeout(timer);
    profileCount("assistant.updateContent.cancelPending");
  }
  component[TIMER_KEY] = null;
  component[SOURCE_KEY] = null;
  component[DISPLAYED_LENGTHS_KEY]?.clear();
  component[LAST_SOURCE_TEXTS_KEY]?.clear();
}
function updateSourceState(component, message) {
  const entries = collectTextEntries(message);
  const current = new Map(entries.map((entry) => [entry.key, entry.text]));
  let previous = component[LAST_SOURCE_TEXTS_KEY];
  const lengths = getDisplayedLengths(component);
  if (!previous) {
    previous = /* @__PURE__ */ new Map();
    component[LAST_SOURCE_TEXTS_KEY] = previous;
  }
  for (const [key, text] of current) {
    const previousText = previous.get(key);
    if (previousText === void 0) {
      lengths.set(key, 0);
    } else if (!text.startsWith(previousText)) {
      lengths.set(key, 0);
      profileCount("assistant.updateContent.presentation.reset");
    }
  }
  for (const key of Array.from(lengths.keys())) {
    if (!current.has(key)) lengths.delete(key);
  }
  component[LAST_SOURCE_TEXTS_KEY] = current;
}
function countAssistantMessageChars(message) {
  let chars = 0;
  for (const entry of collectTextEntries(message)) chars += countGraphemes(entry.text);
  return chars;
}
function countDisplayedChars(component) {
  let chars = 0;
  const lengths = getDisplayedLengths(component);
  for (const entry of collectTextEntries(component[SOURCE_KEY])) {
    chars += Math.min(lengths.get(entry.key) ?? 0, countGraphemes(entry.text));
  }
  return chars;
}
function computeBacklog(component) {
  return Math.max(0, countAssistantMessageChars(component[SOURCE_KEY]) - countDisplayedChars(component));
}
function computeRevealChars(backlog) {
  if (backlog <= 0) return 0;
  const catchup = Math.ceil(backlog / TARGET_CATCHUP_FRAMES);
  return Math.min(backlog, Math.max(MIN_REVEAL_CHARS, Math.min(MAX_REVEAL_CHARS, catchup)));
}
function revealNextChunk(component, revealChars) {
  let remaining = revealChars;
  let revealed = 0;
  const lengths = getDisplayedLengths(component);
  for (const entry of collectTextEntries(component[SOURCE_KEY])) {
    if (remaining <= 0) break;
    const sourceLength = countGraphemes(entry.text);
    const currentLength = Math.min(lengths.get(entry.key) ?? 0, sourceLength);
    const available = sourceLength - currentLength;
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    lengths.set(entry.key, currentLength + take);
    remaining -= take;
    revealed += take;
  }
  return revealed;
}
function cloneDisplayedMessage(message, displayedLengths) {
  if (!message || typeof message !== "object") return message;
  const clone = { ...message };
  const content = message.content;
  if (Array.isArray(content)) {
    clone.content = content.map((block, index) => {
      if (!block || typeof block !== "object") return block;
      const blockClone = { ...block };
      const textKey = `content:${index}:text`;
      const thinkingKey = `content:${index}:thinking`;
      if (typeof block.text === "string") {
        blockClone.text = sliceGraphemes(block.text, displayedLengths.get(textKey) ?? 0);
      }
      if (typeof block.thinking === "string") {
        blockClone.thinking = sliceGraphemes(block.thinking, displayedLengths.get(thinkingKey) ?? 0);
      }
      return blockClone;
    });
  } else if (typeof message.text === "string") {
    clone.text = sliceGraphemes(message.text, displayedLengths.get("message:text") ?? 0);
  }
  return clone;
}
function recordPresentationMetrics(component, message, mode) {
  const now = profileNow();
  if (now <= 0) return;
  profileCount(`assistant.updateContent.presentation.${mode}`);
  const previousAt = component[LAST_PRESENTATION_AT_KEY];
  if (typeof previousAt === "number" && previousAt > 0) {
    profileSample("assistant.updateContent.presentation.interval.ms", now - previousAt);
  }
  component[LAST_PRESENTATION_AT_KEY] = now;
  const chars = countAssistantMessageChars(message);
  profileSample("assistant.updateContent.presentation.chars.count", chars);
  const previousChars = component[LAST_PRESENTATION_CHARS_KEY];
  if (typeof previousChars === "number") {
    if (chars >= previousChars) {
      profileSample("assistant.updateContent.presentation.deltaChars.count", chars - previousChars);
    } else {
      profileCount("assistant.updateContent.presentation.charResets");
      profileSample("assistant.updateContent.presentation.deltaChars.count", chars);
    }
  } else {
    profileSample("assistant.updateContent.presentation.deltaChars.count", chars);
  }
  component[LAST_PRESENTATION_CHARS_KEY] = chars;
}
function markRequesterGeneration(component) {
  component[REQUESTER_GENERATION_KEY] = requestRenderGeneration;
}
function isRequesterGenerationCurrent(component) {
  return component[REQUESTER_GENERATION_KEY] === requestRenderGeneration;
}
function requestPresentationRender(component) {
  if (!requestRender || !isRequesterGenerationCurrent(component)) return;
  try {
    requestRender();
    profileCount("assistant.updateContent.presentation.requestRender");
  } catch {
    profileCount("assistant.updateContent.presentation.requestRenderError");
  }
}
function installAssistantUpdateDebounce(AssistantMessageClass) {
  const proto = AssistantMessageClass?.prototype;
  if (!proto || proto[PATCHED7]) return;
  proto[PATCHED7] = true;
  const orig = proto.updateContent;
  if (typeof orig !== "function") return;
  function scheduleTick(component) {
    if (component[TIMER_KEY]) return;
    profileCount("assistant.updateContent.scheduled");
    component[TIMER_KEY] = setTimeout(() => {
      component[TIMER_KEY] = null;
      const source = component[SOURCE_KEY];
      if (!source) return;
      if (!isRequesterGenerationCurrent(component)) {
        clearPresentationState(component);
        profileCount("assistant.updateContent.presentation.staleRequester");
        return;
      }
      const backlogBefore = computeBacklog(component);
      profileSample("assistant.updateContent.presentation.backlogChars.count", backlogBefore);
      if (backlogBefore <= 0) return;
      const revealed = revealNextChunk(component, computeRevealChars(backlogBefore));
      if (revealed <= 0) return;
      profileCount("assistant.updateContent.flush");
      profileCount("assistant.updateContent.presentation.tick");
      profileSample("assistant.updateContent.presentation.revealedChars.count", revealed);
      const displayed = cloneDisplayedMessage(source, getDisplayedLengths(component));
      recordPresentationMetrics(component, displayed, "flush");
      const start = profileNow();
      try {
        orig.call(component, displayed);
        if (component?.lastMessage === displayed) component.lastMessage = source;
        requestPresentationRender(component);
      } finally {
        profileDuration("assistant.updateContent.ms", start);
      }
      const backlogAfter = computeBacklog(component);
      profileSample("assistant.updateContent.presentation.backlogAfterChars.count", backlogAfter);
      if (backlogAfter > 0) {
        scheduleTick(component);
      } else {
        profileCount("assistant.updateContent.presentation.drainComplete");
      }
    }, STREAM_FLUSH_MS);
  }
  proto.updateContent = function patchedUpdateContent(message) {
    profileCount("assistant.updateContent.calls");
    const stopReason = message?.stopReason;
    if (stopReason !== void 0 && stopReason !== null) {
      profileCount("assistant.updateContent.final");
      clearPresentationState(this);
      recordPresentationMetrics(this, message, "immediate");
      const start = profileNow();
      try {
        return orig.call(this, message);
      } finally {
        profileDuration("assistant.updateContent.ms", start);
      }
    }
    profileCount("assistant.updateContent.streaming");
    if (this[TIMER_KEY]) profileCount("assistant.updateContent.coalesced");
    this[SOURCE_KEY] = message;
    markRequesterGeneration(this);
    updateSourceState(this, message);
    scheduleTick(this);
  };
}

// performance/debounce-tool-updates.ts
var PATCHED8 = Symbol.for("pi-droid-styling.debounce-tool-updates.patched");
var TOOL_PARTIAL_FLUSH_MS = 80;
var TIMER_KEY2 = Symbol("tool-update-timer");
var PENDING_KEY = Symbol("tool-update-pending");
function installToolExecutionUpdateDebounce(ToolExecutionClass) {
  const proto = ToolExecutionClass?.prototype;
  if (!proto || proto[PATCHED8]) return;
  proto[PATCHED8] = true;
  const orig = proto.updateResult;
  if (typeof orig !== "function") return;
  proto.updateResult = function patchedUpdateResult(result, isPartial = false) {
    profileCount("tool.updateResult.calls");
    if (!isPartial) {
      profileCount("tool.updateResult.final");
      const t = this[TIMER_KEY2];
      if (t) {
        clearTimeout(t);
        this[TIMER_KEY2] = null;
        profileCount("tool.updateResult.cancelPending");
      }
      this[PENDING_KEY] = null;
      const start = profileNow();
      try {
        return orig.call(this, result, false);
      } finally {
        profileDuration("tool.updateResult.ms", start);
      }
    }
    profileCount("tool.updateResult.partial");
    this[PENDING_KEY] = result;
    if (this[TIMER_KEY2]) {
      profileCount("tool.updateResult.coalesced");
      return;
    }
    profileCount("tool.updateResult.scheduled");
    this[TIMER_KEY2] = setTimeout(() => {
      this[TIMER_KEY2] = null;
      const pending = this[PENDING_KEY];
      this[PENDING_KEY] = null;
      if (!pending) return;
      profileCount("tool.updateResult.flush");
      const start = profileNow();
      try {
        orig.call(this, pending, true);
      } finally {
        profileDuration("tool.updateResult.ms", start);
      }
      try {
        this.ui?.requestRender?.();
        profileCount("tool.updateResult.flushRequestRender");
      } catch {
      }
    }, TOOL_PARTIAL_FLUSH_MS);
  };
}

// performance/finished-render-cache.ts
var ASSISTANT_PATCHED = Symbol.for("pi-droid-styling.finished-render-cache.assistant.patched");
var TOOL_PATCHED = Symbol.for("pi-droid-styling.finished-render-cache.tool.patched");
var CACHE_KEY = Symbol("finished-render-cache");
var SIGNATURE_KEY = Symbol("finished-render-signature");
var objectIds2 = /* @__PURE__ */ new WeakMap();
var nextObjectId2 = 1;
function getObjectId2(value) {
  if (!value || typeof value !== "object") return String(value);
  let id = objectIds2.get(value);
  if (!id) {
    id = nextObjectId2++;
    objectIds2.set(value, id);
  }
  return String(id);
}
function clearFinishedRenderCache(component, kind, reason) {
  if (!component || typeof component !== "object") return;
  if (component[CACHE_KEY]) {
    profileCount(`finishedRender.${kind}.invalidated`);
    profileCount(`finishedRender.${kind}.invalidated.${reason}`);
  }
  component[CACHE_KEY] = void 0;
  component[SIGNATURE_KEY] = void 0;
}
function wrapInvalidator(proto, methodName, kind) {
  const base = proto?.[methodName];
  if (typeof base !== "function") return;
  proto[methodName] = function patchedFinishedRenderInvalidator(...args) {
    clearFinishedRenderCache(this, kind, methodName);
    return base.apply(this, args);
  };
}
function wrapRenderCache(proto, kind, getFinishedKey) {
  const baseRender = proto?.render;
  if (typeof baseRender !== "function") return;
  proto.render = function patchedFinishedRenderCache(width) {
    const key = getFinishedKey(this);
    if (!key) {
      profileCount(`finishedRender.${kind}.bypass`);
      return baseRender.call(this, width);
    }
    const cache = this[CACHE_KEY];
    if (cache && cache.width === width && cache.key === key) {
      profileCount(`finishedRender.${kind}.hit`);
      profileSample(`finishedRender.${kind}.lines.count`, cache.lines.length);
      return cache.lines;
    }
    profileCount(`finishedRender.${kind}.miss`);
    const start = profileNow();
    const lines = baseRender.call(this, width);
    profileDuration(`finishedRender.${kind}.render.ms`, start);
    this[CACHE_KEY] = { width, key, lines };
    profileSample(`finishedRender.${kind}.lines.count`, lines.length);
    return lines;
  };
}
function getCachedSignature(component, source, build) {
  const cached2 = component[SIGNATURE_KEY];
  if (cached2 && cached2.source === source) return cached2.signature;
  const signature = build();
  component[SIGNATURE_KEY] = { source, signature };
  return signature;
}
function getAssistantFinishedKey(component) {
  const message = component?.lastMessage;
  if (!message || message.stopReason === void 0 || message.stopReason === null) return void 0;
  const signature = getCachedSignature(component, message, () => [
    "assistant",
    getObjectId2(message),
    String(message.stopReason ?? ""),
    String(message.errorMessage ?? ""),
    `hide:${Boolean(component.hideThinkingBlock)}`,
    `label:${String(component.hiddenThinkingLabel ?? "")}`,
    `theme:${getObjectId2(component.markdownTheme)}`,
    `toolCalls:${Boolean(component.hasToolCalls)}`
  ].join("|"));
  return signature;
}
function getToolFinishedKey(component) {
  if (!component?.result || component.isPartial) return void 0;
  const result = component.result;
  if (Array.isArray(result.content) && result.content.some((block) => block?.type === "image")) return void 0;
  if (Array.isArray(component.imageComponents) && component.imageComponents.length > 0) return void 0;
  const convertedImages = component.convertedImages instanceof Map ? component.convertedImages.size : 0;
  const signature = getCachedSignature(component, result, () => [
    "tool",
    String(component.toolName ?? ""),
    String(component.toolCallId ?? ""),
    `args:${getObjectId2(component.args)}`,
    `result:${getObjectId2(result)}`,
    `expanded:${Boolean(component.expanded)}`,
    `showImages:${Boolean(component.showImages)}`,
    `imageWidth:${Number(component.imageWidthCells ?? 0)}`,
    `converted:${convertedImages}`,
    `hidden:${Boolean(component.hideComponent)}`
  ].join("|"));
  return signature;
}
function installFinishedRenderCache(AssistantMessageClass, ToolExecutionClass) {
  const assistantProto = AssistantMessageClass?.prototype;
  if (assistantProto && !assistantProto[ASSISTANT_PATCHED]) {
    assistantProto[ASSISTANT_PATCHED] = true;
    wrapInvalidator(assistantProto, "updateContent", "assistant");
    wrapInvalidator(assistantProto, "invalidate", "assistant");
    wrapInvalidator(assistantProto, "setHideThinkingBlock", "assistant");
    wrapInvalidator(assistantProto, "setHiddenThinkingLabel", "assistant");
    wrapRenderCache(assistantProto, "assistant", getAssistantFinishedKey);
  }
  const toolProto = ToolExecutionClass?.prototype;
  if (toolProto && !toolProto[TOOL_PATCHED]) {
    toolProto[TOOL_PATCHED] = true;
    wrapInvalidator(toolProto, "updateArgs", "tool");
    wrapInvalidator(toolProto, "markExecutionStarted", "tool");
    wrapInvalidator(toolProto, "setArgsComplete", "tool");
    wrapInvalidator(toolProto, "updateResult", "tool");
    wrapInvalidator(toolProto, "updateDisplay", "tool");
    wrapInvalidator(toolProto, "setExpanded", "tool");
    wrapInvalidator(toolProto, "setShowImages", "tool");
    wrapInvalidator(toolProto, "setImageWidthCells", "tool");
    wrapInvalidator(toolProto, "invalidate", "tool");
    wrapRenderCache(toolProto, "tool", getToolFinishedKey);
  }
}

// performance/render-autowrap-guard.ts
var PATCHED9 = Symbol.for("pi-droid-styling.render-autowrap-guard.patched");
var DISABLE_AUTOWRAP = "\x1B[?7l";
var ENABLE_AUTOWRAP = "\x1B[?7h";
function installRenderAutowrapGuard(tui) {
  if (!tui || tui[PATCHED9] || typeof tui.doRender !== "function") return;
  if (process.env.PI_DROID_RENDER_AUTOWRAP_GUARD !== "1") return;
  const originalDoRender = getOriginalTuiMethod(tui, "doRender");
  const terminal = tui.terminal;
  const write = typeof terminal?.write === "function" ? terminal.write.bind(terminal) : void 0;
  if (!write) return;
  tui[PATCHED9] = true;
  const guardedDoRender = function guardedDoRender2(...args) {
    write(DISABLE_AUTOWRAP);
    try {
      return originalDoRender.call(this, ...args);
    } finally {
      write(ENABLE_AUTOWRAP);
    }
  };
  tui.doRender = guardedDoRender;
  rememberTuiMethodWrapper(tui, "doRender", guardedDoRender);
}

// theme/frame-background.ts
import { appendFileSync as appendFileSync3, mkdirSync as mkdirSync3 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { dirname as dirname3, join as join7 } from "node:path";
var KITTY_IMAGE_PREFIX2 = "\x1B_G";
var ITERM2_IMAGE_PREFIX2 = "\x1B]1337;File=";
function isImageRenderLine2(line) {
  return line.includes(KITTY_IMAGE_PREFIX2) || line.includes(ITERM2_IMAGE_PREFIX2);
}
function resolveFrameBackgroundAnsi(theme) {
  const pageBg = getThemePageBackground(theme);
  const result = pageBg ? bgHexAnsi(theme, pageBg) : "";
  if (isFrameBackgroundDebugEnabled()) {
    writeFrameBackgroundDebug({
      type: "resolve",
      pid: process.pid,
      at: (/* @__PURE__ */ new Date()).toISOString(),
      themeName: typeof theme?.name === "string" ? theme.name : "",
      sourcePath: typeof theme?.sourcePath === "string" ? theme.sourcePath : "",
      colorMode: readThemeColorMode(theme),
      pageBg,
      result
    });
  }
  return result;
}
function readThemeColorMode(theme) {
  try {
    return typeof theme?.getColorMode === "function" ? String(theme.getColorMode() ?? "") : "";
  } catch {
    return "";
  }
}
function isFrameBackgroundDebugEnabled() {
  return process.env.PI_DROID_DEBUG_FRAME_BG === "1" || Boolean(process.env.PI_DROID_DEBUG_FRAME_BG_LOG);
}
function frameBackgroundDebugLogPath() {
  const explicitPath = process.env.PI_DROID_DEBUG_FRAME_BG_LOG;
  if (explicitPath) return explicitPath;
  const debugDir = process.env.PI_DROID_RENDER_DEBUG_DIR || join7(tmpdir2(), "pi-droid-render-debug");
  return join7(debugDir, `frame-bg-${process.pid}.jsonl`);
}
function writeFrameBackgroundDebug(value) {
  if (!isFrameBackgroundDebugEnabled()) return;
  try {
    const path = frameBackgroundDebugLogPath();
    mkdirSync3(dirname3(path), { recursive: true });
    appendFileSync3(path, `${JSON.stringify(value)}
`, "utf8");
  } catch {
  }
}
function paintFrameBackgroundLine(line, bgAnsi, targetWidth = 0) {
  const text = String(line);
  if (!bgAnsi || isImageRenderLine2(text)) return text;
  const body = keepAnsiBackgroundAcrossResets(text, bgAnsi);
  const width = Number.isFinite(targetWidth) ? Math.max(0, Math.floor(targetWidth)) : 0;
  const fill = width > 0 ? " ".repeat(Math.max(0, width - safeVisibleWidth(body))) : "";
  return `${bgAnsi}${ERASE_LINE}${body}${bgAnsi}${fill}${RESET_BACKGROUND}`;
}
function paintFrameBackgroundClears(text, bgAnsi) {
  return bgAnsi ? String(text).replace(/\x1b\[2K/g, `${bgAnsi}${ERASE_LINE}`) : String(text);
}
function paintFrameBackgroundLines(lines, bgAnsi, targetWidth = 0) {
  return lines.map((line) => paintFrameBackgroundLine(line, bgAnsi, targetWidth));
}
function padFrameRows(lines, minRows) {
  const frameLines = lines.map((line) => String(line));
  while (frameLines.length < minRows) frameLines.push("");
  return frameLines;
}

// performance/render-frame-background.ts
var PATCHED10 = Symbol.for("pi-droid-styling.render-frame-background.patched");
var WRITE_PATCHED = Symbol.for("pi-droid-styling.render-frame-background.write-patched");
function readRows(tui) {
  const rows = tui.terminal?.rows;
  return typeof rows === "number" && Number.isFinite(rows) ? Math.max(1, Math.floor(rows)) : 0;
}
function readColumns(tui) {
  const columns = tui.terminal?.columns;
  return typeof columns === "number" && Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 0;
}
function installFrameBackgroundClearWriter(tui, theme) {
  const terminal = tui.terminal;
  if (!terminal || typeof terminal.write !== "function") return;
  const existingPatch = terminal[WRITE_PATCHED];
  if (existingPatch && terminal.write === existingPatch.wrapper) {
    existingPatch.theme = theme;
    return;
  }
  const originalWrite = terminal.write.bind(terminal);
  const patch = {
    theme,
    wrapper(data) {
      const text = String(data);
      const bgAnsi = resolveFrameBackgroundAnsi(patch.theme);
      return originalWrite(bgAnsi ? paintFrameBackgroundClears(text, bgAnsi) : text);
    }
  };
  terminal[WRITE_PATCHED] = patch;
  terminal.write = patch.wrapper;
}
function installRenderFrameBackground(tui, theme) {
  if (process.env.PI_DROID_RENDER_FRAME_BG === "0") return;
  if (!tui || typeof tui.applyLineResets !== "function") return;
  installFrameBackgroundClearWriter(tui, theme);
  const existingPatch = tui[PATCHED10];
  if (existingPatch && typeof existingPatch === "object" && tui.applyLineResets === existingPatch.wrapper) {
    existingPatch.theme = theme;
    return;
  }
  if (typeof existingPatch === "function" && tui.applyLineResets === existingPatch) return;
  if (existingPatch === true && tui.applyLineResets.name === "droidFrameBackgroundApplyLineResets") return;
  const originalApplyLineResets = getOriginalTuiMethod(tui, "applyLineResets");
  const patch = {
    theme,
    wrapper: function droidFrameBackgroundApplyLineResets(lines) {
      const bgAnsi = resolveFrameBackgroundAnsi(patch.theme);
      if (!bgAnsi) return originalApplyLineResets.call(this, lines);
      const frameLines = padFrameRows(lines, readRows(this));
      const resetLines = originalApplyLineResets.call(this, frameLines);
      profileCount("render.frameBackground.row", resetLines.length);
      return paintFrameBackgroundLines(resetLines, bgAnsi, readColumns(this));
    }
  };
  tui[PATCHED10] = patch;
  tui.applyLineResets = patch.wrapper;
  rememberTuiMethodWrapper(tui, "applyLineResets", patch.wrapper);
}

// performance/render-physical-sync.ts
var PATCHED11 = Symbol.for("pi-droid-styling.render-physical-sync.patched");
var DEBUG_EVENTS = Symbol.for("pi-droid-styling.render-physical-sync.debug-events");
var BEGIN_SYNC = "\x1B[?2026h";
var END_SYNC = "\x1B[?2026l";
var SAVE_CURSOR = "\x1B[s";
var RESTORE_CURSOR = "\x1B[u";
var DISABLE_AUTOWRAP2 = "\x1B[?7l";
var ENABLE_AUTOWRAP2 = "\x1B[?7h";
var DEFAULT_FULL_REPAINT_INTERVAL_MS = 200;
var DEFAULT_FULL_SWEEP_INTERVAL_MS = 1e3;
var SELF_HEAL_BAND_CONTEXT_ROWS = 1;
var SELF_HEAL_FALLBACK_SEAM_ROWS = 3;
var DEBUG_TEXT_PREVIEW_CHARS = 240;
function installRenderPhysicalSync(tui) {
  if (process.env.PI_DROID_RENDER_PHYSICAL_SYNC === "0") return;
  const anchorEnabled = process.env.PI_DROID_RENDER_ABSOLUTE_ANCHOR !== "0";
  const shapeRepaintEnabled = process.env.PI_DROID_RENDER_SHAPE_REPAINT !== "0";
  const periodicSelfHealEnabled = process.env.PI_DROID_RENDER_FULL_REPAINT === "1";
  const repaintEnabled = shapeRepaintEnabled || periodicSelfHealEnabled;
  if (!anchorEnabled && !repaintEnabled) return;
  if (!tui || typeof tui.doRender !== "function") return;
  const patched = tui[PATCHED11];
  if (typeof patched === "function" && tui.doRender === patched) return;
  if (patched === true && tui.doRender.name === "physicallySyncedDoRender") return;
  const terminal = tui.terminal;
  if (!terminal || typeof terminal.write !== "function") return;
  const originalDoRender = getOriginalTuiMethod(tui, "doRender");
  const fullRepaintIntervalMs = readFullRepaintIntervalMs();
  const fullSweepIntervalMs = readFullSweepIntervalMs();
  const selfHealMode = readSelfHealMode();
  const debugEnabled = process.env.PI_DROID_RENDER_DEBUG === "1";
  let lastSelfHealAt = 0;
  let lastFullSweepAt = 0;
  const physicallySyncedDoRender = function physicallySyncedDoRender2(...args) {
    const renderer = this;
    const terminal2 = renderer.terminal;
    const activeWrite = terminal2?.write;
    if (typeof activeWrite !== "function") return originalDoRender.call(renderer, ...args);
    if (debugEnabled) renderer[DEBUG_EVENTS] = [];
    const previousLines = repaintEnabled ? readStringLines2(renderer.previousLines) : [];
    const previousViewportVisualState = readViewportVisualStateFromLines(renderer, previousLines);
    const anchorState = anchorEnabled ? readAnchorState(renderer) : void 0;
    terminal2.write = function physicallySyncedWrite(data) {
      const text = String(data);
      const normalized = anchorState ? normalizeLeadingRelativeMove(text, anchorState) : unchangedWrite(text);
      if (debugEnabled) pushDebugEvent(renderer, buildWriteRewriteDebugEvent(text, normalized));
      return activeWrite.call(this, normalized.text);
    };
    try {
      const result = originalDoRender.call(renderer, ...args);
      if (repaintEnabled) {
        const currentLines = readStringLines2(renderer.previousLines);
        const currentViewportVisualState = readViewportVisualStateFromLines(renderer, currentLines);
        const now = Date.now();
        const repaint = buildSelfHealRepaint(
          renderer,
          previousLines,
          currentLines,
          previousViewportVisualState,
          currentViewportVisualState,
          now,
          lastSelfHealAt,
          lastFullSweepAt,
          fullRepaintIntervalMs,
          fullSweepIntervalMs,
          shapeRepaintEnabled,
          periodicSelfHealEnabled,
          selfHealMode
        );
        if (debugEnabled) pushDebugEvent(renderer, buildSelfHealDebugEvent(repaint, selfHealMode, previousViewportVisualState, currentViewportVisualState, now, lastSelfHealAt, lastFullSweepAt, fullRepaintIntervalMs, fullSweepIntervalMs));
        if (repaint.output.length > 0) {
          lastSelfHealAt = now;
          if (repaint.fullViewport) lastFullSweepAt = now;
          activeWrite.call(renderer.terminal, repaint.output);
        } else {
          profileCount("render.physicalSync.selfHeal.skipInterval");
        }
      }
      return result;
    } finally {
      terminal2.write = activeWrite;
    }
  };
  tui[PATCHED11] = physicallySyncedDoRender;
  tui.doRender = physicallySyncedDoRender;
  rememberTuiMethodWrapper(tui, "doRender", physicallySyncedDoRender);
}
function readFullRepaintIntervalMs() {
  const parsed = Number(process.env.PI_DROID_RENDER_FULL_REPAINT_INTERVAL_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_FULL_REPAINT_INTERVAL_MS;
  return Math.max(0, Math.floor(parsed));
}
function readFullSweepIntervalMs() {
  const parsed = Number(process.env.PI_DROID_RENDER_FULL_SWEEP_INTERVAL_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_FULL_SWEEP_INTERVAL_MS;
  return Math.max(0, Math.floor(parsed));
}
function readSelfHealMode() {
  const value = process.env.PI_DROID_RENDER_SELF_HEAL_MODE;
  return value === "viewport" || value === "full" ? "viewport" : "band";
}
function buildSelfHealRepaint(tui, previousLines, currentLines, previousState, currentState, now, lastSelfHealAt, lastFullSweepAt, intervalMs, fullSweepIntervalMs, shapeRepaintEnabled, periodicSelfHealEnabled, mode) {
  if (currentLines.length === 0) return noSelfHealRepaint(emptyLineChanges(), false, false);
  const changes = summarizeLineChanges2(previousLines, currentLines);
  const firstSelfHeal = lastSelfHealAt <= 0;
  const viewportRemapped = hasViewportMappingChanged(previousState, currentState);
  const intervalDue = periodicSelfHealEnabled && (intervalMs <= 0 || now - lastSelfHealAt >= intervalMs);
  const fullSweepDue = periodicSelfHealEnabled && isFullSweepDue(now, lastFullSweepAt, fullSweepIntervalMs);
  if (mode === "viewport") {
    if (shapeRepaintEnabled && viewportRemapped) return fullViewportSelfHeal(currentLines, currentState, "viewport-remap", changes, intervalDue, fullSweepDue);
    if (shapeRepaintEnabled && changes.firstChanged >= 0) return fullViewportSelfHeal(currentLines, currentState, "viewport-line-change", changes, intervalDue, fullSweepDue);
    if (periodicSelfHealEnabled && firstSelfHeal) return fullViewportSelfHeal(currentLines, currentState, "first", changes, intervalDue, fullSweepDue);
    if (intervalDue) return fullViewportSelfHeal(currentLines, currentState, "viewport-interval", changes, intervalDue, fullSweepDue);
    return noSelfHealRepaint(changes, intervalDue, fullSweepDue);
  }
  if (periodicSelfHealEnabled && firstSelfHeal) return fullViewportSelfHeal(currentLines, currentState, "first", changes, intervalDue, fullSweepDue);
  if (shapeRepaintEnabled && viewportRemapped) return fullViewportSelfHeal(currentLines, currentState, "viewport-remap", changes, intervalDue, fullSweepDue);
  if (shapeRepaintEnabled && changes.firstChanged >= 0) {
    const ranges = buildLineChangeRanges(changes, currentState, false);
    const cursorScreenRow = clamp3(readNumber2(tui.hardwareCursorRow) - currentState.viewportTop + 1, 1, currentState.height);
    ranges.push({ start: cursorScreenRow - SELF_HEAL_BAND_CONTEXT_ROWS, end: cursorScreenRow + SELF_HEAL_BAND_CONTEXT_ROWS });
    return bandSelfHeal(currentLines, currentState, ranges, "line-change-band", changes, intervalDue, fullSweepDue);
  }
  if (fullSweepDue) return fullViewportSelfHeal(currentLines, currentState, "full-sweep", changes, intervalDue, fullSweepDue);
  if (intervalDue) return bandSelfHeal(currentLines, currentState, buildFallbackRanges(tui, changes, currentState), "interval-band", changes, intervalDue, fullSweepDue);
  return noSelfHealRepaint(changes, intervalDue, fullSweepDue);
}
function noSelfHealRepaint(changes, intervalDue, fullSweepDue) {
  return { output: "", fullViewport: false, reason: "none", ranges: [], rows: 0, changes, intervalDue, fullSweepDue };
}
function fullViewportSelfHeal(lines, state2, reason, changes, intervalDue, fullSweepDue) {
  const range = { start: 1, end: state2.height };
  return { output: buildFullViewportRepaint(lines, state2), fullViewport: true, reason, ranges: [range], rows: countRows([range]), changes, intervalDue, fullSweepDue };
}
function bandSelfHeal(lines, state2, ranges, reason, changes, intervalDue, fullSweepDue) {
  const mergedRanges = mergeRanges(ranges, state2.height);
  return { output: buildBandRepaint(lines, state2, mergedRanges), fullViewport: false, reason, ranges: mergedRanges, rows: countRows(mergedRanges), changes, intervalDue, fullSweepDue };
}
function isFullSweepDue(now, lastFullSweepAt, intervalMs) {
  return intervalMs > 0 && lastFullSweepAt > 0 && now - lastFullSweepAt >= intervalMs;
}
function emptyLineChanges() {
  return { firstChanged: -1, lastChanged: -1, lineCountChanged: false };
}
function countRows(ranges) {
  return ranges.reduce((total, range) => total + Math.max(0, range.end - range.start + 1), 0);
}
function summarizeLineChanges2(previousLines, currentLines) {
  let firstChanged = -1;
  let lastChanged = -1;
  const max = Math.max(previousLines.length, currentLines.length);
  for (let index = 0; index < max; index++) {
    if ((previousLines[index] ?? "") === (currentLines[index] ?? "")) continue;
    if (firstChanged === -1) firstChanged = index;
    lastChanged = index;
  }
  return {
    firstChanged,
    lastChanged,
    lineCountChanged: previousLines.length !== currentLines.length
  };
}
function hasViewportMappingChanged(previousState, currentState) {
  return previousState.viewportTop !== currentState.viewportTop || previousState.height !== currentState.height;
}
function buildLineChangeRanges(changes, state2, throughVisibleBottom) {
  if (changes.firstChanged < 0) return [];
  const visibleStart = state2.viewportTop;
  const visibleEnd = state2.viewportTop + state2.height - 1;
  const startLine = Math.max(visibleStart, changes.firstChanged - SELF_HEAL_BAND_CONTEXT_ROWS);
  const endLine = Math.min(visibleEnd, throughVisibleBottom ? visibleEnd : changes.lastChanged + SELF_HEAL_BAND_CONTEXT_ROWS);
  if (startLine > visibleEnd || endLine < visibleStart || startLine > endLine) return [];
  return [{ start: startLine - state2.viewportTop + 1, end: endLine - state2.viewportTop + 1 }];
}
function buildFallbackRanges(tui, changes, state2) {
  const ranges = buildLineChangeRanges(changes, state2, false);
  const cursorScreenRow = clamp3(readNumber2(tui.hardwareCursorRow) - state2.viewportTop + 1, 1, state2.height);
  ranges.push({ start: cursorScreenRow - SELF_HEAL_BAND_CONTEXT_ROWS, end: cursorScreenRow + SELF_HEAL_BAND_CONTEXT_ROWS });
  ranges.push({ start: state2.height - SELF_HEAL_FALLBACK_SEAM_ROWS + 1, end: state2.height });
  return ranges;
}
function buildBandRepaint(lines, state2, ranges) {
  const mergedRanges = mergeRanges(ranges, state2.height);
  if (mergedRanges.length === 0) return "";
  let rowCount = 0;
  let output = DISABLE_AUTOWRAP2 + SAVE_CURSOR + BEGIN_SYNC;
  for (const range of mergedRanges) {
    for (let row = range.start; row <= range.end; row++) {
      output += `\x1B[${row};1H\x1B[2K${lines[state2.viewportTop + row - 1] ?? ""}`;
      rowCount++;
    }
  }
  profileCount("render.physicalSync.bandRepaint");
  profileCount("render.physicalSync.bandRepaint.row", rowCount);
  return output + END_SYNC + RESTORE_CURSOR + ENABLE_AUTOWRAP2;
}
function mergeRanges(ranges, height) {
  const normalized = ranges.map((range) => ({ start: clamp3(range.start, 1, height), end: clamp3(range.end, 1, height) })).filter((range) => range.start <= range.end).sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [];
  for (const range of normalized) {
    const previous = merged[merged.length - 1];
    if (!previous || range.start > previous.end + 1) {
      merged.push({ ...range });
      continue;
    }
    previous.end = Math.max(previous.end, range.end);
  }
  return merged;
}
function readViewportVisualStateFromLines(tui, lines) {
  return {
    lineCount: lines.length,
    viewportTop: Math.max(0, readNumber2(tui.previousViewportTop)),
    height: readViewportHeight(tui)
  };
}
function readViewportHeight(tui) {
  const previousHeight = readNumber2(tui.previousHeight);
  const terminalRows = readNumber2(tui.terminal?.rows);
  return Math.max(1, terminalRows > 0 && previousHeight > 0 ? Math.min(previousHeight, terminalRows) : previousHeight || terminalRows || 1);
}
function buildFullViewportRepaint(lines, state2) {
  let output = DISABLE_AUTOWRAP2 + SAVE_CURSOR + BEGIN_SYNC;
  for (let row = 1; row <= state2.height; row++) {
    output += `\x1B[${row};1H\x1B[2K${lines[state2.viewportTop + row - 1] ?? ""}`;
  }
  profileCount("render.physicalSync.fullViewportRepaint");
  return output + END_SYNC + RESTORE_CURSOR + ENABLE_AUTOWRAP2;
}
function readAnchorState(tui) {
  const hardwareCursorRow = readNumber2(tui.hardwareCursorRow);
  const previousViewportTop = readNumber2(tui.previousViewportTop);
  const terminalRows = Math.max(1, readNumber2(tui.terminal?.rows) || 1);
  return {
    currentScreenRow: clamp3(hardwareCursorRow - previousViewportTop, 0, terminalRows - 1),
    terminalRows
  };
}
function normalizeLeadingRelativeMove(data, state2) {
  if (!data.startsWith(BEGIN_SYNC)) return unchangedWrite(data);
  const rest = data.slice(BEGIN_SYNC.length);
  const upMatch = rest.match(/^\x1b\[(\d+)A\r/);
  if (upMatch) {
    const targetScreenRow = state2.currentScreenRow - Number(upMatch[1]);
    return replaceLeadingMove(data, upMatch[0].length, targetScreenRow, state2.terminalRows, "leadingRelativeUp");
  }
  const downMatch = rest.match(/^\x1b\[(\d+)B\r/);
  if (downMatch) {
    const targetScreenRow = state2.currentScreenRow + Number(downMatch[1]);
    return replaceLeadingMove(data, downMatch[0].length, targetScreenRow, state2.terminalRows, "leadingRelativeDown");
  }
  if (rest.startsWith("\r")) {
    return replaceLeadingMove(data, 1, state2.currentScreenRow, state2.terminalRows, "leadingCarriageReturn");
  }
  return unchangedWrite(data);
}
function unchangedWrite(data) {
  const kind = classifyWriteKind(data);
  return { text: data, rawKind: kind, finalKind: kind, rewritten: false };
}
function replaceLeadingMove(data, matchedLength, targetScreenRow, terminalRows, rawKind) {
  const row = clamp3(Math.floor(targetScreenRow) + 1, 1, terminalRows);
  profileCount("render.physicalSync.absoluteAnchor.rewrite");
  return {
    text: `${BEGIN_SYNC}\x1B[${row};1H${data.slice(BEGIN_SYNC.length + matchedLength)}`,
    rawKind,
    finalKind: "leadingAbsoluteAnchor",
    rewritten: true,
    targetRow: row
  };
}
function classifyWriteKind(data) {
  if (data.startsWith(DISABLE_AUTOWRAP2 + SAVE_CURSOR + BEGIN_SYNC)) return "physicalSelfHeal";
  if (!data.startsWith(BEGIN_SYNC)) return "plain";
  const rest = data.slice(BEGIN_SYNC.length);
  if (/^\x1b\[\d+A\r/u.test(rest)) return "leadingRelativeUp";
  if (/^\x1b\[\d+B\r/u.test(rest)) return "leadingRelativeDown";
  if (/^\x1b\[\d+;1H/u.test(rest)) return "leadingAbsoluteAnchor";
  if (rest.startsWith("\r")) return "leadingCarriageReturn";
  return "beginSync";
}
function pushDebugEvent(tui, event) {
  const events = tui[DEBUG_EVENTS];
  if (Array.isArray(events)) events.push(event);
}
function buildWriteRewriteDebugEvent(rawText, normalized) {
  return {
    type: "writeRewrite",
    rawKind: normalized.rawKind,
    finalKind: normalized.finalKind,
    rewritten: normalized.rewritten,
    targetRow: normalized.targetRow,
    rawBytes: byteLength(rawText),
    finalBytes: byteLength(normalized.text),
    rawPreview: truncateText2(rawText, DEBUG_TEXT_PREVIEW_CHARS),
    finalPreview: truncateText2(normalized.text, DEBUG_TEXT_PREVIEW_CHARS)
  };
}
function buildSelfHealDebugEvent(repaint, mode, previousState, currentState, now, lastSelfHealAt, lastFullSweepAt, intervalMs, fullSweepIntervalMs) {
  return {
    type: "selfHeal",
    mode,
    reason: repaint.reason,
    fullViewport: repaint.fullViewport,
    ranges: repaint.ranges,
    rows: repaint.rows,
    previousState,
    currentState,
    changes: repaint.changes,
    intervalDue: repaint.intervalDue,
    fullSweepDue: repaint.fullSweepDue,
    elapsedSinceSelfHealMs: elapsedSince(now, lastSelfHealAt, intervalMs),
    elapsedSinceFullSweepMs: elapsedSince(now, lastFullSweepAt, fullSweepIntervalMs),
    bytes: byteLength(repaint.output)
  };
}
function elapsedSince(now, previous, intervalMs) {
  if (previous <= 0) return intervalMs <= 0 ? 0 : intervalMs;
  return Math.max(0, now - previous);
}
function byteLength(text) {
  return Buffer.byteLength(text, "utf8");
}
function truncateText2(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\u2026<truncated ${text.length - maxLength} chars>`;
}
function readStringLines2(value) {
  return Array.isArray(value) ? value.map((line) => String(line)) : [];
}
function readNumber2(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
}
function clamp3(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// performance/render-throttle.ts
var PATCHED12 = Symbol.for("pi-droid-styling.render-throttle.patched");
var REQUEST_WITH_FRAME_MS = Symbol.for("pi-droid-styling.render-throttle.request-with-frame-ms");
var DEFAULT_FRAME_MS = 29;
function normalizeFrameMs(value, fallback) {
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}
function installRenderThrottle(tui, frameMs = DEFAULT_FRAME_MS) {
  if (tui[PATCHED12]) {
    if (typeof tui[REQUEST_WITH_FRAME_MS] !== "function") {
      tui[REQUEST_WITH_FRAME_MS] = (requestedFrameMs, force = false) => tui.requestRender(force);
    }
    return;
  }
  tui[PATCHED12] = true;
  const origRequestRender = getOriginalTuiMethod(tui, "requestRender");
  const defaultFrameMs = normalizeFrameMs(frameMs, DEFAULT_FRAME_MS);
  let timer = null;
  let timerDueAt = 0;
  let lastRenderTime = 0;
  let pendingForce = false;
  let currentTui = tui;
  function clearScheduledRender() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    timerDueAt = 0;
  }
  function dispatchRender(now) {
    clearScheduledRender();
    lastRenderTime = now;
    origRequestRender.call(currentTui, pendingForce);
    pendingForce = false;
  }
  function scheduleRender(delay) {
    const scheduledAt = profileNow();
    timerDueAt = Date.now() + delay;
    timer = setTimeout(() => {
      timer = null;
      timerDueAt = 0;
      lastRenderTime = Date.now();
      profileCount("render.request.dispatch.delayed");
      profileDuration("render.request.latency.ms", scheduledAt);
      origRequestRender.call(currentTui, pendingForce);
      pendingForce = false;
    }, delay);
  }
  function requestRenderAtFrame(force = false, requestedFrameMs = defaultFrameMs) {
    profileCount("render.request.calls");
    if (force) {
      pendingForce = true;
      profileCount("render.request.force");
    }
    const effectiveFrameMs = normalizeFrameMs(requestedFrameMs, defaultFrameMs);
    const now = Date.now();
    const elapsed = now - lastRenderTime;
    if (elapsed >= effectiveFrameMs) {
      profileCount("render.request.dispatch.immediate");
      profileSample("render.request.latency.ms", 0);
      dispatchRender(now);
      return;
    }
    const delay = effectiveFrameMs - elapsed;
    const dueAt = now + delay;
    if (timer !== null) {
      if (dueAt < timerDueAt) {
        profileCount("render.request.rescheduledEarlier");
        profileSample("render.request.delay.ms", delay);
        clearScheduledRender();
        scheduleRender(delay);
      } else {
        profileCount("render.request.coalesced");
      }
      return;
    }
    profileCount("render.request.scheduled");
    profileSample("render.request.delay.ms", delay);
    scheduleRender(delay);
  }
  tui[REQUEST_WITH_FRAME_MS] = (requestedFrameMs, force = false) => requestRenderAtFrame(force, requestedFrameMs);
  const throttledRequestRender = function throttledRequestRender2(force = false) {
    if (this != null) currentTui = this;
    requestRenderAtFrame(force, defaultFrameMs);
  };
  tui.requestRender = throttledRequestRender;
  rememberTuiMethodWrapper(tui, "requestRender", throttledRequestRender);
}

// performance/render-width-guard.ts
import { CURSOR_MARKER as CURSOR_MARKER2 } from "@earendil-works/pi-tui";
var PATCHED13 = Symbol.for("pi-droid-styling.render-width-guard.patched");
function normalizeWidth(width) {
  const normalized = Math.floor(width);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
}
function clampLineWithCursorMarker(line, width) {
  const markerIndex = line.indexOf(CURSOR_MARKER2);
  if (markerIndex === -1) return clampRenderLineToWidth(line, width);
  const beforeMarker = line.slice(0, markerIndex);
  const afterMarker = line.slice(markerIndex + CURSOR_MARKER2.length);
  const lineWithoutMarker = `${beforeMarker}${afterMarker}`;
  const visible = safeVisibleWidth(lineWithoutMarker);
  if (visible <= width) return line;
  profileCount("render.widthGuard.clamped.cursor");
  profileSample("render.widthGuard.overflow.cols", visible - width);
  const beforeWidth = safeVisibleWidth(beforeMarker);
  if (beforeWidth >= width) {
    return `${safeTruncateToWidth(beforeMarker, width, "")}${CURSOR_MARKER2}`;
  }
  return `${beforeMarker}${CURSOR_MARKER2}${safeTruncateToWidth(afterMarker, width - beforeWidth, "")}`;
}
function clampRenderLineToWidth(line, width) {
  if (width <= 0 || line.length === 0 || isImageRenderLine(line)) return line;
  if (line.includes(CURSOR_MARKER2)) return clampLineWithCursorMarker(line, width);
  const visible = safeVisibleWidth(line);
  if (visible <= width) return line;
  profileCount("render.widthGuard.clamped");
  profileSample("render.widthGuard.overflow.cols", visible - width);
  return safeTruncateToWidth(line, width, "");
}
function clampRenderLinesToWidth(lines, width) {
  const renderWidth = normalizeWidth(width);
  if (renderWidth <= 0) return [...lines];
  return lines.map((line) => clampRenderLineToWidth(line, renderWidth));
}
function installRenderWidthGuard(tui) {
  if (!tui || tui[PATCHED13] || typeof tui.render !== "function") return;
  const originalRender = getOriginalTuiMethod(tui, "render");
  tui[PATCHED13] = true;
  const guardedRender = function guardedRender2(width) {
    return clampRenderLinesToWidth(originalRender.call(this, width), width);
  };
  tui.render = guardedRender;
  rememberTuiMethodWrapper(tui, "render", guardedRender);
}

// theme/terminal-background.ts
var OSC11_SET_BACKGROUND_PREFIX = "\x1B]11;";
var OSC111_RESET_BACKGROUND = "\x1B]111\x07";
function isWindowsHost(platform = process.platform, env = process.env) {
  return platform === "win32" || Boolean(env.WT_SESSION || env.WSL_DISTRO_NAME || env.WSL_INTEROP);
}
function normalizeOscHexColor(value) {
  let hex = value.trim().replace(/^#/, "");
  if (hex.length === 3) hex = hex.split("").map((char) => `${char}${char}`).join("");
  if (hex.length > 6) hex = hex.slice(0, 6);
  return `#${hex}`;
}
function shouldApplyTerminalBackgroundOsc11(options = {}) {
  if (options.force === true) return true;
  return !isWindowsHost(options.platform ?? process.platform, options.env ?? process.env);
}
function terminalBackgroundOsc11(hex) {
  return `${OSC11_SET_BACKGROUND_PREFIX}${normalizeOscHexColor(hex)}\x07`;
}
function resetTerminalBackgroundOsc111() {
  return OSC111_RESET_BACKGROUND;
}
function applyTerminalPageBackgroundOsc11(theme, terminal, options = {}) {
  if (!shouldApplyTerminalBackgroundOsc11(options)) return void 0;
  const pageBg = getThemePageBackground(theme);
  if (!isHexColor(pageBg) || typeof terminal?.write !== "function") return void 0;
  const write = terminal.write.bind(terminal);
  try {
    write(terminalBackgroundOsc11(pageBg));
  } catch {
    return void 0;
  }
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    try {
      write(resetTerminalBackgroundOsc111());
    } catch {
    }
  };
}

// tool-tags/compact-tool-spacing.ts
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
var PATCH_FLAG2 = "__compactToolSpacingPatched__";
var LEGACY_CHAIN_FLAG = "__compactToolSpacingLegacyChain__";
var PATCH_VERSION_KEY = "__compactToolSpacingPatchVersion__";
var RUNTIME_STATE_KEY = Symbol.for("pi-droid-styling.compact-tool-spacing.runtime-state");
var PATCH_VERSION = 11;
var DELEGATE_AWARE_PATCH_VERSION = 10;
var cachedTheme2 = null;
function setToolSpacingTheme(theme) {
  cachedTheme2 = theme;
  cachedDividerWidth = -1;
}
function buildDividerLine3(width) {
  if (width <= 0) return "";
  const char = getThemeExtra(cachedTheme2, "dividerChar");
  const color2 = getThemeExtra(cachedTheme2, "dividerColor");
  const line = char.repeat(width);
  return cachedTheme2 ? fgHex(cachedTheme2, color2, line) : line;
}
function trimOuterBlankLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && stripAnsi(lines[start] ?? "").trim() === "") start++;
  while (end > start && stripAnsi(lines[end - 1] ?? "").trim() === "") end--;
  return lines.slice(start, end);
}
function splitImageTail(lines) {
  const first = lines.findIndex(isImageRenderLine);
  if (first < 0) return { content: lines, tail: [] };
  let start = first;
  while (start > 0 && stripAnsi(lines[start - 1] ?? "").trim() === "") start--;
  return { content: lines.slice(0, start), tail: lines.slice(start) };
}
function appendImageTail(lines, tail) {
  if (tail.length === 0) return lines;
  let end = lines.length;
  while (end > 0 && stripAnsi(lines[end - 1] ?? "").trim() === "") end--;
  return [...lines.slice(0, end), ...tail, ""];
}
function isFullWidthDivider(line, width) {
  const dividerChar = getThemeExtra(cachedTheme2, "dividerChar");
  return Boolean(dividerChar) && stripAnsi(line) === dividerChar.repeat(width);
}
function reasonixEllipsis2() {
  return cachedTheme2?.fg?.("dim", " \u2026") ?? " \u2026";
}
function truncateReasonixLine2(text, width) {
  const content = trimTrailingRenderPadding(text);
  const rowWidth = Math.max(1, Math.floor(width));
  if (safeVisibleWidth(content) <= rowWidth) return content;
  return safeTruncateToWidth(content, rowWidth, reasonixEllipsis2());
}
function colorReasonixConnector(line) {
  const visible = stripAnsi(line);
  const connectorIndex = visible.indexOf("\u2514\u2500 ");
  if (connectorIndex < 0 || visible.slice(0, connectorIndex).trim().length > 0) return line;
  const remainder = dropLeadingColumns(line, connectorIndex + 3);
  const connector = cachedTheme2?.fg?.("dim", "\u2514\u2500 ") ?? "\u2514\u2500 ";
  return `${" ".repeat(connectorIndex)}${connector}${remainder}`;
}
function formatReasonixMetricsLine(footerLine, width) {
  const footer = toSingleRenderLine(footerLine).trimStart();
  const line = stripAnsi(footer).startsWith("\u2514\u2500 ") ? `  ${footer}` : `  \u2514\u2500 ${footer}`;
  return truncateReasonixLine2(colorReasonixConnector(line), width);
}
function normalizeReasonixToolLines(lines, width, expanded) {
  const content = trimOuterBlankLines(lines);
  while (content.length > 0 && isFullWidthDivider(content[0] ?? "", width)) content.shift();
  if (content.length === 0) return [];
  const rowWidth = expanded ? Math.max(1, width) : getReasonixCollapsedRowWidth(width);
  if (expanded) {
    content[0] = truncateReasonixLine2(toSingleRenderLine(content[0] ?? ""), rowWidth);
    for (let index = 1; index < content.length; index++) {
      content[index] = truncateReasonixLine2(colorReasonixConnector(content[index] ?? ""), rowWidth);
    }
    return [...content, ""];
  }
  let footerIndex = -1;
  for (let index = content.length - 1; index > 0; index--) {
    const plain = stripAnsi(content[index] ?? "").trimStart();
    if (!plain.includes("\u25F7") && !(content.length === 2 && plain.startsWith("\u2514\u2500 "))) continue;
    footerIndex = index;
    break;
  }
  const outputIndex = content.findIndex((line, index) => index > 0 && stripAnsi(line).trimStart().startsWith("\u2514\u2500 "));
  const headerEnd = outputIndex >= 0 ? outputIndex : footerIndex >= 0 ? footerIndex : content.length;
  const headerRows = content.slice(0, Math.max(1, headerEnd)).map((line) => truncateReasonixLine2(toSingleRenderLine(line), rowWidth));
  if (footerIndex < 0) return [...headerRows, ""];
  return [...headerRows, formatReasonixMetricsLine(content[footerIndex] ?? "", rowWidth), ""];
}
function normalizeBoxedLines(lines) {
  const boxStart = lines.findIndex((line) => stripAnsi(line).startsWith("\u250C"));
  if (boxStart < 0) return void 0;
  let boxEnd = lines.length - 1;
  while (boxEnd > boxStart && stripAnsi(lines[boxEnd] ?? "").trim() === "") boxEnd--;
  return lines.slice(boxStart, boxEnd + 1);
}
var cachedDivider = "";
var cachedDividerWidth = -1;
function legacyWrapperInChain() {
  return Boolean(globalThis[LEGACY_CHAIN_FLAG]);
}
function normalizeToolRenderLines(lines, width, expanded) {
  const { content, tail } = splitImageTail(lines);
  if (getPresentationDesign().compactLayout) {
    return appendImageTail(normalizeReasonixToolLines(content, width, expanded), tail);
  }
  const boxedLines = normalizeBoxedLines(content);
  if (boxedLines) return appendImageTail(boxedLines, tail);
  if (legacyWrapperInChain()) return lines;
  if (getThemeExtra(cachedTheme2, "showDivider") === "false") return appendImageTail([...content, ""], tail);
  if (cachedDividerWidth !== width) {
    cachedDivider = buildDividerLine3(width);
    cachedDividerWidth = width;
  }
  return appendImageTail([cachedDivider, ...content, ""], tail);
}
function installCompactToolSpacing(ToolExecutionComponentClass = ToolExecutionComponent) {
  const proto = ToolExecutionComponentClass?.prototype;
  if (!proto || typeof proto.render !== "function") return;
  const globalState = globalThis;
  const existingVersion = proto.render[PATCH_VERSION_KEY];
  const existingDelegateAware = typeof existingVersion === "number" && existingVersion >= DELEGATE_AWARE_PATCH_VERSION;
  if (!(LEGACY_CHAIN_FLAG in globalState)) {
    globalState[LEGACY_CHAIN_FLAG] = Boolean(globalState[PATCH_FLAG2]) && !existingDelegateAware;
  }
  globalState[PATCH_FLAG2] = true;
  proto[RUNTIME_STATE_KEY] = {
    usesReasonix: () => true,
    normalizeReasonix: normalizeToolRenderLines,
    showDivider: () => getThemeExtra(cachedTheme2, "showDivider") !== "false",
    buildDivider: buildDividerLine3
  };
  if (existingDelegateAware) return;
  const baseRender = proto.render;
  const patchedToolRender = function patchedToolRender2(width) {
    const rendered = baseRender.call(this, width);
    if (rendered.length === 0 || width <= 0) return rendered;
    const runtime = proto[RUNTIME_STATE_KEY];
    return runtime.normalizeReasonix(rendered, width, Boolean(this.expanded));
  };
  patchedToolRender[PATCH_VERSION_KEY] = PATCH_VERSION;
  proto.render = patchedToolRender;
}

// tool-tags/default-badge.ts
import { ToolExecutionComponent as ToolExecutionComponent2 } from "@earendil-works/pi-coding-agent";
var PATCH_FLAG3 = "__defaultBadgePatched__";
var RENDERED_FLAG = Symbol("__defaultBadge_rendered__");
var BOXED_FALLBACK_FLAG = Symbol("__defaultBadge_boxedFallback__");
var EXECUTION_STARTED_AT_FLAG = Symbol("__defaultBadge_executionStartedAt__");
var CUSTOM_TOOLS = /* @__PURE__ */ new Set(["read", "write", "edit", "bash", "ls", "find", "grep", "quick_edit", "substitute_edit", "target_edit"]);
var MAX_FALLBACK_PREVIEW_LINES = 10;
var cachedTheme3 = null;
var fallbackTheme = {
  fg: (_color, text) => text,
  bold: (text) => text
};
function getRenderTheme() {
  return cachedTheme3 ?? fallbackTheme;
}
function getTextOutput2(owner) {
  try {
    if (typeof owner.getTextOutput === "function") return String(owner.getTextOutput() ?? "").replace(/\r/g, "").trimEnd();
  } catch {
  }
  const content = owner.result?.content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block?.type === "text").map((block) => String(block.text ?? "")).join("\n").replace(/\r/g, "").trimEnd();
}
function createBoxedFallbackComponent(owner) {
  let cache = null;
  return {
    invalidate() {
      cache = null;
    },
    render(width) {
      const theme = getRenderTheme();
      const isError = Boolean(owner.result?.isError);
      const isPartial = Boolean(owner.isPartial);
      const hasResult = Boolean(owner.result);
      const expanded = Boolean(owner.expanded);
      const maxLines = hasResult && expanded ? loadConfig().maxExpandedLines : MAX_FALLBACK_PREVIEW_LINES;
      if (cache && cache.width === width && cache.theme === theme && cache.result === owner.result && cache.expanded === expanded && cache.maxLines === maxLines && cache.isError === isError && cache.isPartial === isPartial && cache.hasResult === hasResult) {
        return cache.lines;
      }
      const call = renderBoxedToolCall(theme, formatToolName(String(owner.toolName ?? "Tool")), formatToolParamLines(owner.args, theme), {
        isError,
        isPartial,
        isPending: isPartial && !hasResult
      });
      if (!hasResult) {
        const lines2 = call.render(width);
        cache = { width, theme, result: owner.result, expanded, maxLines, isError, isPartial, hasResult, lines: lines2 };
        return lines2;
      }
      const output = getTextOutput2(owner);
      const renderOptions = { expanded, isPartial };
      const result = renderBoxedToolResult(theme, (contentWidth) => {
        const body = renderLines(theme, output, renderOptions, {
          maxLines,
          color: isError ? "error" : "toolOutput",
          width: contentWidth
        });
        return body ? body.split("\n") : [];
      }, {
        footerLines: [formatBoxedFooter(theme, owner.result)],
        renderLineBudget: maxLines,
        isError,
        isPartial
      });
      const lines = [...call.render(width), ...result.render(width)];
      cache = { width, theme, result: owner.result, expanded, maxLines, isError, isPartial, hasResult, lines };
      return lines;
    }
  };
}
function tightenBoxedContainer(thisArg) {
  const renderShell = typeof thisArg.getRenderShell === "function" ? thisArg.getRenderShell() : "default";
  const container = renderShell === "self" ? thisArg.selfRenderContainer : thisArg.contentBox;
  if (!container) return;
  container.paddingX = 0;
  container.paddingY = 0;
  if (typeof container.setBgFn === "function") container.setBgFn((text) => text);
  if (typeof container.invalidateCache === "function") container.invalidateCache();
}
function installBoxedFallback(thisArg) {
  const component = thisArg[BOXED_FALLBACK_FLAG] ?? createBoxedFallbackComponent(thisArg);
  thisArg[BOXED_FALLBACK_FLAG] = component;
  const hasRendererDefinition = Boolean(thisArg.hasRendererDefinition?.());
  const usesSelfRenderShell = hasRendererDefinition && thisArg.getRenderShell?.() === "self";
  const targetContainer = usesSelfRenderShell ? thisArg.selfRenderContainer : thisArg.contentBox;
  if (targetContainer && typeof targetContainer.clear === "function" && typeof targetContainer.addChild === "function") {
    tightenBoxedContainer(thisArg);
    targetContainer.clear();
    targetContainer.addChild(component);
  }
  const childIndex = Array.isArray(thisArg.children) ? thisArg.children.indexOf(thisArg.contentText) : -1;
  if (childIndex >= 0) thisArg.children[childIndex] = thisArg.contentBox;
}
function setDefaultBadgeTheme(theme) {
  cachedTheme3 = theme;
}
function installDefaultBadge() {
  const globalState = globalThis;
  if (globalState[PATCH_FLAG3]) return;
  globalState[PATCH_FLAG3] = true;
  const proto = ToolExecutionComponent2.prototype;
  if (!proto || typeof proto.updateDisplay !== "function") return;
  const baseGetRenderContext = proto.getRenderContext;
  if (typeof baseGetRenderContext === "function") {
    proto.getRenderContext = function patchedBoxedRenderContext(...args) {
      const context = baseGetRenderContext.apply(this, args);
      return { ...context, hasResult: Boolean(this.result) };
    };
  }
  const baseMarkExecutionStarted = proto.markExecutionStarted;
  if (typeof baseMarkExecutionStarted === "function") {
    proto.markExecutionStarted = function patchedDefaultBadgeMarkExecutionStarted(...args) {
      this[EXECUTION_STARTED_AT_FLAG] = performance.now();
      return baseMarkExecutionStarted.apply(this, args);
    };
  }
  const baseUpdateResult = proto.updateResult;
  if (typeof baseUpdateResult === "function") {
    proto.updateResult = function patchedDefaultBadgeUpdateResult(result, isPartial = false, ...rest) {
      if (!isPartial && result && typeof result === "object") {
        const startedAt = typeof this[EXECUTION_STARTED_AT_FLAG] === "number" ? this[EXECUTION_STARTED_AT_FLAG] : void 0;
        const elapsedMs = startedAt === void 0 ? void 0 : Math.max(0, performance.now() - startedAt);
        annotateToolResultMetrics(result, elapsedMs);
      }
      return baseUpdateResult.call(this, result, isPartial, ...rest);
    };
  }
  const baseUpdateDisplay = proto.updateDisplay;
  proto.updateDisplay = function patchedDefaultBadge(...args) {
    if (!this[RENDERED_FLAG] && this.resultRendererComponent && typeof this.resultRendererComponent.invalidate === "function") {
      try {
        this.resultRendererComponent.invalidate();
      } catch {
      }
    }
    this[RENDERED_FLAG] = true;
    const result = baseUpdateDisplay.apply(this, args);
    const toolName = this.toolName;
    if (!toolName) return result;
    if (CUSTOM_TOOLS.has(toolName)) {
      tightenBoxedContainer(this);
      return result;
    }
    installBoxedFallback(this);
    this[BOXED_FALLBACK_FLAG]?.invalidate?.();
    return result;
  };
}

// tool-tags/quick-edit.ts
import { getLanguageFromPath as getLanguageFromPath4 } from "@earendil-works/pi-coding-agent";
import { Text as Text3 } from "@earendil-works/pi-tui";
var RESULT_PATCHED = Symbol.for("pi-droid-styling.quick-edit-renderer.result.patched");
var CALL_PATCHED = Symbol.for("pi-droid-styling.quick-edit-renderer.call.patched");
var STARTED_AT_KEY = "__droidStartedAt";
var ELAPSED_MS_KEY = "__droidElapsedMs";
var MAX_HIGHLIGHT_DIFF_CHARS2 = 12e3;
var MAX_HIGHLIGHT_DIFF_ROWS2 = 120;
var QUICK_EDIT_TOOLS = {
  quick_edit: {
    toolLabel: "Quick Edit",
    applyingLabel: "quick-edit",
    fallbackLabel: "Quick edit applied"
  },
  substitute_edit: {
    toolLabel: "Substitute Edit",
    applyingLabel: "substitute-edit",
    fallbackLabel: "Substitute edit applied"
  },
  target_edit: {
    toolLabel: "Target Edit",
    applyingLabel: "target-edit",
    fallbackLabel: "Target edit applied"
  }
};
function getQuickEditToolConfig(toolName) {
  return typeof toolName === "string" ? QUICK_EDIT_TOOLS[toolName] : void 0;
}
function extractQuickEditDiff(text) {
  const lines = stripAnsi(text).replace(/\r/g, "").split("\n");
  const start = lines.indexOf("\u2500\u2500 diff \u2500\u2500");
  if (start < 0) return void 0;
  const diffLines = [];
  let cumulativeDelta = 0;
  let oldLine;
  let newLine;
  let chunkAdditions = 0;
  let chunkRemovals = 0;
  const finishChunk = () => {
    cumulativeDelta += chunkAdditions - chunkRemovals;
    oldLine = void 0;
    newLine = void 0;
    chunkAdditions = 0;
    chunkRemovals = 0;
  };
  for (const line of lines.slice(start + 1)) {
    if (line === "") {
      finishChunk();
      continue;
    }
    const headerMatch = line.match(/^:(\d+)(?:-\d+)?$/);
    if (headerMatch) {
      finishChunk();
      const startLine = Number.parseInt(headerMatch[1] ?? "", 10);
      oldLine = startLine;
      newLine = startLine + cumulativeDelta;
      continue;
    }
    const match = line.match(/^([+-]) (.*)$/);
    if (match) {
      const [, sign, content = ""] = match;
      let gutter = "";
      if (sign === "-" && oldLine !== void 0) gutter = String(oldLine++);
      if (sign === "+" && newLine !== void 0) gutter = String(newLine++);
      if (!gutter) continue;
      if (sign === "-") chunkRemovals++;
      if (sign === "+") chunkAdditions++;
      diffLines.push(`${sign} ${gutter} ${content}`);
      continue;
    }
    if (line === "---") break;
  }
  return diffLines.length > 0 ? diffLines.join("\n") : void 0;
}
function renderQuickEditCall(args, theme, config, context = {}) {
  if (context.executionStarted && typeof context.state === "object" && typeof context.state[STARTED_AT_KEY] !== "number") {
    context.state[STARTED_AT_KEY] = performance.now();
  }
  const rawPath = String(args?.path ?? "");
  const cwd = typeof context.cwd === "string" ? context.cwd : process.cwd();
  const relPath = rawPath ? resolveRelativePath(rawPath, cwd) : "";
  const detail = relPath || "(unknown)";
  return renderBoxedToolCall(theme, config.toolLabel, [`${theme.fg("dim", "Path: ")}${detail}`], {
    state: context.state,
    isError: Boolean(context.isError),
    isPartial: Boolean(context.isPartial),
    isPending: Boolean(context.isPartial && !context.hasResult)
  });
}
function getQuickEditElapsedMs(context) {
  const state2 = context.state;
  if (!state2 || typeof state2 !== "object") return void 0;
  if (typeof state2[ELAPSED_MS_KEY] !== "number" && typeof state2[STARTED_AT_KEY] === "number") {
    state2[ELAPSED_MS_KEY] = performance.now() - state2[STARTED_AT_KEY];
  }
  return typeof state2[ELAPSED_MS_KEY] === "number" ? state2[ELAPSED_MS_KEY] : void 0;
}
function formatQuickEditFooter(theme, context, output = "") {
  return formatBoxedFooterFromValues(theme, getQuickEditElapsedMs(context), output);
}
function renderQuickEditResult(result, options, theme, config, context = {}) {
  const expanded = isExpanded(options);
  if (expanded) clearCompactBoxedFooter(context.state);
  const reasonixCollapsed = getPresentationDesign().compactLayout && !expanded && Boolean(context.state);
  if (options.isPartial) {
    if (reasonixCollapsed) {
      setCompactBoxedFooter(context.state, theme.fg("muted", `Applying ${config.applyingLabel}...`), { isPartial: true });
      return { invalidate() {
      }, render: () => [] };
    }
    return renderBoxedToolResult(theme, () => [`${theme.fg("dim", "\u21B3")} ${theme.fg("muted", `Applying ${config.applyingLabel}...`)}`], { isPartial: true });
  }
  const output = getTextOutput(result);
  if (context.isError || result?.isError) {
    if (reasonixCollapsed) {
      const errorText = stripAnsi(output).trim() || "Error";
      setCompactBoxedFooter(context.state, `${theme.fg("error", errorText)} ${theme.fg("dim", "\xB7")} ${formatQuickEditFooter(theme, context, output)}`, { isError: true });
      return { invalidate() {
      }, render: () => [] };
    }
    return renderBoxedToolResult(theme, () => [theme.fg("error", stripAnsi(output).trim() || "Error")], {
      footerLines: [formatQuickEditFooter(theme, context, output)],
      isError: true
    });
  }
  const diff = extractQuickEditDiff(output);
  if (!diff) {
    const fallback = stripAnsi(output).trim() || config.fallbackLabel;
    if (reasonixCollapsed) {
      setCompactBoxedFooter(context.state, `${theme.fg("muted", fallback)} ${theme.fg("dim", "\xB7")} ${formatQuickEditFooter(theme, context, output)}`);
      return { invalidate() {
      }, render: () => [] };
    }
    return renderBoxedToolResult(theme, () => [`${theme.fg("dim", "\u21B3")} ${theme.fg("muted", fallback)}`], {
      footerLines: [formatQuickEditFooter(theme, context, output)]
    });
  }
  const rows = buildSplitRows(diff);
  const argPath = String(context?.args?.path ?? "");
  const language = argPath ? getLanguageFromPath4(argPath) : void 0;
  const shouldHighlight = Boolean(language) && diff.length <= MAX_HIGHLIGHT_DIFF_CHARS2 && rows.length <= MAX_HIGHLIGHT_DIFF_ROWS2;
  const { additions, removals } = countDiffStats(diff);
  const meter = renderDiffMeter(theme, additions, removals);
  const summary = `${theme.fg("dim", "\u21B3")} ${theme.fg("muted", "diff")} ${theme.fg("toolDiffAdded", `+${additions}`)} ${theme.fg("toolDiffRemoved", `-${removals}`)} ${theme.fg("muted", "split")}` + (meter ? ` ${meter}` : "");
  if (reasonixCollapsed) {
    setCompactBoxedFooter(context.state, `${summary} ${theme.fg("dim", "\xB7")} ${formatQuickEditFooter(theme, context, output)}`);
    return { invalidate() {
    }, render: () => [] };
  }
  const maxRows = expanded ? 160 : 36;
  const split = new SplitDiffComponent(theme, rows, maxRows, shouldHighlight ? language : void 0);
  return renderBoxedToolResult(theme, {
    render(width) {
      const safeWidth = Math.max(20, width);
      const headerLines = new Text3(summary, 0, 0).render(safeWidth);
      return [...headerLines, ...split.render(safeWidth)];
    },
    invalidate() {
      split.invalidate();
    }
  }, {
    footerLines: [formatQuickEditFooter(theme, context, output)]
  });
}
function installQuickEditRenderer(ToolExecutionComponentClass) {
  const proto = ToolExecutionComponentClass?.prototype;
  if (!proto) return;
  if (!proto[RESULT_PATCHED] && typeof proto.getResultRenderer === "function") {
    proto[RESULT_PATCHED] = true;
    const baseGetResultRenderer = proto.getResultRenderer;
    proto.getResultRenderer = function patchedQuickEditResultRenderer(...args) {
      const config = getQuickEditToolConfig(this.toolName);
      if (config) return (result, options, theme, context = {}) => renderQuickEditResult(result, options, theme, config, context);
      return baseGetResultRenderer.apply(this, args);
    };
  }
  if (!proto[CALL_PATCHED] && typeof proto.getCallRenderer === "function") {
    proto[CALL_PATCHED] = true;
    const baseGetCallRenderer = proto.getCallRenderer;
    proto.getCallRenderer = function patchedQuickEditCallRenderer(...args) {
      const config = getQuickEditToolConfig(this.toolName);
      if (config) return (args2, theme, context = {}) => renderQuickEditCall(args2, theme, config, context);
      return baseGetCallRenderer.apply(this, args);
    };
  }
}

// tool-tags/resume-tool-refresh.ts
var PATCHED14 = Symbol.for("pi-droid-styling.resume-tool-refresh.patched");
var RUNTIME_STATE = Symbol.for("pi-droid-styling.resume-tool-refresh.runtime-state");
var PENDING_TIMER = Symbol.for("pi-droid-styling.resume-tool-refresh.pending-timer");
var VIRTUALIZED_CHAT_STATE2 = Symbol.for("pi-droid-styling.virtualized-chat.state");
function collectChatChildren(mode) {
  const chat = mode.chatContainer;
  if (!chat) return [];
  const hidden = chat[VIRTUALIZED_CHAT_STATE2]?.hiddenChildren;
  const visible = Array.isArray(chat.children) ? chat.children : [];
  return [...Array.isArray(hidden) ? hidden : [], ...visible];
}
function refreshRestoredTools(mode, expectedSession) {
  if (!mode.session || mode.session !== expectedSession) return;
  const getDefinition = mode.session.getToolDefinition;
  if (typeof getDefinition !== "function") return;
  let refreshed = 0;
  const seen = /* @__PURE__ */ new Set();
  for (const candidate of collectChatChildren(mode)) {
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) continue;
    seen.add(candidate);
    const component = candidate;
    if (typeof component.toolName !== "string" || typeof component.updateDisplay !== "function") continue;
    component.toolDefinition = getDefinition.call(mode.session, component.toolName);
    component.updateDisplay();
    refreshed++;
  }
  if (refreshed > 0) mode.ui?.requestRender?.();
}
function installResumeToolRefresh(InteractiveModeClass) {
  const proto = InteractiveModeClass?.prototype;
  if (!proto) return;
  proto[RUNTIME_STATE] = { refresh: refreshRestoredTools };
  if (proto[PATCHED14]) return;
  proto[PATCHED14] = true;
  const baseRenderCurrentSessionState = proto.renderCurrentSessionState;
  if (typeof baseRenderCurrentSessionState !== "function") return;
  proto.renderCurrentSessionState = function patchedRenderCurrentSessionState(...args) {
    const result = baseRenderCurrentSessionState.apply(this, args);
    const expectedSession = this.session;
    if (this[PENDING_TIMER]) clearTimeout(this[PENDING_TIMER]);
    this[PENDING_TIMER] = setTimeout(() => {
      this[PENDING_TIMER] = void 0;
      const runtime = proto[RUNTIME_STATE];
      runtime?.refresh(this, expectedSession);
    }, 0);
    return result;
  };
}

// tool-tags/loader-accent.ts
var SPINNER_FRAMES = ["\u28F7", "\u28EF", "\u28DF", "\u287F", "\u28BF", "\u28FB", "\u28FD", "\u28FE"];
var SPINNER_INTERVAL_MS = 80;
var WORKING_MESSAGE_INTERVAL_MS = 400;
var WORKING_SPINNER_COLORS = ["accent"];
var WORKING_STATE_LABELS = {
  working: "Working",
  thinking: "Thinking",
  answering: "Answering",
  running: "Cooking"
};
function themeFg(theme, color2, text) {
  if (!theme?.fg) return text;
  for (const fallbackColor of [color2, "accent", "text"]) {
    try {
      return theme.fg(fallbackColor, text);
    } catch {
    }
  }
  return text;
}
function dotsForStep(step) {
  return ".".repeat(Math.max(0, Math.floor(step)) % 3 + 1);
}
function colorForStep(step) {
  const frameIndex = Math.max(0, Math.floor(step)) % SPINNER_FRAMES.length;
  return WORKING_SPINNER_COLORS[frameIndex % WORKING_SPINNER_COLORS.length] ?? "accent";
}
function renderWorkingMessage(state2, step, theme, messages = WORKING_STATE_LABELS) {
  return themeFg(theme, "muted", `${messages[state2] ?? WORKING_STATE_LABELS[state2]}${dotsForStep(step)}`);
}
function createWorkingIndicatorFrames(theme) {
  return SPINNER_FRAMES.map((frame, index) => themeFg(theme, colorForStep(index), frame));
}
function workingStateForAssistantMessage(message) {
  const content = message.content;
  if (!Array.isArray(content)) return "thinking";
  let hasAnswerText = false;
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const part = item;
    if (part.type === "toolCall") return "running";
    if (part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0) hasAnswerText = true;
  }
  return hasAnswerText ? "answering" : "thinking";
}
function createWorkingLoaderController(ui, messages) {
  let state2 = "working";
  let step = 0;
  let timer;
  const render = () => {
    ui.setWorkingMessage(renderWorkingMessage(state2, step, ui.theme, messages));
  };
  const clearTimer = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = void 0;
  };
  const setState = (nextState) => {
    if (state2 === nextState) return;
    state2 = nextState;
    step = 0;
    render();
  };
  const start = (nextState = "working") => {
    clearTimer();
    state2 = nextState;
    step = 0;
    render();
    timer = setInterval(() => {
      step += 1;
      render();
    }, WORKING_MESSAGE_INTERVAL_MS);
  };
  const stop = () => {
    clearTimer();
    state2 = "working";
    step = 0;
  };
  return {
    configure() {
      ui.setWorkingIndicator({ frames: createWorkingIndicatorFrames(ui.theme), intervalMs: SPINNER_INTERVAL_MS });
      render();
    },
    start,
    setState,
    stop,
    dispose() {
      clearTimer();
    }
  };
}

// tui-padding.ts
var PAD_LEFT = 1;
var PAD_RIGHT = 1;
var PADDING_PREFIX = " ".repeat(PAD_LEFT);
var KITTY_IMAGE_PREFIX3 = "\x1B_G";
var ITERM_IMAGE_PREFIX = "\x1B]1337;File=";
var PATCHED15 = Symbol.for("pi-droid-styling.tui-padding.patched");
var ORIGINAL_RENDER = Symbol.for("pi-droid-styling.tui-padding.original-render");
var FULLSCREEN_LAYOUT_PATCHED = Symbol.for("pi-droid-styling.tui-padding.fullscreen-layout-patched");
var LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node");
function isTerminalImageLine(line) {
  return line.includes(KITTY_IMAGE_PREFIX3) || line.includes(ITERM_IMAGE_PREFIX);
}
function getTuiContentInnerWidth(width) {
  return Math.max(1, width - PAD_LEFT - PAD_RIGHT);
}
function padTuiContentLine(line, width) {
  const padded = `${PADDING_PREFIX}${line}`;
  if (isTerminalImageLine(line)) return padded;
  const targetWidth = Math.max(0, Math.floor(width));
  if (targetWidth === 0) return padded;
  const visible = safeVisibleWidth(padded);
  if (visible > targetWidth) {
    return safeTruncateToWidth(padded, targetWidth, "");
  }
  if (visible < targetWidth) {
    return `${padded}${" ".repeat(targetWidth - visible)}`;
  }
  return padded;
}
var HORIZONTAL_GUTTER = {
  render: () => []
};
function installFullscreenTuiPadding(tui) {
  if (tui?.mode !== "fullscreen" || typeof tui.setLayoutRoot !== "function") return false;
  const root = tui.layoutRoot;
  const originalLayoutNode = root?.[LAYOUT_NODE];
  if (!root || typeof originalLayoutNode !== "function") return false;
  if (root[FULLSCREEN_LAYOUT_PATCHED]) return true;
  const content = {
    render: (width) => root.render(width),
    invalidate: () => root.invalidate?.(),
    [LAYOUT_NODE]: () => originalLayoutNode.call(root)
  };
  root[LAYOUT_NODE] = () => ({
    type: "hstack",
    entries: [
      { component: HORIZONTAL_GUTTER, basis: PAD_LEFT, minSize: PAD_LEFT, maxSize: PAD_LEFT },
      { component: content, basis: 0, grow: 1, shrink: 1, minSize: 1 },
      { component: HORIZONTAL_GUTTER, basis: PAD_RIGHT, minSize: PAD_RIGHT, maxSize: PAD_RIGHT }
    ],
    gap: 0,
    align: "stretch"
  });
  root[FULLSCREEN_LAYOUT_PATCHED] = true;
  tui.requestRender?.(true);
  return true;
}
function installTuiPadding(tui) {
  if (installFullscreenTuiPadding(tui)) return;
  const state2 = tui;
  if (state2[PATCHED15]) return;
  state2[PATCHED15] = true;
  state2[ORIGINAL_RENDER] ??= getOriginalTuiMethod(tui, "render");
  const paddedTuiRender = function paddedTuiRender2(width) {
    const innerWidth = getTuiContentInnerWidth(width);
    const lines = state2[ORIGINAL_RENDER].call(this, innerWidth);
    return lines.map((line) => padTuiContentLine(line, width));
  };
  tui.render = paddedTuiRender;
  rememberTuiMethodWrapper(tui, "render", paddedTuiRender);
}

// footer-patch.ts
import { FooterComponent } from "@earendil-works/pi-coding-agent";
var PATCHED16 = Symbol.for("pi-droid-styling.footer-stats.patched");
var ORIGINAL_RENDER2 = Symbol.for("pi-droid-styling.footer-stats.original-render");
var FOOTER_STATE = Symbol.for("pi-droid-styling.footer-stats.state");
var PATCH_VERSION2 = 5;
function footerState() {
  const globalState = globalThis;
  let state2 = globalState[FOOTER_STATE];
  if (!state2) {
    state2 = { latestStatusLines: [], latestTokenUsageLine: null };
    globalState[FOOTER_STATE] = state2;
  }
  return state2;
}
function sanitizeStatusText(text) {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}
function readExtensionStatusLines(owner) {
  try {
    const statuses = owner?.footerData?.getExtensionStatuses?.();
    if (!(statuses instanceof Map) || statuses.size === 0) return [];
    return Array.from(statuses.entries()).sort(([a], [b]) => String(a).localeCompare(String(b))).map(([, text]) => sanitizeStatusText(String(text ?? ""))).filter(Boolean);
  } catch {
    return [];
  }
}
function formatCompactToken(n) {
  if (n < 1e3) return n.toString();
  if (n < 1e4) return `${(n / 1e3).toFixed(1)}k`;
  if (n < 1e6) return `${Math.round(n / 1e3)}k`;
  if (n < 1e7) return `${(n / 1e6).toFixed(1)}M`;
  return `${Math.round(n / 1e6)}M`;
}
function computeTokenUsageLine(session) {
  if (!session?.sessionManager?.getEntries) return null;
  const entries = session.sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type === "message" && entry?.message?.role === "assistant") {
      const u = entry.message.usage;
      if (!u || entry.message.stopReason === "aborted" || entry.message.stopReason === "error") continue;
      const inp = formatCompactToken(u.input ?? 0);
      const out = formatCompactToken(u.output ?? 0);
      const cacheRead = u.cacheRead ?? 0;
      const cacheWrite = u.cacheWrite ?? 0;
      const cr = formatCompactToken(cacheRead);
      const promptTokens = (u.input ?? 0) + cacheRead + cacheWrite;
      const cacheHitRate = promptTokens > 0 ? cacheRead / promptTokens * 100 : 0;
      return `[\u2191${inp} \u2193${out} R${cr} CH${cacheHitRate.toFixed(1)}%]`;
    }
  }
  return null;
}
function getFooterTokenUsageLine() {
  return footerState().latestTokenUsageLine;
}
function getFooterStatusLine() {
  const statusLines = footerState().latestStatusLines;
  return statusLines.length > 0 ? statusLines.join("  ") : null;
}
function installFooterStatsPatch() {
  const proto = FooterComponent.prototype;
  if (proto[PATCHED16] === PATCH_VERSION2) return;
  const origRender = proto[ORIGINAL_RENDER2] ?? proto.render;
  proto[ORIGINAL_RENDER2] = origRender;
  proto[PATCHED16] = PATCH_VERSION2;
  proto.render = function(width) {
    const lines = origRender.call(this, width);
    const MAX_LEN = 125;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l) continue;
      let sanitized = l;
      if (/[\r\n]/.test(sanitized)) {
        sanitized = sanitized.replace(/[\r\n]+/g, " ");
      }
      if (sanitized.length > MAX_LEN) {
        sanitized = sanitized.slice(0, MAX_LEN - 1) + "\u2026";
      }
      if (sanitized !== l) lines[i] = sanitized;
    }
    const directStatusLines = readExtensionStatusLines(this);
    const statusLines = directStatusLines.length > 0 ? directStatusLines : lines.slice(2).filter((line) => Boolean(line?.trim()));
    if (statusLines.length > 0) footerState().latestStatusLines = statusLines;
    footerState().latestTokenUsageLine = computeTokenUsageLine(this.session);
    return [];
  };
}

// widgets/pi-tasks-widget.ts
var PATCH_STATE = Symbol.for("pi-droid-styling.pi-tasks-widget.state");
var WRAPPED_FACTORY = Symbol.for("pi-droid-styling.pi-tasks-widget.factory");
var WRAPPED_COMPONENT = Symbol.for("pi-droid-styling.pi-tasks-widget.component");
var SPINNER_PATTERN = /[✳✴✵✶✷✸✹✺✻✼✽]/g;
var SPINNER_CHARS = "\u2733\u2734\u2735\u2736\u2737\u2738\u2739\u273A\u273B\u273C\u273D";
var TASK_ROW_PATTERN = /^\s*([✳✴✵✶✷✸✹✺✻✼✽✔◼◻])\s+#(\S+)\s+(.+)$/;
var BLOCKED_SUFFIX = " \u203A blocked by ";
var WIDGET_ROW_PREFIX = "   ";
var TASK_CYCLE_MS = 3e3;
function color(theme, colorName, text) {
  return typeof theme?.fg === "function" ? theme.fg(colorName, text) : text;
}
function bold(theme, text) {
  return typeof theme?.bold === "function" ? theme.bold(text) : text;
}
function normalizeWidgetLineForCache(line) {
  return stripAnsi(line).replace(SPINNER_PATTERN, "\u25CF");
}
function parseHeaderCounts(text) {
  const match = text.match(/^(\d+)\s+tasks?\s+\((.*)\)$/);
  if (!match) return void 0;
  const counts = { total: Number(match[1]), completed: 0, inProgress: 0, pending: 0 };
  for (const part of match[2].split(/,\s*/)) {
    const done = part.match(/^(\d+)\s+done$/);
    if (done) {
      counts.completed = Number(done[1]);
      continue;
    }
    const running = part.match(/^(\d+)\s+in progress$/);
    if (running) {
      counts.inProgress = Number(running[1]);
      continue;
    }
    const open = part.match(/^(\d+)\s+open$/);
    if (open) {
      counts.pending = Number(open[1]);
    }
  }
  return counts;
}
function parseTaskWidgetLine(line) {
  const text = stripAnsi(line).trimEnd();
  const headerMatch = text.match(/^●\s+(.+)$/);
  if (headerMatch) {
    const rawText = headerMatch[1];
    return { kind: "header", text: rawText.replace(/\bin progress\b/g, "running"), counts: parseHeaderCounts(rawText) };
  }
  const overflowMatch = text.match(/^\s*…\s+and\s+\d+\s+more$/);
  if (overflowMatch) return { kind: "overflow", text: text.trim() };
  const taskMatch = text.match(TASK_ROW_PATTERN);
  if (!taskMatch) return { kind: "unknown", text };
  const icon = taskMatch[1];
  const status = SPINNER_CHARS.includes(icon) ? "active" : icon === "\u2714" ? "completed" : icon === "\u25FC" ? "running" : "pending";
  let body = taskMatch[3].trimEnd();
  let suffix = "";
  const suffixStart = body.indexOf(BLOCKED_SUFFIX);
  if (suffixStart >= 0) {
    suffix = body.slice(suffixStart);
    body = body.slice(0, suffixStart).trimEnd();
  }
  return {
    kind: "task",
    status,
    id: taskMatch[2],
    text: body,
    suffix
  };
}
var TIME_SEGMENT_PATTERN = /^(?:\d+s|\d+m(?: \d+s)?|\d+h(?: \d+m)?|\d+(?:\.\d+)?[smh](?:\d+[smh])*)$/;
var ARROW_TOKENS_PATTERN = /^(?:[↑↓]\s+\d+(?:\.\d+)?k?)(?:\s+[↑↓]\s+\d+(?:\.\d+)?k?)*$/;
var LEGACY_TOKEN_PATTERN = /^~?\d+(?:\.\d+)?k?(?:\s*(?:tok|tokens?))?$/i;
var TASK_STATS_PATTERN = /\s+\(([^)]*)\)$/;
function isTokenMetrics(text) {
  const trimmed = text.trim();
  return ARROW_TOKENS_PATTERN.test(trimmed) || LEGACY_TOKEN_PATTERN.test(trimmed);
}
function splitDotMetrics(text) {
  const parts = text.split(/\s+·\s+/);
  if (parts.length < 2) return void 0;
  const last = parts[parts.length - 1].trim();
  if (TIME_SEGMENT_PATTERN.test(last)) {
    return { body: parts.slice(0, -1).join(" \xB7 ").trimEnd(), time: last };
  }
  const maybeTime = parts[parts.length - 2].trim();
  if (TIME_SEGMENT_PATTERN.test(maybeTime) && isTokenMetrics(last)) {
    return { body: parts.slice(0, -2).join(" \xB7 ").trimEnd(), time: maybeTime };
  }
  return void 0;
}
function splitStats(text) {
  const parenthesized = text.match(TASK_STATS_PATTERN);
  if (parenthesized) {
    const body = text.slice(0, parenthesized.index).trimEnd();
    const inner = parenthesized[1].trim();
    const metrics = splitDotMetrics(inner);
    if (metrics?.time) return { body, time: metrics.time };
    if (TIME_SEGMENT_PATTERN.test(inner)) return { body, time: inner };
  }
  const trailing = splitDotMetrics(text);
  if (trailing?.time) return trailing;
  return { body: text, time: "" };
}
function visibleWidth2(s) {
  return stripAnsi(s).length;
}
function parseOverflowCount(parsed) {
  const ov = parsed.find((p) => p.kind === "overflow");
  if (!ov) return 0;
  const m = ov.text.match(/(\d+)\s+more/);
  return m ? Number(m[1]) : 0;
}
function getTaskCycleBucket(now = Date.now()) {
  return Math.floor(now / TASK_CYCLE_MS);
}
function pickCurrentTask(tasks, now = Date.now()) {
  const active = tasks.filter((t) => t.status === "active");
  const candidates = active.length > 0 ? active : tasks.filter((t) => t.status === "running");
  if (candidates.length === 0) return void 0;
  return candidates[getTaskCycleBucket(now) % candidates.length];
}
function needsTaskCycle(lines) {
  const tasks = lines.map(parseTaskWidgetLine).filter((p) => p.kind === "task");
  const active = tasks.filter((t) => t.status === "active");
  return active.length > 1 || active.length === 0 && tasks.filter((t) => t.status === "running").length > 1;
}
function getCounts(parsed, tasks) {
  const header = parsed.find((p) => p.kind === "header" && Boolean(p.counts));
  if (header) return header.counts;
  return {
    total: tasks.length + parseOverflowCount(parsed),
    completed: tasks.filter((t) => t.status === "completed").length,
    inProgress: tasks.filter((t) => t.status === "active" || t.status === "running").length,
    pending: tasks.filter((t) => t.status === "pending").length
  };
}
function renderCompactLine(parsed, theme, width) {
  const renderWidth = Math.max(1, Math.floor(width));
  const tasks = parsed.filter((p) => p.kind === "task");
  const counts = getCounts(parsed, tasks);
  const total = counts.total;
  const label = `${WIDGET_ROW_PREFIX}${color(theme, "accent", "\u25CF")} ${color(theme, "accent", bold(theme, "Tasks"))}`;
  if (tasks.length === 0 && total === 0) {
    return [`${label}${color(theme, "dim", " \xB7 idle")}`];
  }
  const blocked = tasks.filter((t) => Boolean(t.suffix)).length;
  const current = pickCurrentTask(tasks);
  const allDone = counts.completed === total && total > 0;
  const tailParts = [];
  if (allDone) {
    tailParts.push(color(theme, "success", " done"));
  } else if (!current) {
    tailParts.push(color(theme, "dim", " idle"));
  }
  const running = counts.inProgress;
  const runningText = running > 0 ? ` \xB7 ${running} running` : "";
  tailParts.push(color(theme, "dim", ` (${counts.completed}/${total} done${runningText})`));
  if (blocked > 0) tailParts.push(color(theme, "dim", ` ${blocked} blocked`));
  const tail = tailParts.join("");
  if (!current || allDone) {
    const base = `${label}${tail}`;
    return [visibleWidth2(base) > renderWidth ? safeTruncateToWidth(base, renderWidth, "\u2026") : base];
  }
  const marker = color(theme, "accent", bold(theme, "\u203A "));
  const idPrefix = color(theme, "dim", `[${current.id}] `);
  const spacer = " ";
  const parsedCurrent = splitStats(current.text);
  let body = parsedCurrent.body.replace(/…$/, "");
  let timeStyled = parsedCurrent.time ? color(theme, "dim", ` \xB7 ${parsedCurrent.time}`) : "";
  let timeWidth = visibleWidth2(timeStyled);
  const fixedWidth = visibleWidth2(label) + visibleWidth2(spacer) + visibleWidth2(marker) + visibleWidth2(idPrefix) + visibleWidth2(tail);
  const budget = renderWidth - fixedWidth;
  if (budget < 1) {
    const base = `${label}${tail}`;
    return [visibleWidth2(base) > renderWidth ? safeTruncateToWidth(base, renderWidth, "\u2026") : base];
  }
  if (budget - timeWidth < 1 && timeStyled) {
    timeStyled = "";
    timeWidth = 0;
  }
  const bodyBudget = Math.max(1, budget - timeWidth);
  if (visibleWidth2(body) > bodyBudget) {
    body = safeTruncateToWidth(body, bodyBudget, "\u2026");
  }
  return [`${label}${spacer}${marker}${idPrefix}${body}${timeStyled}${tail}`];
}
function stylePiTasksWidgetLines(lines, theme, width, style = "default") {
  if (style === "compact") {
    return renderCompactLine(lines.map(parseTaskWidgetLine), theme, Math.max(1, Math.floor(width)));
  }
  return lines;
}
function getRenderWidth(args, tui) {
  const first = args[0];
  if (typeof first === "number" && Number.isFinite(first)) return first;
  const columns = tui?.terminal?.columns;
  return typeof columns === "number" && Number.isFinite(columns) ? columns : 80;
}
function wrapTaskWidgetComponent(component, tui, theme, style) {
  if (!component || typeof component.render !== "function") return component;
  const meta = component[WRAPPED_COMPONENT];
  if (meta && meta.style === style) return component;
  const baseRender = meta ? meta.baseRender : component.render.bind(component);
  component[WRAPPED_COMPONENT] = { baseRender, style };
  let cachedKey = "";
  let cachedLines;
  component.render = (...args) => {
    const lines = baseRender(...args);
    if (!Array.isArray(lines)) return lines;
    const width = getRenderWidth(args, tui);
    const cycleKey = style === "compact" && needsTaskCycle(lines) ? `
cycle:${getTaskCycleBucket()}` : "";
    const cacheKey = `${width}
${style}${cycleKey}
${lines.map(normalizeWidgetLineForCache).join("\n")}`;
    if (cachedLines && cachedKey === cacheKey) return cachedLines;
    cachedKey = cacheKey;
    cachedLines = stylePiTasksWidgetLines(lines, theme, width, style);
    return cachedLines;
  };
  return component;
}
function wrapTaskWidgetFactory(factory, style) {
  const meta = factory[WRAPPED_FACTORY];
  if (meta && meta.style === style) return factory;
  const base = meta ? meta.base : factory;
  const wrapped = ((tui, theme) => wrapTaskWidgetComponent(base(tui, theme), tui, theme, style));
  wrapped[WRAPPED_FACTORY] = { base, style };
  return wrapped;
}
function styleStaticTaskWidgetLines(content, theme, style, width = 80) {
  return stylePiTasksWidgetLines(content, theme ?? {}, width, style);
}
function installPiTasksWidgetStyling(sessionUi, style = "default") {
  if (!sessionUi || typeof sessionUi.setWidget !== "function") return void 0;
  const host = sessionUi;
  if (style === "default") {
    host[PATCH_STATE]?.dispose();
    return void 0;
  }
  if (host[PATCH_STATE]) return () => host[PATCH_STATE]?.dispose();
  const originalSetWidget = sessionUi.setWidget;
  const patchedSetWidget = function patchedPiTasksSetWidget(key, content, options) {
    if (key !== "tasks" || content === void 0) {
      return originalSetWidget.call(sessionUi, key, content, options);
    }
    if (Array.isArray(content)) {
      const cols = sessionUi.terminal?.columns;
      const width = typeof cols === "number" && Number.isFinite(cols) ? Math.max(1, Math.floor(cols)) : 80;
      return originalSetWidget.call(sessionUi, key, styleStaticTaskWidgetLines(content, sessionUi.theme, style, width), options);
    }
    if (typeof content === "function") {
      return originalSetWidget.call(sessionUi, key, wrapTaskWidgetFactory(content, style), options);
    }
    return originalSetWidget.call(sessionUi, key, content, options);
  };
  const state2 = {
    dispose() {
      if (sessionUi.setWidget === patchedSetWidget) sessionUi.setWidget = originalSetWidget;
      delete host[PATCH_STATE];
    }
  };
  host[PATCH_STATE] = state2;
  sessionUi.setWidget = patchedSetWidget;
  return () => state2.dispose();
}

// index.ts
var syncThemeExtrasForCurrentSession;
var restoreTerminalBackgroundForCurrentSession;
var disposePiTasksWidgetStylingForCurrentSession;
var FORCE_THEME_SCAN_INTERVAL_MS = 1e3;
var setAssistantUpdateRenderRequesterForCurrentSession;
function index_default(pi) {
  suppressStartupModelScopeLog();
  installStartupUiPatch(InteractiveMode);
  let currentVisibleChatTail = 30;
  installInteractiveChatVirtualization(InteractiveMode, () => currentVisibleChatTail);
  let sessionRunSerial = 0;
  let toolCallTagsRegistration;
  const ensureToolCallTagsRegistered = () => {
    toolCallTagsRegistration ??= registerToolCallTags(pi).catch((error) => {
      toolCallTagsRegistration = void 0;
      throw error;
    });
    return toolCallTagsRegistration;
  };
  void ensureToolCallTagsRegistered();
  let currentThinkingLevel;
  let assistantSpeedTracker;
  let workingStateForAssistantMessageForCurrentSession;
  let workingLoaderController;
  const runningToolCalls = /* @__PURE__ */ new Set();
  const isStaleContextError = (error) => error instanceof Error && error.message.includes("stale after session replacement or reload");
  pi.on("before_agent_start", () => {
    workingLoaderController?.setState("working");
  });
  pi.on("agent_start", () => {
    runningToolCalls.clear();
    workingLoaderController?.start("working");
  });
  pi.on("message_start", (event) => {
    assistantSpeedTracker?.handleMessageStart(event.message);
    if (event.message.role === "assistant" && runningToolCalls.size === 0) {
      workingLoaderController?.setState(workingStateForAssistantMessageForCurrentSession?.(event.message) ?? "answering");
    }
  });
  pi.on("message_update", (event) => {
    assistantSpeedTracker?.handleMessageUpdate(event.message);
    if (event.message.role === "assistant" && runningToolCalls.size === 0) {
      workingLoaderController?.setState(workingStateForAssistantMessageForCurrentSession?.(event.message) ?? "answering");
    }
  });
  pi.on("thinking_level_select", (event) => {
    currentThinkingLevel = event.level;
  });
  pi.on("message_end", (event) => {
    assistantSpeedTracker?.handleMessageEnd(event.message);
  });
  pi.on("tool_execution_start", (event) => {
    runningToolCalls.add(event.toolCallId);
    workingLoaderController?.setState("running");
  });
  pi.on("tool_execution_end", (event) => {
    runningToolCalls.delete(event.toolCallId);
  });
  pi.on("agent_end", () => {
    runningToolCalls.clear();
    workingLoaderController?.stop();
  });
  pi.on("session_shutdown", (_event, ctx) => {
    sessionRunSerial++;
    profileCount("session.shutdown");
    flushProfile("session_shutdown");
    syncThemeExtrasForCurrentSession = void 0;
    restoreTerminalBackgroundForCurrentSession?.();
    restoreTerminalBackgroundForCurrentSession = void 0;
    setAssistantUpdateRenderRequesterForCurrentSession?.(void 0);
    workingLoaderController?.dispose();
    workingLoaderController = void 0;
    disposePiTasksWidgetStylingForCurrentSession?.();
    disposePiTasksWidgetStylingForCurrentSession = void 0;
    runningToolCalls.clear();
    try {
      ctx.ui.setEditorComponent(void 0);
    } catch {
    }
  });
  pi.on("session_start", async (_event, ctx) => {
    const sessionRun = ++sessionRunSerial;
    const isCurrentSessionRun = () => sessionRun === sessionRunSerial;
    profileCount("session.start");
    if (!isCurrentSessionRun()) return;
    assistantSpeedTracker ??= createAssistantSpeedTracker();
    const tracker = assistantSpeedTracker;
    workingStateForAssistantMessageForCurrentSession = workingStateForAssistantMessage;
    setAssistantUpdateRenderRequesterForCurrentSession = setAssistantUpdateRenderRequester;
    installCompactToolSpacing();
    installDefaultBadge();
    installQuickEditRenderer(ToolExecutionComponent3);
    installResumeToolRefresh(InteractiveMode);
    installMarkdownCodeBlockRenderer();
    installFooterStatsPatch();
    installCoreMessageBlockStyling({
      CompactionSummaryMessageComponent,
      SkillInvocationMessageComponent,
      BranchSummaryMessageComponent,
      CustomMessageComponent
    });
    const sessionUi = ctx.ui;
    const sessionCwd = ctx.cwd;
    setAssistantUpdateRenderRequester(void 0);
    setCompactStartupHeader(sessionUi, sessionCwd);
    tracker.resetSession();
    workingLoaderController?.dispose();
    workingLoaderController = void 0;
    runningToolCalls.clear();
    try {
      currentThinkingLevel = pi.getThinkingLevel();
    } catch (error) {
      if (!isStaleContextError(error)) throw error;
      currentThinkingLevel = void 0;
    }
    const config = loadConfig();
    setPresentationStyle(config.presentationStyle);
    currentVisibleChatTail = config.visibleChatTail;
    await ensureToolCallTagsRegistered();
    if (!isCurrentSessionRun()) return;
    const renderDebug = process.env.PI_DROID_RENDER_DEBUG === "1";
    const userZoneStyle = resolveUserZoneStyle(config.userZoneStyle);
    disposePiTasksWidgetStylingForCurrentSession?.();
    disposePiTasksWidgetStylingForCurrentSession = installPiTasksWidgetStyling(sessionUi, config.tasksWidgetStyle);
    restoreTerminalBackgroundForCurrentSession?.();
    restoreTerminalBackgroundForCurrentSession = void 0;
    workingLoaderController = createWorkingLoaderController(sessionUi, config.customWorkingMessage);
    workingLoaderController.configure();
    const initialToolsExpanded = Boolean(config.alwaysExpanded);
    if (sessionUi.getToolsExpanded() !== initialToolsExpanded) {
      sessionUi.setToolsExpanded(initialToolsExpanded);
    }
    installAssistantStreamingMarkdownCache(AssistantMessageComponent2);
    installAssistantMessagePrefix(sessionUi.theme);
    installUserMessagePrefix(sessionUi.theme);
    installAssistantUpdateDebounce(AssistantMessageComponent2);
    installToolExecutionUpdateDebounce(ToolExecutionComponent3);
    installFinishedRenderCache(AssistantMessageComponent2, ToolExecutionComponent3);
    let lastForcedThemeScanAt = 0;
    const syncThemeExtras = (force = false) => {
      if (force) {
        const now = Date.now();
        if (lastForcedThemeScanAt > 0 && now - lastForcedThemeScanAt < FORCE_THEME_SCAN_INTERVAL_MS) {
          force = false;
        } else {
          lastForcedThemeScanAt = now;
        }
      }
      setFullTheme(sessionUi.theme, force);
    };
    syncThemeExtrasForCurrentSession = syncThemeExtras;
    syncThemeExtras(true);
    const interactiveModePrototype = InteractiveMode.prototype;
    const originalUpdateEditorBorderColor = interactiveModePrototype.updateEditorBorderColor;
    if (typeof originalUpdateEditorBorderColor === "function" && !originalUpdateEditorBorderColor.__droidTerminalThemeSync) {
      const wrappedUpdateEditorBorderColor = function(...args) {
        syncThemeExtrasForCurrentSession?.(true);
        return originalUpdateEditorBorderColor.apply(this, args);
      };
      wrappedUpdateEditorBorderColor.__droidTerminalThemeSync = true;
      interactiveModePrototype.updateEditorBorderColor = wrappedUpdateEditorBorderColor;
    }
    setDefaultBadgeTheme(sessionUi.theme);
    setToolSpacingTheme(sessionUi.theme);
    setCoreMessageBlockTheme(sessionUi.theme);
    sessionUi.setEditorComponent((tui, theme, kb) => {
      const uiTheme = sessionUi.theme ?? theme;
      restoreTerminalBackgroundForCurrentSession?.();
      restoreTerminalBackgroundForCurrentSession = applyTerminalPageBackgroundOsc11(uiTheme, tui.terminal, { force: config.forceOSC11 });
      installRenderThrottle(tui);
      setAssistantUpdateRenderRequester(() => tui.requestRender());
      virtualizeChatContainer(tui, config.visibleChatTail);
      installTuiPadding(tui);
      installRenderAutowrapGuard(tui);
      const fetchBranch = createGitBranchFetcher(sessionCwd, () => tui.requestRender());
      installRenderWidthGuard(tui);
      installRenderFrameBackground(tui, uiTheme);
      installRenderPhysicalSync(tui);
      if (renderDebug) installRenderFrameDebug(tui);
      return new BoxEditor(
        tui,
        theme,
        kb,
        uiTheme,
        sessionCwd,
        () => {
          try {
            return ctx.getContextUsage();
          } catch (error) {
            if (isStaleContextError(error)) return void 0;
            throw error;
          }
        },
        () => {
          try {
            const model = ctx.model;
            return model ? {
              provider: model.provider,
              id: model.id,
              name: model.name,
              reasoning: model.reasoning,
              thinkingLevel: currentThinkingLevel
            } : void 0;
          } catch (error) {
            if (isStaleContextError(error)) return void 0;
            throw error;
          }
        },
        fetchBranch,
        () => tracker.getWordsPerSecond(),
        getFooterStatusLine,
        () => "footer",
        userZoneStyle,
        config.inputBox.style,
        getFooterTokenUsageLine
      );
    });
  });
}
export {
  index_default as default
};
