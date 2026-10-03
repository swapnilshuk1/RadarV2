/** Release membership derives exclusively from the canonical test registry. */
import { testGroups, testRegistry } from "./registry";
export const certificationManifest = testGroups.map((group) => ({
  ...group,
  files: testRegistry
    .filter((entry) => entry.certificationGroup === group.id)
    .map((entry) => entry.file),
}));
export const certificationTestFiles = certificationManifest.flatMap((group) => group.files);
export const uniqueCertificationTestFiles = [...new Set(certificationTestFiles)];
export const requiredCertificationRegressionFiles = testRegistry
  .filter((entry) => entry.required)
  .map((entry) => entry.file);
if (uniqueCertificationTestFiles.length !== certificationTestFiles.length)
  throw new Error("CERTIFICATION_MANIFEST_DUPLICATE_FILE");
