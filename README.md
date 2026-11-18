# dsh-comment-stripper

A [DeepSeek Harness (DSH)](https://github.com/deepseek-ai) plugin that removes
`//` line comments and `/* ... */` block comments from code written through the
filesystem service (`ctx.fs`), so on-disk files stay comment-free — while strings,
template literals, URLs like `https://…`, regex literals and division keep
passing through untouched.

## How it works

The plugin replaces DSH's sandboxed filesystem backend row (`fs-sandbox`) with a
subclass (`CommentStrippingFileSystem`). Every write tool call strips comments
before publication; every edit call strips comments out of its replacement text.
Reads, listings, watches and the workspace-write containment fence are inherited
unchanged from `@deepseek-ai/dsh-fs-sandbox`.

Stripping is lexically aware:

- `//` to end of line, `/* … */` across lines, including doc comments;
- full-line comment lines disappear; trailing comments are cut at their column;
  code after a close marker on the same line is kept;
- single/double quoted strings, template literals with `${}` interpolation,
  and `/regex/` vs. division disambiguation all survive correctly;
- CRLF vs LF, indentation, and the trailing-newline shape are preserved;
- only code extensions are stripped (`.js .ts .jsx .tsx .c .h .cpp .cs .go .rs
  .java .php .css .scss …`); other files pass through untouched;
- any scan or assembly error falls back to writing the original content, so a
  stripper bug can never block a write.

## Install

```sh
dsh plugin --profile web add dsh-comment-stripper
```

Requires Node >= 22.12 and a running DSH whose version satisfies `^0.2.0-rc.1`
(prereleases included). The installer registers the bundle automatically; it
takes effect on the next GUI restart or HMR reload.

## Options

Set under the entry's `config:` in your profile's `cordis.patch.yml`:

| option | default | meaning |
|---|---|---|
| `enabled` | `true` | master switch; `false` makes every write a passthrough |
| `extraExtensions` | `[]` | extra filename extensions treated as code |
| `logChanges` | `false` | emit one info log line per stripping write |

## Self-check

```sh
node test/stripper.test.mjs   # 20 assertions
```

## License

MIT
