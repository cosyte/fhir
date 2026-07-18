/**
 * The FHIRPath parser — a recursive-descent parser over the {@link ./lexer.js} token stream that
 * builds a typed {@link Expr} AST (Phase 7, the bounded invariant engine — ADR 0002).
 *
 * It implements the full FHIRPath **operator precedence** (implies < or/xor < and < in/contains <
 * equality < is/as < inequality < union < additive < multiplicative < unary < invocation/indexer), so
 * every expression the subset accepts is parsed with the *correct* structure — mis-parsing a
 * precedence level would let a wrong tree evaluate to a wrong boolean, the one failure mode worse than
 * "unchecked". Anything the grammar does not recognise (an unexpected token, a trailing token, a
 * malformed call) raises {@link ./errors.js UnsupportedFhirPathError}: the evaluator's fail-safe
 * treats a parse failure exactly like an unsupported evaluation — the invariant is reported
 * *unchecked*, never silently passed.
 *
 * Note the grammar is **broad on purpose** — it parses operators (`*`, `div`, `&`, `~`, …) and
 * functions the *evaluator* does not implement. That is deliberate: parsing them into a well-formed
 * tree and letting the evaluator raise `UnsupportedFhirPathError` at the exact unsupported node keeps
 * the "unchecked, never mis-evaluated" contract precise, rather than rejecting a whole expression at
 * parse time because one sub-term is out of scope.
 *
 * @packageDocumentation
 */

import { UnsupportedFhirPathError } from "./errors.js";
import { tokenize, type Token } from "./lexer.js";

/** A parsed FHIRPath expression node. */
export type Expr =
  | { readonly kind: "empty" } // the `{}` empty-collection literal
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "envvar"; readonly name: string } // `%resource`
  | { readonly kind: "variable"; readonly name: string } // `$this` / `$index` / `$total`
  /** Member access: `name` navigates from `target` (or the current focus when `target` is null). */
  | { readonly kind: "member"; readonly target: Expr | null; readonly name: string }
  /** Function call: `name(args)` invoked on `target` (or the current focus when `target` is null). */
  | {
      readonly kind: "call";
      readonly target: Expr | null;
      readonly name: string;
      readonly args: readonly Expr[];
    }
  /** Indexer: `target[index]`. */
  | { readonly kind: "index"; readonly target: Expr; readonly index: Expr }
  | { readonly kind: "unary"; readonly op: string; readonly operand: Expr }
  | { readonly kind: "binary"; readonly op: string; readonly left: Expr; readonly right: Expr }
  /** Type operator: `operand is Type` / `operand as Type` (the type is a possibly-qualified name). */
  | { readonly kind: "typeop"; readonly op: string; readonly operand: Expr; readonly type: string };

/** Keyword operators — identifiers the parser must read as operators, not path segments. */
const KEYWORD_OPS: ReadonlySet<string> = new Set([
  "and",
  "or",
  "xor",
  "implies",
  "in",
  "contains",
  "div",
  "mod",
  "is",
  "as",
]);

/** A small hand-written recursive-descent parser holding the token cursor. */
class Parser {
  private pos = 0;

  public constructor(private readonly tokens: readonly Token[]) {}

  /** Parse the whole token stream into one expression, erroring on any trailing token. */
  public parse(): Expr {
    const expr = this.parseImplies();
    if (this.pos < this.tokens.length) {
      throw new UnsupportedFhirPathError(`unexpected trailing token '${this.peek()?.value ?? ""}'`);
    }
    return expr;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const token = this.tokens[this.pos];
    if (token === undefined) throw new UnsupportedFhirPathError("unexpected end of expression");
    this.pos += 1;
    return token;
  }

  /** Whether the next token is the given symbol. */
  private isSymbol(value: string): boolean {
    const token = this.peek();
    return token !== undefined && token.type === "symbol" && token.value === value;
  }

  /** Whether the next token is the given keyword-operator identifier. */
  private isKeyword(value: string): boolean {
    const token = this.peek();
    return token !== undefined && token.type === "identifier" && token.value === value;
  }

  /** Consume the given symbol or throw. */
  private expectSymbol(value: string): void {
    if (!this.isSymbol(value)) {
      throw new UnsupportedFhirPathError(`expected '${value}'`);
    }
    this.pos += 1;
  }

  private parseImplies(): Expr {
    let left = this.parseOr();
    while (this.isKeyword("implies")) {
      this.pos += 1;
      left = { kind: "binary", op: "implies", left, right: this.parseOr() };
    }
    return left;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.isKeyword("or") || this.isKeyword("xor")) {
      const op = this.next().value;
      left = { kind: "binary", op, left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseMembership();
    while (this.isKeyword("and")) {
      this.pos += 1;
      left = { kind: "binary", op: "and", left, right: this.parseMembership() };
    }
    return left;
  }

  private parseMembership(): Expr {
    let left = this.parseEquality();
    while (this.isKeyword("in") || this.isKeyword("contains")) {
      const op = this.next().value;
      left = { kind: "binary", op, left, right: this.parseEquality() };
    }
    return left;
  }

  private parseEquality(): Expr {
    let left = this.parseType();
    while (this.isSymbol("=") || this.isSymbol("!=") || this.isSymbol("~") || this.isSymbol("!~")) {
      const op = this.next().value;
      left = { kind: "binary", op, left, right: this.parseType() };
    }
    return left;
  }

  private parseType(): Expr {
    let left = this.parseInequality();
    while (this.isKeyword("is") || this.isKeyword("as")) {
      const op = this.next().value;
      left = { kind: "typeop", op, operand: left, type: this.parseTypeSpecifier() };
    }
    return left;
  }

  /** A type specifier is a dotted identifier chain, e.g. `Quantity`, `System.String`, `FHIR.code`. */
  private parseTypeSpecifier(): string {
    const first = this.next();
    if (first.type !== "identifier") throw new UnsupportedFhirPathError("expected a type name");
    let name = first.value;
    while (this.isSymbol(".")) {
      this.pos += 1;
      const part = this.next();
      if (part.type !== "identifier") throw new UnsupportedFhirPathError("malformed type name");
      name += `.${part.value}`;
    }
    return name;
  }

  private parseInequality(): Expr {
    let left = this.parseUnion();
    while (this.isSymbol("<") || this.isSymbol(">") || this.isSymbol("<=") || this.isSymbol(">=")) {
      const op = this.next().value;
      left = { kind: "binary", op, left, right: this.parseUnion() };
    }
    return left;
  }

  private parseUnion(): Expr {
    let left = this.parseAdditive();
    while (this.isSymbol("|")) {
      this.pos += 1;
      left = { kind: "binary", op: "|", left, right: this.parseAdditive() };
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.isSymbol("+") || this.isSymbol("-") || this.isSymbol("&")) {
      const op = this.next().value;
      left = { kind: "binary", op, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    while (
      this.isSymbol("*") ||
      this.isSymbol("/") ||
      this.isKeyword("div") ||
      this.isKeyword("mod")
    ) {
      const op = this.next().value;
      left = { kind: "binary", op, left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.isSymbol("+") || this.isSymbol("-")) {
      const op = this.next().value;
      return { kind: "unary", op, operand: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  /** A primary followed by any chain of `.member` / `.call(...)` / `[index]` postfixes. */
  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.isSymbol(".")) {
        this.pos += 1;
        expr = this.parseInvocation(expr);
      } else if (this.isSymbol("[")) {
        this.pos += 1;
        const index = this.parseImplies();
        this.expectSymbol("]");
        expr = { kind: "index", target: expr, index };
      } else {
        return expr;
      }
    }
  }

  /** Parse a member access or function call on `target` (the token after a `.`). */
  private parseInvocation(target: Expr | null): Expr {
    const token = this.next();
    if (token.type !== "identifier") {
      throw new UnsupportedFhirPathError(`expected a name after '.', got '${token.value}'`);
    }
    if (this.isSymbol("(")) {
      const args = this.parseArgs();
      return { kind: "call", target, name: token.value, args };
    }
    return { kind: "member", target, name: token.value };
  }

  /** Parse a `( arg, arg, … )` argument list (the cursor is on the `(`). */
  private parseArgs(): Expr[] {
    this.expectSymbol("(");
    const args: Expr[] = [];
    if (this.isSymbol(")")) {
      this.pos += 1;
      return args;
    }
    args.push(this.parseImplies());
    while (this.isSymbol(",")) {
      this.pos += 1;
      args.push(this.parseImplies());
    }
    this.expectSymbol(")");
    return args;
  }

  private parsePrimary(): Expr {
    const token = this.peek();
    if (token === undefined) throw new UnsupportedFhirPathError("unexpected end of expression");

    if (token.type === "string") {
      this.pos += 1;
      return { kind: "string", value: token.value };
    }
    if (token.type === "number") {
      this.pos += 1;
      const value = Number(token.value);
      if (!Number.isFinite(value)) throw new UnsupportedFhirPathError("malformed number literal");
      return { kind: "number", value };
    }
    if (token.type === "envvar") {
      this.pos += 1;
      return { kind: "envvar", name: token.value };
    }
    if (token.type === "special") {
      this.pos += 1;
      return { kind: "variable", name: token.value };
    }
    if (token.type === "symbol") {
      if (token.value === "(") {
        this.pos += 1;
        const expr = this.parseImplies();
        this.expectSymbol(")");
        return expr;
      }
      if (token.value === "{") {
        this.pos += 1;
        this.expectSymbol("}");
        return { kind: "empty" };
      }
      throw new UnsupportedFhirPathError(`unexpected symbol '${token.value}'`);
    }
    // identifier: a boolean literal, a keyword used illegally at the head, or a member/call on focus.
    if (token.value === "true" || token.value === "false") {
      this.pos += 1;
      return { kind: "bool", value: token.value === "true" };
    }
    if (KEYWORD_OPS.has(token.value)) {
      throw new UnsupportedFhirPathError(`operator '${token.value}' has no left operand`);
    }
    return this.parseInvocation(null);
  }
}

/**
 * Parse a FHIRPath expression string into an {@link Expr} AST.
 *
 * @param expression - The FHIRPath source (e.g. an `ElementDefinition.constraint.expression`).
 * @returns The parsed expression tree.
 * @throws UnsupportedFhirPathError when the expression is malformed or uses a token the bounded subset
 *   does not recognise — the caller's fail-safe reports the invariant *unchecked*, never passed.
 * @example
 * ```ts
 * import { parseFhirPath } from "@cosyte/fhir";
 * const ast = parseFhirPath("dataAbsentReason.empty() or value.empty()");
 * ```
 */
export function parseFhirPath(expression: string): Expr {
  return new Parser(tokenize(expression)).parse();
}
