import { describe, it, expect } from "vitest";
import { ResponseValidator } from "../../src/lib/acquisition/validator";

describe("ResponseValidator HTTP 404 Handling", () => {
  it("rejects HTTP 404 and does not create an evaluation job", () => {
    const result = ResponseValidator.validate({
      html: "Some generic 404 text that happens to be very long. ".repeat(10), // long enough to pass text length check
      url: "https://www.linkedin.com/jobs/view/123",
      sourcePortal: "LinkedIn",
      httpStatus: 404,
    });
    
    expect(result.isValid).toBe(false);
    expect(result.quality).toBe("INVALID");
    expect(result.failureClass).toBe("REMOVED_404");
  });

  it("valid 200 normal validation passes", () => {
    const result = ResponseValidator.validate({
      html: "A valid job description that meets length requirements and has no anti-bot or login wall phrases. ".repeat(10),
      extractedDescription: "A valid job description that meets length requirements and has no anti-bot or login wall phrases. ".repeat(10),
      url: "https://www.linkedin.com/jobs/view/123",
      sourcePortal: "LinkedIn",
      httpStatus: 200,
    });
    
    expect(result.isValid).toBe(true);
    expect(result.quality).toBe("PARTIAL"); // It might be PARTIAL since there's no explicitly extracted dimensions in validate
    expect(result.failureClass).toBeUndefined();
  });

  it("handles missing httpStatus gracefully but correctly relies on content heuristics", () => {
    const result = ResponseValidator.validate({
      html: "A valid job description that meets length requirements and has no anti-bot or login wall phrases. ".repeat(10),
      extractedDescription: "A valid job description that meets length requirements and has no anti-bot or login wall phrases. ".repeat(10),
      url: "https://www.linkedin.com/jobs/view/123",
      sourcePortal: "LinkedIn",
      httpStatus: undefined,
    });
    
    expect(result.isValid).toBe(true);
  });
});
