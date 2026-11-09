import { describe, expect, it } from "vitest";
import { shortCampusName } from "./campus-names";

describe("shortCampusName", () => {
  const demo = ["Houston ISD Demo \u2013 Bayou High School", "Houston ISD Demo \u2013 Central High School"];
  it("drops a prefix every campus shares", () => {
    expect(shortCampusName(demo[0], demo)).toBe("Bayou High School");
  });
  it("keeps names that don't all share one", () => {
    expect(shortCampusName("Lamar High School", ["Lamar High School", "Bellaire High School"])).toBe("Lamar High School");
    expect(shortCampusName(demo[0], [...demo, "Westside High School"])).toBe(demo[0]);
  });
  it("leaves a single campus alone", () => {
    expect(shortCampusName(demo[0], [demo[0]])).toBe(demo[0]);
  });
});
