/**
 * `membersNamed`, the package's own read of a member by name: the same values as the public
 * `getAllProperties`, in the same order, with one shared empty list when the node wrote none.
 */

import { describe, expect, it } from "vitest";

import { complex, getAllProperties, list, primitive } from "../src/index.js";
import { membersNamed } from "../src/model/node.js";

describe("membersNamed", () => {
  const status = primitive("final");
  const shadowed = primitive("entered-in-error");
  const node = complex(
    [
      { name: "resourceType", value: primitive("Observation") },
      { name: "status", value: status },
      { name: "code", value: list([primitive("a")]) },
    ],
    [{ name: "status", value: shadowed }],
  );

  it("answers what getAllProperties answers, members a repeated name shadowed last", () => {
    for (const name of ["status", "code", "resourceType", "absent"]) {
      expect(membersNamed(node, name)).toEqual(getAllProperties(node, name));
    }
    expect(membersNamed(node, "status")).toEqual([status, shadowed]);
  });

  it("shares one frozen empty list for a name the node did not write", () => {
    const none = membersNamed(node, "absent");
    expect(none).toHaveLength(0);
    expect(Object.isFrozen(none)).toBe(true);
    expect(membersNamed(complex([]), "status")).toBe(none);
  });
});
