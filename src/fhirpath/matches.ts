/**
 * `matches(regex)` for the bounded FHIRPath engine.
 *
 * FHIRPath says a regular expression is case-sensitive, uses "single line" mode and allows Unicode
 * characters, and that a match is not implicitly anchored; it names no dialect, and recommends PCRE
 * while noting that platforms use their native engines and "there will always be small
 * differences". This engine answers only patterns written in a small portable subset whose meaning
 * does not depend on that choice, compiled as a JavaScript `RegExp` with the `s` (single line) and
 * `u` (Unicode) flags and no others. Any pattern outside the subset, or one that does not compile,
 * raises {@link ./errors.js UnsupportedFhirPathError}, which the validator reports as unchecked.
 *
 * The subset: literal characters; `.`; the anchors `^` and `$` (start and end of the input, the
 * input being one line in single line mode); a character class of literal characters and ranges,
 * optionally negated; a group `(...)`; alternation `|`; and the greedy quantifiers `*`, `+`, `?`,
 * `{n}`, `{n,}` and `{n,m}` (at most 1000). A metacharacter is written literally by escaping it with
 * `\`. Refused, among others: shorthand classes such as `\d`, `\w`, `\s` and `\b` (Unicode-aware in
 * some dialects and ASCII-only in others), back-references, lookaround, named and non-capturing
 * groups, inline flags, lazy and possessive quantifiers, POSIX classes, class set operations, and an
 * unescaped `-` in a class other than between the two ends of a range. A
 * quantified group that itself contains a quantifier or an alternation is refused too, so a
 * pattern cannot backtrack exponentially over a long input.
 *
 * `$` is end of input: a value ending in a line feed does not match `^[0-9]{10}$`. That is the
 * reading of every dialect that matches the whole input, and it reports such a value rather than
 * passing it.
 *
 * @packageDocumentation
 */

import { UnsupportedFhirPathError } from "./errors.js";

/** Characters with a meaning of their own outside a character class. */
const META: ReadonlySet<string> = new Set([
  "\\",
  "^",
  "$",
  ".",
  "|",
  "?",
  "*",
  "+",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
]);

/** Characters that may be escaped inside a character class. */
const CLASS_ESCAPABLE: ReadonlySet<string> = new Set(["\\", "]", "[", "-", "^"]);

/** The largest repetition count a `{n,m}` quantifier may name. */
const MAX_REPEAT = 1000;

function refuse(): never {
  throw new UnsupportedFhirPathError("matches() pattern outside the portable subset");
}

/** What a parsed term contains, for the nested-quantifier rule. */
interface Shape {
  readonly quantified: boolean;
  readonly alternates: boolean;
}

/** A recursive-descent check of the portable subset over a pattern's code points. */
class PatternCheck {
  private pos = 0;

  public constructor(private readonly chars: readonly string[]) {}

  public run(): void {
    this.alternation();
    if (this.pos !== this.chars.length) refuse();
  }

  private peek(): string | undefined {
    return this.chars[this.pos];
  }

  private alternation(): Shape {
    let shape = this.sequence();
    let alternates = false;
    while (this.peek() === "|") {
      this.pos += 1;
      alternates = true;
      const next = this.sequence();
      shape = { quantified: shape.quantified || next.quantified, alternates: true };
    }
    return { quantified: shape.quantified, alternates: alternates || shape.alternates };
  }

  private sequence(): Shape {
    let quantified = false;
    let alternates = false;
    for (let c = this.peek(); c !== undefined && c !== "|" && c !== ")"; c = this.peek()) {
      if (c === "^" || c === "$") {
        this.pos += 1;
        if (this.isQuantifierStart()) refuse();
        continue;
      }
      const atom = this.atom();
      if (this.isQuantifierStart()) {
        if (atom.quantified || atom.alternates) refuse();
        this.quantifier();
        quantified = true;
      }
      quantified ||= atom.quantified;
      alternates ||= atom.alternates;
    }
    return { quantified, alternates };
  }

  private isQuantifierStart(): boolean {
    const c = this.peek();
    return c === "*" || c === "+" || c === "?" || c === "{";
  }

  private atom(): Shape {
    const c = this.peek();
    if (c === undefined) refuse();
    if (c === "(") {
      this.pos += 1;
      if (this.peek() === "?") refuse();
      const inner = this.alternation();
      if (this.peek() !== ")") refuse();
      this.pos += 1;
      return inner;
    }
    if (c === "[") {
      this.characterClass();
      return { quantified: false, alternates: false };
    }
    if (c === "\\") {
      const escaped = this.chars[this.pos + 1];
      if (escaped === undefined || !(META.has(escaped) || escaped === "/")) refuse();
      this.pos += 2;
      return { quantified: false, alternates: false };
    }
    if (c === ".") {
      this.pos += 1;
      return { quantified: false, alternates: false };
    }
    if (META.has(c)) refuse();
    this.pos += 1;
    return { quantified: false, alternates: false };
  }

  private quantifier(): void {
    const c = this.peek();
    this.pos += 1;
    if (c === "{") {
      const low = this.count();
      let high = low;
      if (this.peek() === ",") {
        this.pos += 1;
        high = this.peek() === "}" ? MAX_REPEAT : this.count();
      }
      if (this.peek() !== "}" || high < low) refuse();
      this.pos += 1;
    }
    // A lazy (`*?`) or possessive (`*+`) form, or a quantifier on a quantifier.
    if (this.isQuantifierStart()) refuse();
  }

  private count(): number {
    let digits = "";
    for (let c = this.peek(); c !== undefined && c >= "0" && c <= "9"; c = this.peek()) {
      digits += c;
      this.pos += 1;
    }
    const value = digits === "" ? Number.NaN : Number(digits);
    if (!(value <= MAX_REPEAT)) refuse();
    return value;
  }

  private characterClass(): void {
    this.pos += 1; // `[`
    if (this.peek() === "^") this.pos += 1;
    let members = 0;
    while (this.peek() !== "]") {
      this.classCharacter();
      if (this.peek() === "-" && this.chars[this.pos + 1] !== "]") {
        this.pos += 1;
        this.classCharacter();
      }
      members += 1;
    }
    if (members === 0) refuse();
    this.pos += 1; // `]`
  }

  private classCharacter(): void {
    const c = this.peek();
    if (c === undefined || c === "[" || c === "-") refuse();
    // `&&` is a class intersection in one widely used dialect and two literal ampersands in others.
    if (c === "&" && this.chars[this.pos + 1] === "&") refuse();
    if (c === "\\") {
      const escaped = this.chars[this.pos + 1];
      if (escaped === undefined || !CLASS_ESCAPABLE.has(escaped)) refuse();
      this.pos += 2;
      return;
    }
    this.pos += 1;
  }
}

/**
 * Compile a `matches()` pattern, or refuse it.
 *
 * @param pattern - The regular expression text, as the expression's argument evaluated to it.
 * @returns A `RegExp` that tests the pattern anywhere in the input (FHIRPath does not anchor it).
 * @throws UnsupportedFhirPathError when the pattern is outside the portable subset or does not
 *   compile. The message never carries the pattern, which can come from instance data.
 * @example
 * ```ts
 * compileMatchesPattern("^[0-9]{10}$").test("1234567893"); // true
 * compileMatchesPattern("\\d+"); // throws: `\d` means different things in different dialects
 * ```
 */
export function compileMatchesPattern(pattern: string): RegExp {
  new PatternCheck([...pattern]).run();
  try {
    return new RegExp(pattern, "su");
  } catch {
    return refuse();
  }
}
