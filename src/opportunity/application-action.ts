import { isExternalPostingUrl } from "@/acquisition/external-posting-url";
import type { Opportunity } from "./contracts";

export interface ApplicationAction {
  url: string;
  label: "Apply direct" | "Search LinkedIn" | "Search Naukri" | "Search Indeed";
  isDirect: boolean;
}

export function applicationActionFor(
  opportunity: Pick<Opportunity, "applyUrl" | "role" | "company" | "scrapedFrom">,
): ApplicationAction | undefined {
  if (isExternalPostingUrl(opportunity.applyUrl)) {
    return { url: opportunity.applyUrl, label: "Apply direct", isDirect: true };
  }

  const query = encodeURIComponent(`${opportunity.role} ${opportunity.company}`);
  switch (opportunity.scrapedFrom) {
    case "LinkedIn":
      return {
        url: `https://www.linkedin.com/jobs/search/?keywords=${query}&location=India`,
        label: "Search LinkedIn",
        isDirect: false,
      };
    case "Naukri":
      return {
        url: `https://www.naukri.com/${encodeURIComponent(opportunity.role.toLowerCase().replace(/\s+/g, "-"))}-jobs`,
        label: "Search Naukri",
        isDirect: false,
      };
    case "Indeed":
      return {
        url: `https://in.indeed.com/jobs?q=${query}&l=India`,
        label: "Search Indeed",
        isDirect: false,
      };
  }
}
