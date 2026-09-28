import { DossierCompositionWorker } from "../../src/lib/intelligence/staged/DossierCompositionWorker";
import { DossierReviewWorker } from "../../src/lib/intelligence/staged/DossierReviewWorker";
import { EvaluationDaemon } from "../../src/lib/intelligence/EvaluationDaemon";
import { TechnologyOntology } from "../../src/lib/ontology/TechnologyOntology";

TechnologyOntology.load();

void EvaluationDaemon;
void DossierCompositionWorker;
void DossierReviewWorker;

console.log("release worker runtime imports: ok");
