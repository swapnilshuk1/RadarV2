import type { ClassifierProvider } from "../Classifier";

export class RegexProvider implements ClassifierProvider {
  public name = "RegexProvider";

  public classifySync(inputs: {
    title: string;
    company: string;
    location: string;
    text?: string;
  }): {
    value: string;
    confidence: number;
    alternatives?: Array<{ category: string; confidence: number }>;
    evidence: Array<{ quote: string; provenance: string }>;
  } {
    const t = inputs.title.toLowerCase();

    // 1. Primary Marketing & Growth Leadership
    if (t.match(/\b(cmo|chief marketing officer|growth officer|cgo|brand officer)\b/i)) {
      return {
        value: "Marketing Leadership",
        confidence: 0.95,
        evidence: [{ quote: inputs.title, provenance: "Job Title exact match" }]
      };
    }
    if (t.match(/\b(vp|vice president|director|head|lead|leader)\b/i) && (t.includes("marketing") || t.includes("brand") || t.includes("growth"))) {
      return {
        value: "Marketing Leadership",
        confidence: 0.90,
        evidence: [{ quote: inputs.title, provenance: "Job Title VP/Director Marketing/Growth match" }]
      };
    }

    // 2. Marketing Operations
    if (t.includes("marketing operations") || t.includes("marketing ops") || t.includes("martech") || t.includes("marketing technology")) {
      return {
        value: "Marketing Operations",
        confidence: 0.95,
        evidence: [{ quote: inputs.title, provenance: "Job Title Marketing Operations/MarTech match" }]
      };
    }

    // 3. Demand Generation
    if (t.includes("demand generation") || t.includes("demand gen") || t.includes("performance marketing") || t.includes("paid media") || t.includes("acquisition")) {
      return {
        value: "Demand Generation",
        confidence: 0.95,
        evidence: [{ quote: inputs.title, provenance: "Job Title Demand Gen/Performance Marketing match" }]
      };
    }

    // 4. Revenue Operations
    if (t.includes("revenue operations") || t.includes("revops") || t.includes("sales operations") || t.includes("sales ops")) {
      return {
        value: "Revenue Operations",
        confidence: 0.95,
        evidence: [{ quote: inputs.title, provenance: "Job Title Revenue/Sales Operations match" }]
      };
    }

    // 5. Partnerships
    if (t.includes("partnership") || t.includes("alliance") || t.includes("channel partner")) {
      return {
        value: "Partnerships",
        confidence: 0.90,
        evidence: [{ quote: inputs.title, provenance: "Job Title Partnerships match" }]
      };
    }

    // 6. Customer Success
    if (t.includes("customer success") || t.includes("client success") || t.includes("success manager")) {
      return {
        value: "Customer Success",
        confidence: 0.90,
        evidence: [{ quote: inputs.title, provenance: "Job Title Customer Success match" }]
      };
    }

    // 7. Enterprise Sales
    if (t.includes("enterprise sales") || t.match(/\b(account executive|ae|sales executive|sales manager|key account)\b/i)) {
      return {
        value: "Enterprise Sales",
        confidence: 0.85,
        evidence: [{ quote: inputs.title, provenance: "Job Title Enterprise Sales / Account Exec match" }]
      };
    }

    // 8. Engineering
    if (t.match(/\b(cto|chief technology officer|chief scientific officer|director of engineering|vp of engineering|vice president of engineering|software|developer|architect|engineer|qa|test|programmer|devops|data engineer|systems administrator)\b/i)) {
      return {
        value: "Engineering",
        confidence: 0.95,
        evidence: [{ quote: inputs.title, provenance: "Job Title Tech/Engineering/CTO match" }]
      };
    }

    // 9. Product
    if (t.match(/\b(product manager|pm\b|product director|head of product|cpo|chief product officer)\b/i)) {
      return {
        value: "Product",
        confidence: 0.95,
        evidence: [{ quote: inputs.title, provenance: "Job Title Product Management match" }]
      };
    }

    // 10. HR / Talent
    if (t.match(/\b(hr\b|human resources|people officer|talent acquisition|recruiter|recruitment|people ops|talent partner)\b/i)) {
      return {
        value: "HR",
        confidence: 0.95,
        evidence: [{ quote: inputs.title, provenance: "Job Title HR/Talent match" }]
      };
    }

    // 11. Finance
    if (t.match(/\b(cfo|finance|financial|controller|accountant|accounting|treasury|tax\b|audit)\b/i)) {
      return {
        value: "Finance",
        confidence: 0.95,
        evidence: [{ quote: inputs.title, provenance: "Job Title CFO/Finance match" }]
      };
    }

    // 12. General Management
    if (t.match(/\b(ceo|coo|chief of staff|managing director|general manager|president)\b/i)) {
      return {
        value: "General Management",
        confidence: 0.90,
        evidence: [{ quote: inputs.title, provenance: "Job Title CEO/COO/GM match" }]
      };
    }

    // 13. Consulting
    if (t.match(/\b(consultant|consulting|advisor|advisory|partner)\b/i)) {
      return {
        value: "Consulting",
        confidence: 0.85,
        evidence: [{ quote: inputs.title, provenance: "Job Title Consulting/Advisor match" }]
      };
    }

    // Fallback: If title contains marketing in any other way
    if (t.includes("marketing") || t.includes("brand")) {
      return {
        value: "Marketing Leadership",
        confidence: 0.60,
        evidence: [{ quote: inputs.title, provenance: "Job Title general marketing keyword fallback" }]
      };
    }

    return {
      value: "Other",
      confidence: 0.50,
      evidence: [{ quote: inputs.title, provenance: "Default fallback category" }]
    };
  }

  public async classify(inputs: {
    title: string;
    company: string;
    location: string;
    text?: string;
  }): Promise<{
    value: string;
    confidence: number;
    alternatives?: Array<{ category: string; confidence: number }>;
    evidence: Array<{ quote: string; provenance: string }>;
  }> {
    return this.classifySync(inputs);
  }
}
