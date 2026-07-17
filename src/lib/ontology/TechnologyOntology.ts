/**
 * TechnologyOntology.ts
 *
 * Singleton loader for the technology ontology.
 * Compiles a flat alias → product lookup map on first load browser-safely.
 * Emits startup diagnostics including version, product, alias, and category counts.
 */
import technologyJson from "../../../config/ontologies/technology.json";
import technologyMetaJson from "../../../config/ontologies/technology.meta.json";

export interface OntologyProduct {
  category: string;
  aliases: string[];
  vendor: string;
}

export interface OntologyMeta {
  version: string;
  generatedAt: string;
  productCount: number;
  aliasCount: number;
  categoryCount: number;
  categories: string[];
}

export interface LookupResult {
  product: string;
  category: string;
  vendor: string;
}

export class TechnologyOntology {
  private static instance: TechnologyOntology | null = null;

  private readonly products: Map<string, OntologyProduct> = new Map();
  // alias (lowercase) → canonical product name
  private readonly aliasIndex: Map<string, string> = new Map();
  // category → [canonical product names]
  private readonly categoryIndex: Map<string, string[]> = new Map();
  private readonly meta: OntologyMeta;

  private constructor() {
    const t0 = Date.now();

    const raw = technologyJson as Record<string, OntologyProduct>;
    const metaRaw = technologyMetaJson as OntologyMeta;

    let duplicateAliases = 0;

    for (const [productName, product] of Object.entries(raw)) {
      this.products.set(productName, product);

      // Index canonical product name itself (lowercased)
      const lowerProduct = productName.toLowerCase();
      if (this.aliasIndex.has(lowerProduct)) {
        duplicateAliases++;
      } else {
        this.aliasIndex.set(lowerProduct, productName);
      }

      // Index all aliases
      for (const alias of product.aliases) {
        const lowerAlias = alias.toLowerCase();
        if (this.aliasIndex.has(lowerAlias)) {
          duplicateAliases++;
        } else {
          this.aliasIndex.set(lowerAlias, productName);
        }
      }

      // Category index
      if (!this.categoryIndex.has(product.category)) {
        this.categoryIndex.set(product.category, []);
      }
      this.categoryIndex.get(product.category)!.push(productName);
    }

    this.meta = metaRaw || { version: "unknown", generatedAt: "unknown", productCount: 0, aliasCount: 0, categoryCount: 0, categories: [] };
    const loadMs = Date.now() - t0;

    // Print startup diagnostics
    console.log("\n  Technology Ontology Loaded:");
    console.log(`    Version:           ${this.meta.version}`);
    console.log(`    Products:          ${this.products.size}`);
    console.log(`    Aliases:           ${this.aliasIndex.size - this.products.size}  (total tokens: ${this.aliasIndex.size})`);
    console.log(`    Categories:        ${this.categoryIndex.size}  (${[...this.categoryIndex.keys()].join(", ")})`);
    console.log(`    Duplicate aliases: ${duplicateAliases}`);
    console.log(`    Load time:         ${loadMs}ms\n`);
  }

  /**
   * Returns the singleton instance, loading on first call.
   */
  static load(): TechnologyOntology {
    if (!TechnologyOntology.instance) {
      TechnologyOntology.instance = new TechnologyOntology();
    }
    return TechnologyOntology.instance;
  }

  /**
   * Reset singleton (for testing purposes only).
   */
  static reset(): void {
    TechnologyOntology.instance = null;
  }

  /**
   * O(1) lookup: given any token (product name or alias), returns canonical product info.
   * Returns null if the token is not recognized.
   */
  lookup(token: string): LookupResult | null {
    const key = token.toLowerCase().trim();
    const productName = this.aliasIndex.get(key);
    if (!productName) return null;
    const product = this.products.get(productName)!;
    return { product: productName, category: product.category, vendor: product.vendor };
  }

  /**
   * Returns all canonical product names in a given category.
   */
  getProductsByCategory(category: string): string[] {
    return this.categoryIndex.get(category) ?? [];
  }

  /**
   * Returns all categories in the ontology.
   */
  getCategories(): string[] {
    return [...this.categoryIndex.keys()];
  }

  /**
   * Returns total number of recognized tokens (products + aliases).
   */
  get tokenCount(): number {
    return this.aliasIndex.size;
  }

  /**
   * Returns the loaded metadata.
   */
  getMeta(): OntologyMeta {
    return this.meta;
  }
}
