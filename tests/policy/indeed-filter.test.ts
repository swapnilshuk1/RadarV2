import { describe, test, expect } from "vitest";
import { passesHardFilter } from "../../scripts/scraper/utils/hard-filter";
import * as fs from "fs";
import * as path from "path";

describe("Indeed Hard Filter Defect Fix & Extraction Boundary Verification", () => {
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

  test("CASE D: Indeed scraper source code explicitly invokes passesHardFilter in card extraction loop", () => {
    const indeedSourcePath = path.resolve(__dirname, "../../scripts/scraper/portals/indeed.ts");
    const sourceContent = fs.readFileSync(indeedSourcePath, "utf-8");

    // Must import passesHardFilter
    expect(sourceContent).toContain('import { passesHardFilter } from "../utils/hard-filter";');

    // Must execute passesHardFilter during card extraction
    expect(sourceContent).toContain("const filterRes = passesHardFilter({ title, company, location });");
    expect(sourceContent).toContain("if (!filterRes.pass)");
  });

  test("CASE E & F: Rejected card is skipped before cardsOut push, detail fetch, or persistence", () => {
    const indeedSourcePath = path.resolve(__dirname, "../../scripts/scraper/portals/indeed.ts");
    const sourceContent = fs.readFileSync(indeedSourcePath, "utf-8");

    const filterIndex = sourceContent.indexOf("const filterRes = passesHardFilter");
    const cardHashIndex = sourceContent.indexOf("const cardHash = cardHashFor");
    const pushIndex = sourceContent.indexOf("cardsOut.push({");

    expect(filterIndex).toBeGreaterThan(-1);
    expect(cardHashIndex).toBeGreaterThan(-1);
    expect(pushIndex).toBeGreaterThan(-1);

    // Hard filter must execute BEFORE cardHash creation and cardsOut.push
    expect(filterIndex).toBeLessThan(cardHashIndex);
    expect(filterIndex).toBeLessThan(pushIndex);
  });

  test("CASE G: Existing eligible Indeed executive card ('Chief Operating Officer') remains accepted", () => {
    const res = passesHardFilter({
      title: "Chief Operating Officer",
      company: "Enterprise Global",
      location: "Mumbai, Maharashtra, India",
    });
    expect(res.pass).toBe(true);
  });
});
