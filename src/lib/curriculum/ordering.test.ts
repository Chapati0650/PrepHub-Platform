import { describe, it, expect } from "vitest";
import { moveItem, nextPosition, renumber } from "./ordering";

const list = [
  { id: "a", position: 0 },
  { id: "b", position: 1 },
  { id: "c", position: 2 },
];

describe("moveItem", () => {
  it("moves an item up by swapping with its predecessor", () => {
    expect(moveItem(list, "c", "up").map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("moves an item down by swapping with its successor", () => {
    expect(moveItem(list, "a", "down").map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("is a no-op at the boundaries", () => {
    expect(moveItem(list, "a", "up").map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(moveItem(list, "c", "down").map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op for an unknown id", () => {
    expect(moveItem(list, "zzz", "up").map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("always returns contiguous positions from zero", () => {
    const gappy = [
      { id: "a", position: 4 },
      { id: "b", position: 9 },
      { id: "c", position: 30 },
    ];
    expect(moveItem(gappy, "b", "up")).toEqual([
      { id: "b", position: 0 },
      { id: "a", position: 1 },
      { id: "c", position: 2 },
    ]);
  });

  it("sorts by position before moving, regardless of input order", () => {
    const shuffled = [list[2], list[0], list[1]];
    expect(moveItem(shuffled, "b", "up").map((i) => i.id)).toEqual(["b", "a", "c"]);
  });
});

describe("renumber / nextPosition", () => {
  it("renumbers in the given order", () => {
    expect(renumber([{ id: "x", position: 7 }, { id: "y", position: 2 }])).toEqual([
      { id: "x", position: 0 },
      { id: "y", position: 1 },
    ]);
  });

  it("places a new item after the highest existing position", () => {
    expect(nextPosition(list)).toBe(3);
    expect(nextPosition([{ id: "a", position: 10 }])).toBe(11);
    expect(nextPosition([])).toBe(0);
  });
});
