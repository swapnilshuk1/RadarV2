import { DossierCompositionWorker } from "../../src/dossier/runtime/composition-worker";
import { DossierReviewWorker } from "../../src/dossier/runtime/review-worker";
import { EvaluationDaemon } from "../../src/evaluation/daemon";
import { TechnologyOntology } from "../../src/lib/ontology/TechnologyOntology";

TechnologyOntology.load();

void EvaluationDaemon;
void DossierCompositionWorker;
void DossierReviewWorker;

console.log("release worker runtime imports: ok");
