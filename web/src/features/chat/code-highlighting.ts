import type { LangRule, Token, TokenKind } from "@/features/chat/types"

export function normalizeLanguage(raw?: string): string {
  const lang = String(raw || "").trim().toLowerCase()
  if (!lang) return ""
  const alias: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    yml: "yaml",
    cs: "csharp",
  }
  return alias[lang] || lang
}

function keywordRegex(words: string[]): RegExp {
  return new RegExp(`\\b(?:${words.join("|")})\\b`, "y")
}

function rulesForLanguage(language: string): LangRule[] {
  const commonStringRules: LangRule[] = [
    { kind: "string", re: /"(?:\\.|[^"\\])*"/y },
    { kind: "string", re: /'(?:\\.|[^'\\])*'/y },
    { kind: "string", re: /`(?:\\.|[^`\\])*`/y },
  ]
  const commonNumberRules: LangRule[] = [{ kind: "number", re: /\b\d+(?:\.\d+)?\b/y }]
  const commonOperatorRules: LangRule[] = [{ kind: "operator", re: /[{}()[\].,;:+\-*/%=<>!&|^~?]+/y }]

  if (language === "python") {
    return [
      { kind: "comment", re: /#[^\n]*/y },
      ...commonStringRules,
      {
        kind: "keyword",
        re: keywordRegex([
          "def",
          "class",
          "if",
          "elif",
          "else",
          "for",
          "while",
          "try",
          "except",
          "finally",
          "return",
          "import",
          "from",
          "as",
          "with",
          "lambda",
          "pass",
          "break",
          "continue",
          "yield",
          "raise",
          "in",
          "is",
          "not",
          "and",
          "or",
        ]),
      },
      { kind: "builtin", re: keywordRegex(["True", "False", "None"]) },
      ...commonNumberRules,
      ...commonOperatorRules,
    ]
  }

  if (language === "json") {
    return [
      { kind: "string", re: /"(?:\\.|[^"\\])*"(?=\s*:)/y },
      { kind: "string", re: /"(?:\\.|[^"\\])*"/y },
      { kind: "builtin", re: keywordRegex(["true", "false", "null"]) },
      ...commonNumberRules,
      ...commonOperatorRules,
    ]
  }

  if (language === "bash") {
    return [
      { kind: "comment", re: /#[^\n]*/y },
      ...commonStringRules,
      {
        kind: "keyword",
        re: keywordRegex(["if", "then", "else", "fi", "for", "in", "do", "done", "case", "esac", "while", "function"]),
      },
      { kind: "builtin", re: keywordRegex(["echo", "cd", "export", "source", "pwd", "cat", "grep", "awk", "sed", "git", "npm", "python", "node"]) },
      ...commonNumberRules,
      ...commonOperatorRules,
    ]
  }

  if (language === "sql") {
    return [
      { kind: "comment", re: /--[^\n]*/y },
      { kind: "comment", re: /\/\*[\s\S]*?\*\//y },
      ...commonStringRules,
      {
        kind: "keyword",
        re: keywordRegex([
          "select",
          "from",
          "where",
          "join",
          "left",
          "right",
          "inner",
          "outer",
          "on",
          "group",
          "by",
          "order",
          "having",
          "insert",
          "into",
          "values",
          "update",
          "set",
          "delete",
          "create",
          "table",
          "alter",
          "drop",
          "limit",
          "offset",
          "as",
          "and",
          "or",
          "not",
        ]),
      },
      ...commonNumberRules,
      ...commonOperatorRules,
    ]
  }

  if (language === "yaml") {
    return [
      { kind: "comment", re: /#[^\n]*/y },
      { kind: "string", re: /"(?:\\.|[^"\\])*"/y },
      { kind: "string", re: /'(?:\\.|[^'\\])*'/y },
      { kind: "keyword", re: /\b[A-Za-z_][A-Za-z0-9_-]*(?=\s*:)/y },
      { kind: "builtin", re: keywordRegex(["true", "false", "null"]) },
      ...commonNumberRules,
      ...commonOperatorRules,
    ]
  }

  if (language === "java") {
    return [
      { kind: "comment", re: /\/\/[^\n]*/y },
      { kind: "comment", re: /\/\*[\s\S]*?\*\//y },
      ...commonStringRules,
      {
        kind: "keyword",
        re: keywordRegex([
          "class",
          "interface",
          "enum",
          "public",
          "private",
          "protected",
          "static",
          "final",
          "void",
          "if",
          "else",
          "switch",
          "case",
          "for",
          "while",
          "do",
          "try",
          "catch",
          "finally",
          "return",
          "new",
          "package",
          "import",
          "extends",
          "implements",
        ]),
      },
      { kind: "type", re: keywordRegex(["int", "long", "double", "float", "boolean", "char", "byte", "short", "String"]) },
      ...commonNumberRules,
      ...commonOperatorRules,
    ]
  }

  if (language === "go") {
    return [
      { kind: "comment", re: /\/\/[^\n]*/y },
      { kind: "comment", re: /\/\*[\s\S]*?\*\//y },
      ...commonStringRules,
      { kind: "keyword", re: keywordRegex(["package", "import", "func", "type", "struct", "interface", "if", "else", "for", "range", "switch", "case", "default", "return", "go", "defer", "var", "const"]) },
      { kind: "type", re: keywordRegex(["int", "int64", "float64", "string", "bool", "byte", "rune"]) },
      ...commonNumberRules,
      ...commonOperatorRules,
    ]
  }

  if (language === "csharp") {
    return [
      { kind: "comment", re: /\/\/[^\n]*/y },
      { kind: "comment", re: /\/\*[\s\S]*?\*\//y },
      ...commonStringRules,
      { kind: "keyword", re: keywordRegex(["class", "interface", "enum", "public", "private", "protected", "internal", "static", "void", "if", "else", "switch", "case", "for", "foreach", "while", "try", "catch", "finally", "return", "new", "namespace", "using"]) },
      { kind: "type", re: keywordRegex(["int", "long", "double", "float", "bool", "char", "byte", "string", "decimal"]) },
      ...commonNumberRules,
      ...commonOperatorRules,
    ]
  }

  if (language === "rust") {
    return [
      { kind: "comment", re: /\/\/[^\n]*/y },
      { kind: "comment", re: /\/\*[\s\S]*?\*\//y },
      ...commonStringRules,
      { kind: "keyword", re: keywordRegex(["fn", "struct", "enum", "impl", "trait", "pub", "use", "mod", "let", "mut", "if", "else", "match", "for", "while", "loop", "return"]) },
      { kind: "type", re: keywordRegex(["i32", "i64", "u32", "u64", "f32", "f64", "bool", "str", "String"]) },
      ...commonNumberRules,
      ...commonOperatorRules,
    ]
  }

  if (language === "html") {
    return [
      { kind: "comment", re: /<!--[\s\S]*?-->/y },
      { kind: "keyword", re: /<\/?[A-Za-z][A-Za-z0-9-]*/y },
      { kind: "operator", re: /\/?>/y },
      ...commonStringRules,
    ]
  }

  if (language === "css") {
    return [
      { kind: "comment", re: /\/\*[\s\S]*?\*\//y },
      { kind: "keyword", re: /[.#]?[A-Za-z_-][A-Za-z0-9_-]*(?=\s*\{)/y },
      { kind: "type", re: /[A-Za-z-]+(?=\s*:)/y },
      ...commonStringRules,
      ...commonNumberRules,
      ...commonOperatorRules,
    ]
  }

  return [
    { kind: "comment", re: /\/\/[^\n]*/y },
    { kind: "comment", re: /\/\*[\s\S]*?\*\//y },
    ...commonStringRules,
    { kind: "keyword", re: keywordRegex(["function", "const", "let", "var", "class", "interface", "type", "if", "else", "switch", "case", "for", "while", "do", "return", "import", "from", "export", "async", "await", "try", "catch", "finally", "new"]) },
    { kind: "builtin", re: keywordRegex(["true", "false", "null", "undefined"]) },
    ...commonNumberRules,
    ...commonOperatorRules,
  ]
}

export function tokenizeCode(code: string, language: string): Token[] {
  const rules = rulesForLanguage(normalizeLanguage(language))
  const out: Token[] = []
  let i = 0
  while (i < code.length) {
    let matched = false
    for (const rule of rules) {
      rule.re.lastIndex = i
      const m = rule.re.exec(code)
      if (m && m.index === i && m[0].length > 0) {
        out.push({ kind: rule.kind, text: m[0] })
        i += m[0].length
        matched = true
        break
      }
    }
    if (!matched) {
      out.push({ kind: "plain", text: code[i] })
      i += 1
    }
  }
  return out
}

export function tokenColor(kind: TokenKind, isUser: boolean): string {
  if (kind === "keyword") return isUser ? "#FFE082" : "#5C6BC0"
  if (kind === "string") return isUser ? "#A5D6A7" : "#2E7D32"
  if (kind === "number") return isUser ? "#FFCC80" : "#EF6C00"
  if (kind === "comment") return isUser ? "#B0BEC5" : "#607D8B"
  if (kind === "operator") return isUser ? "#F8BBD0" : "#C2185B"
  if (kind === "type") return isUser ? "#80DEEA" : "#00838F"
  if (kind === "builtin") return isUser ? "#CE93D8" : "#6A1B9A"
  return isUser ? "rgba(255,255,255,0.95)" : "inherit"
}

