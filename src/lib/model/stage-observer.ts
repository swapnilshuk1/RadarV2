/** Machine-readable lifecycle evidence; human progress wording is not an API. */
export type StageEvent = { kind: "repair"; stage: string };
export type StageObserver = (message: string, event?: StageEvent) => void;
