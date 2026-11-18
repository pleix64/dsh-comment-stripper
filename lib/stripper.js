/**
* Language-aware comment stripping for line comments (double slash) and block
* comments (slash-star through star-slash).
*
* One scanner walks the text with real lexical state (strings, template
* literals with dollar-brace nesting, regex-vs-division disambiguation),
* recording the character ranges holding comments. A builder then reassembles
* output:
*
* - a full-line comment line disappears entirely;
* - a trailing comment after code is cut off at its start column;
* - interior lines of multi-line block comments vanish; the closing line keeps
*   any code suffix after the close marker;
* - widow blank lines left behind collapse to at most one;
* - surviving indentation, the newline convention, and the original
*   trailing-newline shape are preserved exactly.
*
* @module dsh-comment-stripper/stripper
*/

/** Lexical modes of the scanner. */
const CODE = 0, LINE_COMMENT = 1, BLOCK_COMMENT = 2, SINGLE = 3, DOUBLE = 4, TEMPLATE = 5, REGEX = 6;

/** Extensions whose files carry line or block comments. */
const CODE_EXTENSIONS = new Set([
	".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx",
	".java", ".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".hh", ".cs", ".go",
	".rs", ".swift", ".kt", ".kts", ".scala", ".groovy", ".php", ".dart",
	".scss", ".sass", ".less", ".css"
]);

/** Tokens after which `/` starts a regex literal rather than division. */
const PRE_REGEX_KEYWORDS = new Set([
	"return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
	"throw", "case", "do", "else", "yield", "await"
]);

/**
* Whether a path is treated as comment-bearing code by extension.
* @param {string} filePath - model-supplied path (any spelling).
*/
export function isCommentBearingPath(filePath) {
	const match = /\.([A-Za-z0-9]+)$/u.exec(String(filePath ?? ""));
	if (match === null) return false;
	return CODE_EXTENSIONS.has(`.${match[1].toLowerCase()}`);
}

/**
* Scan comment ranges over `text`.
* @param {string} text - full content.
* @returns {Array<{start:number,end:number}>} half-open offsets of every
*   comment, including both markers; an unterminated line comment runs to EOF.
*/
export function scanComments(text) {
	const ranges = [];
	let mode = CODE;
	let rangeStart = -1;
	let regexClass = false;
	/** Brace depth shared by object-literal regex positions and template `${}` nesting. */
	let braceDepth = 0;
	/** Stack of TEMPLATE markers entered via `${`; a final `}` pops each frame. */
	const templateStack = [];
	/** Last significant token class since the last newline: drives regex/division. */
	let lastSignificant = "";
	let lastWord = "";

	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		const next = i + 1 < text.length ? text[i + 1] : "";
		switch (mode) {
			case CODE: {
				if (ch === "/" && next === "/") {
					rangeStart = i;
					mode = LINE_COMMENT;
					i += 1;
					continue;
				}
				if (ch === "/" && next === "*") {
					rangeStart = i;
					mode = BLOCK_COMMENT;
					i += 1;
					continue;
				}
				if (ch === "'" || ch === '"') {
					mode = ch === "'" ? SINGLE : DOUBLE;
					lastSignificant = ch;
					continue;
				}
				if (ch === "`") {
					mode = TEMPLATE;
					lastSignificant = ch;
					continue;
				}
				if (ch === "/" && canStartRegex(lastSignificant, lastWord, braceDepth)) {
					mode = REGEX;
					regexClass = false;
					lastSignificant = "/";
					continue;
				}
				if (ch === "\n") {
					lastWord = "";
					lastSignificant = "";
					continue;
				}
				if (/[A-Za-z_$]/u.test(ch)) {
					const m = /^[A-Za-z_$][A-Za-z0-9_$]*/u.exec(text.slice(i));
					if (m !== null) {
						lastWord = m[0];
						lastSignificant = "ident";
						i += m[0].length - 1;
						continue;
					}
				}
				if (/[0-9]/u.test(ch)) {
					lastSignificant = "ident"; // numbers divide, too
					i += /^[0-9._exabEfLoN]*[0-9n_]/iu.exec(text.slice(i))?.[0].length ? (/^[0-9._A-Fa-fxboEe+-]*[0-9a-fA-Fn_]/u.exec(text.slice(i))?.[0].length ?? 1) - 1 : 0;
					continue;
				}
				if (!/\s/u.test(ch)) {
					if (ch === "{") {
						braceDepth += 1;
						lastSignificant = ch;
						continue;
					}
					if (ch === "}") {
						braceDepth = Math.max(0, braceDepth - 1);
						if (braceDepth === 0 && templateStack.length > 0 && templateStack[templateStack.length - 1] === "interp") {
							templateStack.pop();
							mode = TEMPLATE; // close of a `${ … }` hole
						}
						lastSignificant = ch;
						continue;
					}
					if ("([{,:;=<>?:&|!+-*/%~^".includes(ch)) lastSignificant = ch;
					else lastSignificant = ch;
				}
				continue;
			}
			case LINE_COMMENT: {
				if (ch === "\n") {
					ranges.push({ start: rangeStart, end: i });
					rangeStart = -1;
					mode = CODE;
					lastWord = "";
					lastSignificant = "";
				}
				continue;
			}
			case BLOCK_COMMENT: {
				if (ch === "*" && next === "/") {
					ranges.push({ start: rangeStart, end: i + 2 });
					rangeStart = -1;
					mode = CODE;
					i += 1;
				}
				continue;
			}
			case SINGLE: {
				if (ch === "\\") { i += 1; continue; }
				if (ch === "\n") mode = CODE;
				else if (ch === "'") { mode = CODE; lastSignificant = "'"; }
				continue;
			}
			case DOUBLE: {
				if (ch === "\\") { i += 1; continue; }
				if (ch === "\n") mode = CODE;
				else if (ch === '"') { mode = CODE; lastSignificant = '"'; }
				continue;
			}
			case TEMPLATE: {
				if (ch === "\\") { i += 1; continue; }
				if (ch === "`") { mode = CODE; lastSignificant = "`"; continue; }
				if (ch === "$" && next === "{") {
					braceDepth += 1;
					templateStack.push("interp");
					mode = CODE;
					i += 1;
				}
				continue;
			}
			case REGEX: {
				if (ch === "\\") { i += 1; continue; }
				if (ch === "[") regexClass = true;
				else if (ch === "]") regexClass = false;
				else if (ch === "/" && !regexClass) { mode = CODE; lastSignificant = "/"; }
				else if (ch === "\n") { mode = CODE; lastSignificant = ""; }
				continue;
			}
			default: mode = CODE;
		}
	}
	if (rangeStart >= 0 && (mode === LINE_COMMENT || mode === BLOCK_COMMENT)) ranges.push({ start: rangeStart, end: text.length });
	return ranges;
}

/**
* Conservative regex-vs-division decision at a `/` in code position.
* Regexes follow openers, operators, commas, semicolons, colons, keywords,
* return-style words, and statement-start positions; division follows
* identifiers, numbers, closers, and string/regex/template ends.
*/
function canStartRegex(lastSignificant, lastWord, braceDepth) {
	void braceDepth;
	if (lastSignificant === "") return true; // statement start
	if (lastWord !== "" && PRE_REGEX_KEYWORDS.has(lastWord)) return true;
	if (lastSignificant === "`" || lastSignificant === '"' || lastSignificant === "'") return true; // e.g. `"abc".replace(/x/, ...)`
	return "([{,:;=<>?&|!+-*/%~^".includes(lastSignificant);
}

/**
* Rebuild line-based output from comment ranges.
* @param {string} text - original content.
* @param {Array<{start:number,end:number}>} ranges - comment ranges.
* @returns {{ output: string, changed: boolean }}
*/
function rebuild(text, ranges) {
	const usesCRLF = text.includes("\r\n");
	const eol = usesCRLF ? /\r?\n/u : /\n/u;
	const terminator = usesCRLF ? "\r\n" : "\n";
	const lines = text.split(eol);

	const lineStarts = [0];
	for (let index = 0; index < lines.length - 1; index += 1) lineStarts.push(lineStarts[index] + lines[index].length + 1);
	const lineOf = (offset) => binaryFind(lineStarts, offset);

	/** @type {Set<number>} */
	const removeLines = new Set();
	/** @type {Map<number, number>} prefix cut points: keep [0, col) of the line. */
	const cutColumns = new Map();
	/** @type {Map<number, string>} keep-suffix-from-column: drop [0, col) plus the range, keep the rest. */
	const suffixFrom = new Map();

	for (const range of ranges) {
		const firstLine = lineOf(range.start);
		const lastLine = lineOf(Math.max(range.start, range.end - 1));
		const lineText = lines[firstLine] ?? "";
		const cutFirst = Math.max(0, range.start - lineStarts[firstLine]);
		const before = lineText.slice(0, cutFirst);
		const codeBefore = /[^ \t]/u.test(before);

		if (codeBefore && firstLine === lastLine) {
			cutColumns.set(firstLine, cutFirst); // trailing comment after code
		} else if (!codeBefore && firstLine === lastLine) {
			const tail = lineText.slice(Math.min(lineText.length, range.end - lineStarts[firstLine]));
			if (/[^ \t]/u.test(tail)) suffixFrom.set(firstLine, range.end - lineStarts[firstLine]); // `/*x*/ foo()` keeps the tail
			else removeLines.add(firstLine);
		} else if (codeBefore) {
			cutColumns.set(firstLine, cutFirst); // opener shares its line with leading code
		} else {
			suffixFrom.set(firstLine, range.end - lineStarts[firstLine]); // opener alone keeps any close-line tail
		}
		if (lastLine > firstLine) {
			for (let line = firstLine + 1; line < lastLine; line += 1) removeLines.add(line);
			suffixFrom.set(lastLine, Math.max(0, range.end - lineStarts[lastLine])); // closing line keeps its suffix
		}
	}

	const rebuilt = [];
	for (let i = 0; i < lines.length; i += 1) {
		if (removeLines.has(i)) continue;
		let line = lines[i];
		if (suffixFrom.has(i)) {
			line = line.slice(Math.min(line.length, suffixFrom.get(i))).replace(/^[ \t]+/u, "");
		} else if (cutColumns.has(i)) {
			line = line.slice(0, cutColumns.get(i)).replace(/[ \t]+$/u, "");
		}
		rebuilt.push(line);
	}

	// Collapse blank-line windows wider than one created by removals.
	const cleaned = [];
	let blanks = 0;
	for (const line of rebuilt) {
		if (line.trim().length === 0) {
			blanks += 1;
			if (blanks > 1) continue;
		} else blanks = 0;
		cleaned.push(line);
	}

	const trimmed = cleaned.join(terminator).replace(/(?:\r?\n)+$/u, "");
	const originalTail = /\r?\n$|\r$|\n$/u.exec(text)?.[0] ?? "";
	const output = originalTail.endsWith("\r\n") ? `${trimmed}\r\n` : originalTail === "" ? trimmed : `${trimmed}\n`;
	return { output, changed: output !== text };
}

/** Binary search: greatest index whose line start is <= offset. */
function binaryFind(lineStarts, offset) {
	let lo = 0;
	for (let hi = lineStarts.length - 1; lo < hi;) {
		const mid = (lo + hi + 1) >> 1;
		if (lineStarts[mid] <= offset) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

/** Cheap structural gate for fragments surviving beside a removed comment. */
function plausibleCodeOrStructure(fragment) {
	return /[{}()[\];=<]|=>|["'`]|\d|[A-Za-z_$][A-Za-z0-9_$]*/u.test(fragment.trim());
}

/**
* Strip `//` and `/* ... *\/` comments from source text. Non-code extensions
* pass through untouched; malformed inputs return unchanged.
* @param {string} text - content about to be written.
* @param {string | undefined} filePath - target path; skips stripping when not code.
* @returns {{ output: string, changed: boolean }}
*/
export function stripComments(text, filePath) {
	if (typeof text !== "string" || text.length === 0) return { output: text, changed: false };
	if (filePath !== undefined && !isCommentBearingPath(filePath)) return { output: text, changed: false };
	if (!/(?:\/\/|\/\*)/u.test(text)) return { output: text, changed: false };
	try {
		const ranges = scanComments(text);
		if (ranges.length === 0) return { output: text, changed: false };
		return rebuild(text, ranges);
	} catch {
		return { output: text, changed: false };
	}
}
