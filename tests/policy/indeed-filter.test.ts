import { describe, test, expect } from "vitest";
import { passesHardFilter } from "../../scripts/scraper/utils/hard-filter";

describe("Indeed Hard Filter Semantics & Candidate Verification", () => {
  test("CASE A: Eligible executive role ('VP Marketing') passes hard filter", () => {
    const res = passesHardFilter({
      title: "Vice President Marketing",
      company: "Acme Corp",
      location: "Bengaluru, India",
    });
    expect(res.pass).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  test("CASE B: Clearly non-executive role ('Junior Developer') fails hard filter", () => {
    const res = passesHardFilter({
      title: "Junior Developer",
      company: "Acme Corp",
      location: "Bengaluru, India",
    });
    expect(res.pass).toBe(false);
    expect(res.reason).toBe("Junior title detected");
  });

  test("CASE C: Entry-level internship role ('Intern') fails hard filter", () => {
    const res = passesHardFilter({
      title: "Software Engineering Intern",
      company: "Acme Corp",
      location: "Bengaluru, India",
    });
    expect(res.pass).toBe(false);
    expect(res.reason).toBe("Junior title detected");
  });

  test("CASE D: Existing eligible executive card ('Chief Operating Officer') remains accepted", () => {
    const res = passesHardFilter({
      title: "Chief Operating Officer",
      company: "Enterprise Global",
      location: "Mumbai, Maharashtra, India",
    });
    expect(res.pass).toBe(true);
  });
});
