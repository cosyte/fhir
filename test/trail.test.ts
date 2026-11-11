/**
 * The location a walk renders only when it reports something.
 *
 * The validator's walks used to build a location string at every element they passed, though almost
 * every walk reports nothing. They now carry a {@link Trail}, which holds the segments and renders the
 * location on demand. Every diagnostic's `expression` is that text, so the trail has to render
 * exactly what joining the same segments with `childPath` and `[index]` gave, for every name a
 * document can write: a conforming one, one that must be withheld, and an empty root.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { Trail, WITHHELD, childPath } from "../src/model/path.js";

/** A segment as a walk steps into it: an element name, or an array index. */
type Segment = { readonly name: string } | { readonly index: number };

/** The location the walks built before: a string joined a segment at a time. */
function joined(root: string, segments: readonly Segment[]): string {
  let path = root;
  for (const segment of segments) {
    path = "name" in segment ? childPath(path, segment.name) : `${path}[${String(segment.index)}]`;
  }
  return path;
}

const segment: fc.Arbitrary<Segment> = fc.oneof(
  fc.record({ name: fc.oneof(fc.constantFrom("status", "coding", "extension"), fc.string()) }),
  fc.record({ index: fc.nat({ max: 1000 }) }),
);

describe("Trail", () => {
  it("renders the location childPath and [index] build, segment for segment", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constantFrom("", "Observation", "$this", WITHHELD), fc.string()),
        fc.array(segment, { maxLength: 12 }),
        (root, segments) => {
          const trail = new Trail(root);
          expect(trail.text()).toBe(root);
          segments.forEach((s, i) => {
            if ("name" in s) trail.child(s.name);
            else trail.index(s.index);
            expect(trail.depth).toBe(i + 1);
            expect(trail.text()).toBe(joined(root, segments.slice(0, i + 1)));
          });
          expect(trail.childText("code")).toBe(childPath(joined(root, segments), "code"));
        },
      ),
      { seed: 20261111, numRuns: 2000 },
    );
  });

  it("steps back out with pop and truncate", () => {
    const trail = new Trail("Observation");
    trail.child("component");
    trail.index(1);
    trail.child("extension");
    trail.index(0);
    expect(trail.text()).toBe("Observation.component[1].extension[0]");
    trail.truncate(trail.depth - 2);
    expect(trail.text()).toBe("Observation.component[1]");
    trail.pop();
    expect(trail.text()).toBe("Observation.component");
    expect(trail.childText("Not a name")).toBe(`Observation.component.${WITHHELD}`);
  });

  it("starts an empty root at the bounded name, as childPath does", () => {
    const trail = new Trail("");
    trail.child("birthDate");
    expect(trail.text()).toBe("birthDate");
    trail.pop();
    trail.child("John Smith");
    expect(trail.text()).toBe(WITHHELD);
  });
});
