import { Classifier } from "./Classifier";
import { RegexProvider } from "./providers/RegexProvider";
import { LLMProvider } from "./providers/LLMProvider";

export class FunctionalClassifier extends Classifier {
  protected dimensionName = "functionalCategory";
  protected version = "1.1.0";
  protected providers = [
    new RegexProvider(),
    new LLMProvider()
  ];
}

export const functionalClassifier = new FunctionalClassifier();
export default functionalClassifier;
