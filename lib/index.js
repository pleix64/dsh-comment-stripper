import { SandboxedFileSystem } from "@deepseek-ai/dsh-fs-sandbox";
import { isCommentBearingPath, stripComments } from "./stripper.js";

/**
* `dsh-comment-stripper` — a drop-in filesystem provider.
*
* It replaces the `fs-sandbox` loader row (this package's cordis.patch.yml
* targets the row id), so every `ctx.fs` consumer — the model-facing write /
* edit tools included — routes mutations through this class. `writeText`
* strips line and block comments from UTF-8 content before the inherited
* atomic publication; `editText` strips both sides of the replacement so an
* edit inserting commented code lands comment-free. Reads, stats, and listing
* delegate untouched; containment and escalation behavior are inherited
* verbatim from `@deepseek-ai/dsh-fs-sandbox`.
*
* Only `//` (to end of line) and `/* ... *\/` block comments in code files are
* removed, with full lexical awareness of strings, template literals, and
* regex literals. Non-code extensions pass through unchanged, and any scan or
* assembly error falls back to writing the original content.
*
* @module dsh-comment-stripper
*/

/** Whether the strip attempt changed anything, for one log line. */
function summarizeChange(before, after) {
	const beforeLines = before.split("\n").length;
	const afterLines = after.split("\n").length;
	return `${beforeLines} -> ${afterLines} lines`;
}

/**
* Comment-stripping, sandbox-enforcing filesystem backend.
*
* No `static Config` of its own: the inherited `LocalFileSystem.Config` schema
* (cwd, diffBasisMaxBytes) keeps validating entry config and applying its
* defaults, so this subclass never breaks when the base adds or changes a
* field. The stripper's own options are tolerant optional fields below — a row
* may set them under `config:` without any schema registration.
*/
var CommentStrippingFileSystem = class extends SandboxedFileSystem {
	/** Strip before publication (default true; set false to passthrough all writes). */
	get enabled() {
		return this.config?.enabled !== false;
	}
	/** Extra filename extensions treated as code beyond {@link isCommentBearingPath}. */
	get extraExtensions() {
		return Array.isArray(this.config?.extraExtensions) ? this.config.extraExtensions : [];
	}
	/** Emit one info line per stripping write (default false). */
	get logChanges() {
		return this.config?.logChanges === true;
	}

	/**
	* Strip comments from `content` when the target looks like code and the
	* plugin is enabled. Any internal failure returns the input untouched so a
	* stripper bug can never block a write.
	* @param {import("@deepseek-ai/dsh-fs").FsTarget} target - resolved write target.
	* @param {string} content - new file body.
	* @returns {{ content: string, stripped: boolean }}
	*/
	prepared(target, content) {
		if (!this.enabled || typeof content !== "string" || content.length === 0) return { content, stripped: false };
		try {
			let path = target?.displayPath;
			if (typeof path !== "string") {
				const key = target?.targetKey;
				path = typeof key === "string" ? key : undefined;
			}
			if (!isCommentBearingPath(path)) {
				const extras = this.extraExtensions ?? [];
				const lower = String(path ?? "").toLowerCase();
				if (!extras.some((ext) => lower.endsWith(String(ext).toLowerCase()))) return { content, stripped: false };
			}
			if (!/(?:\/\/|\/\*)/u.test(content)) return { content, stripped: false };
			const { output, changed } = stripComments(content, path);
			return { content: output, stripped: changed };
		} catch {
			return { content, stripped: false };
		}
	}

	async writeText(target, content, expected, signal, sandboxPolicy) {
		const preparedContent = this.prepared(target, content);
		const outcome = await super.writeText(target, preparedContent.content, expected, signal, sandboxPolicy);
		if (preparedContent.stripped && outcome.after !== preparedContent.content) outcome.after = preparedContent.content;
		if (preparedContent.stripped && this.logChanges) {
			this.ctx.logger.info(`comment-stripper: ${outcome.operation} "${outcome.path ?? target?.displayPath}" (${summarizeChange(outcome.before ?? "", outcome.after)})`);
		}
		return outcome;
	}

	async editText(target, edit, expected, signal, sandboxPolicy) {
		if (this.enabled && typeof edit?.newString === "string") {
			const preparedContent = this.prepared(target, edit.newString);
			edit = { ...edit, newString: preparedContent.content };
		}
		return await super.editText(target, edit, expected, signal, sandboxPolicy);
	}
};

/** Cordis plugin identity echoed in loader diagnostics. */
const name = "dsh-comment-stripper";

export { CommentStrippingFileSystem, name };
export default CommentStrippingFileSystem;
