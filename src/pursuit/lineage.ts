import type { Pursuit, PursuitThesis } from "./types";

export function pursuitProfileVersion(
  pursuit: Pursuit,
  activeThesis: PursuitThesis | null,
): string {
  const version = pursuit.lineage?.profileVersion || activeThesis?.lineage?.profileVersion;
  if (!version) throw new Error("PURSUIT_PROFILE_LINEAGE_MISSING");
  return version;
}
