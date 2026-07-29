/**
 * TechnologyOntology.ts
 *
 * Step 5: Directed Technology Knowledge Graph.
 * Supports multi-parent abstractions (e.g. Snowflake -> Data Platform, Cloud Infra, Analytics).
 */

export interface TechNode {
  id: string;
  name: string;
  vendor: string;
  categories: string[]; // Multi-parent capability categories
  aliases: string[];
}

export class TechnologyKnowledgeGraph {
  private static readonly nodes: TechNode[] = [
    {
      id: "tech_snowflake",
      name: "Snowflake",
      vendor: "Snowflake Inc.",
      categories: ["Data Platform", "Analytics & BI", "Cloud Infrastructure", "AI Infrastructure"],
      aliases: ["snowflake", "snowflake cdw", "snowflake data cloud", "snowflake warehouse"]
    },
    {
      id: "tech_sfmc",
      name: "Salesforce Marketing Cloud",
      vendor: "Salesforce",
      categories: ["CRM Platform", "Marketing Automation", "Customer Engagement", "CDP"],
      aliases: ["sfmc", "salesforce marketing cloud", "exacttarget", "salesforce cdp", "salesforce data cloud"]
    },
    {
      id: "tech_aws",
      name: "Amazon Web Services (AWS)",
      vendor: "Amazon",
      categories: ["Cloud Infrastructure", "DevOps & Cloud", "Database Systems"],
      aliases: ["aws", "amazon web services", "aws cloud", "ec2", "s3", "redshift"]
    },
    {
      id: "tech_hubspot",
      name: "HubSpot",
      vendor: "HubSpot",
      categories: ["CRM Platform", "Marketing Automation", "Sales Automation"],
      aliases: ["hubspot", "hubspot crm", "hubspot marketing hub"]
    },
    {
      id: "tech_sap",
      name: "SAP S/4HANA",
      vendor: "SAP",
      categories: ["ERP Platform", "Enterprise Software", "Finance & Operations"],
      aliases: ["sap", "s/4hana", "sap ecc", "sap erp", "sap cloud"]
    }
  ];

  private static readonly aliasIndex: Map<string, TechNode> = new Map();

  static {
    for (const node of this.nodes) {
      this.aliasIndex.set(node.id, node);
      this.aliasIndex.set(node.name.toLowerCase().trim(), node);
      for (const alias of node.aliases) {
        this.aliasIndex.set(alias.toLowerCase().trim(), node);
      }
    }
  }

  public static lookup(term: string): TechNode | null {
    const key = term.toLowerCase().trim();
    return this.aliasIndex.get(key) || null;
  }

  public static getNodesForCategory(category: string): TechNode[] {
    const catLower = category.toLowerCase().trim();
    return this.nodes.filter(n => n.categories.some(c => c.toLowerCase().trim() === catLower));
  }

  public static getAll(): TechNode[] {
    return this.nodes;
  }
}
