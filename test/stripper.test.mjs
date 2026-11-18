/**
* Test harness for the comment stripper. Run: node test/stripper.test.mjs
* Asserts lexical correctness on tricky inputs; exits nonzero on failure.
*/
import assert from "node:assert/strict";
import { stripComments } from "../lib/stripper.js";

let passed = 0;
let failed = 0;
/** @param {string} name @param {() => void} fn */
function test(name, fn) {
	try {
		fn();
		passed += 1;
		console.log(`  ok  ${name}`);
	} catch (error) {
		failed += 1;
		console.error(`FAIL  ${name}\n      ${error.message}`);
	}
}

const T = "/tmp/example.ts";

test("full-line // comments vanish", () => {
	const input = "// header\nconst a = 1;\n// footer\n";
	assert.equal(stripComments(input, T).output, "const a = 1;\n");
});

test("trailing // cut at column", () => {
	const input = "const a = 1; // trailing note\nkeep();\n";
	const r = stripComments(input, T);
	assert.equal(r.output, "const a = 1;\nkeep();\n");
});

test("// inside strings survives", () => {
	const input = 'const url = "http://example.com";\n';
	assert.equal(stripComments(input, T).changed, false);
});

test("// inside template literals survives", () => {
	const input = "const t = `https://host/${path}`;\n";
	assert.equal(stripComments(input, T).changed, false);
});

test("/* */ single-line with code after keeps code", () => {
	const input = "/* init */ start();\n";
	assert.equal(stripComments(input, T).output, "start();\n");
});

test("multi-line block comment removed, suffix kept", () => {
	const input = "setup(); /* begin\n   middle\n   end */ teardown();\n";
	assert.equal(stripComments(input, T).output, "setup(); \nteardown();\n".replace(" \ntear", "\ntear"));
});

test("regex literal /..../ not treated as division then comment", () => {
	const input = "return /ab\\/c/.test(x); // done\n";
	const r = stripComments(input, T);
	assert.equal(r.output, "return /ab\\/c/.test(x);\n");
});

test("division after identifier stays division", () => {
	const input = "const q = total/2; // half\n";
	assert.equal(stripComments(input, T).output, "const q = total/2;\n");
});

test("block comment that looks like URL divider inside string", () => {
	const input = 'rebase(a, "a/*b*/c");\n';
	assert.equal(stripComments(input, T).changed, false);
});

test("CRLF newline convention preserved", () => {
	const input = "// gone\r\nconst a = 1;\r\n";
	const r = stripComments(input, T);
	assert.equal(r.output, "const a = 1;\r\n");
});

test("non-code extension skipped by path", () => {
	const input = "# not even js\nconst a = 1;\n";
	assert.equal(stripComments(input, "/tmp/x.json").changed, false);
});

test("empty content passthrough", () => {
	assert.deepEqual(stripComments("", T), { output: "", changed: false });
});

test("nested-looking object braces with regex values", () => {
	const input = "const o = { re: /x\\/y/, n: 3 }; // tail\n";
	assert.equal(stripComments(input, T).output, "const o = { re: /x\\/y/, n: 3 };\n");
});

test("template interpolation containing braces and slash-comment-like text", () => {
	const input = "const s = `a${ {u: 'q//r'} }b`;\nclean();\n";
	assert.equal(stripComments(input, T).changed, false);
});

test("widow blank collapse to one", () => {
	const input = "alpha();\n// one\n// two\n// three\nbeta();\n";
	const out = stripComments(input, T).output;
	assert.equal(out, "alpha();\nbeta();\n");
});

test("indentation of surviving lines untouched", () => {
	const input = "function f() {\n\t// peek\n\tif (x) {\n\t\twork(); // note\n\t}\n}\n";
	assert.equal(stripComments(input, T).output, "function f() {\n\tif (x) {\n\t\twork();\n\t}\n}\n");
});

test("unterminated block comment at EOF handled", () => {
	const input = "code();\n/* dangling";
	const r = stripComments(input, T);
	assert.ok(r.changed);
	assert.ok(r.output.startsWith("code();"));
});

test("Java-style doc removal via block scan", () => {
	const input = "public class A { // class comment\n    int x = 1; // field\n}\n";
	assert.equal(stripComments(input, "/tmp/A.java").output, "public class A {\n    int x = 1;\n}\n");
});

test("CSS-ish content keeps behavior consistent", () => {
	const input = ".sel { color: red; } /* why */\n";
	assert.equal(stripComments(input, "/tmp/a.css").output, ".sel { color: red; }\n");
});

test("no-op when only string contains markers", () => {
	const input = "log('https://x');\n";
	assert.equal(stripComments(input, T).changed, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
