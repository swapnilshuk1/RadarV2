/**
 * Interview & Conversation Brief.
 *
 * Unresolved dossier questions are not failures of the evaluation — they are the
 * questions worth asking in the room, so they surface here as strategy.
 */

import type { InterviewBriefContent, LearningSignal, PursuitArtifact } from "../types";
import { CopyButton, EditableText, SectionLabel } from "./shared";

interface Props {
  artifact: PursuitArtifact | undefined;
  busy: boolean;
  onSave: (
    artifactId: string,
    content: { kind: "INTERVIEW_BRIEF"; brief: InterviewBriefContent },
    signals: LearningSignal[],
    approve?: boolean,
  ) => void;
  onExport: (artifactId: string, format: "PDF" | "TXT") => void;
}

export function InterviewBriefPanel({ artifact, busy, onSave, onExport }: Props) {
  if (!artifact || artifact.content.kind !== "INTERVIEW_BRIEF") {
    return (
      <div className="memo-card">
        <p className="text-sm text-muted-foreground">
          Derive the pursuit strategy to prepare the interview brief.
        </p>
      </div>
    );
  }

  const brief = artifact.content.brief;
  const commit = (next: InterviewBriefContent, signals: LearningSignal[] = []) =>
    onSave(artifact.id, { kind: "INTERVIEW_BRIEF", brief: next }, signals);

  const editList = (
    key: "questionsToAsk" | "firstNinetyDays" | "risksToAddress",
    index: number,
    value: string,
  ) => {
    const next = structuredClone(brief);
    if (value.trim().length === 0) next[key].splice(index, 1);
    else next[key][index] = value;
    commit(next);
  };

  const addToList = (key: "questionsToAsk" | "firstNinetyDays" | "risksToAddress") => {
    const next = structuredClone(brief);
    next[key].push("");
    commit(next);
  };

  const lists: Array<[string, "questionsToAsk" | "firstNinetyDays" | "risksToAddress", string]> = [
    ["Questions to ask", "questionsToAsk", "What the dossier could not resolve — ask it in the room."],
    ["First 90 days", "firstNinetyDays", "Hypotheses, offered as hypotheses."],
    ["Risks to address", "risksToAddress", "What a sceptical panel will probe."],
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>Interview brief — v{artifact.version}</SectionLabel>
        <div className="flex gap-2">
          <CopyButton text={artifact.renderedText ?? ""} label="Copy brief" disabled={artifact.status !== "APPROVED"} />
          <button type="button" disabled={busy || artifact.status !== "APPROVED"} onClick={() => onExport(artifact.id, "PDF")} className="pursuit-chip">
            Export PDF
          </button>
          <button type="button" disabled={busy} onClick={() => onSave(artifact.id, { kind: "INTERVIEW_BRIEF", brief }, [], true)} className="pursuit-chip pursuit-chip-primary">
            Mark approved
          </button>
        </div>
      </div>

      <div className="memo-opinion-box">
        <SectionLabel>The mandate in one sentence</SectionLabel>
        <EditableText
          multiline
          value={brief.mandateSentence}
          onCommit={(value) => commit({ ...brief, mandateSentence: value })}
        />
      </div>

      {brief.proofStories.map((story, index) => (
        <div key={index} className="memo-card">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>Proof story {index + 1}</SectionLabel>
            <span className="flex items-center gap-2">
              <span
                className={`memo-badge border ${
                  story.status === "READY"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-500"
                }`}
              >
                {story.status === "READY" ? "Ready" : "Incomplete"}
              </span>
              <span className="label-mono text-muted-foreground">
                {story.claimIds.length} cited claim{story.claimIds.length === 1 ? "" : "s"}
              </span>
            </span>
          </div>
          {story.status !== "READY" && (story.missingFields?.length ?? 0) > 0 && (
            <div className="mt-2 rounded border border-amber-500/30 p-2 text-xs">
              {(story.knownFacts?.length ?? 0) > 0 && (
                <p className="text-muted-foreground">Known: {story.knownFacts!.join(" · ")}</p>
              )}
              <p className="mt-1 text-amber-500">
                Add to your profile to complete it: {story.missingFields!.join(", ")}
              </p>
            </div>
          )}
          <EditableText
            value={story.title}
            onCommit={(value) => {
              const next = structuredClone(brief);
              next.proofStories[index].title = value;
              commit(next);
            }}
          />
          <div className="mt-2 space-y-2">
            {(
              [
                ["Challenge", "challenge"],
                ["Action", "action"],
                ["Scale", "scale"],
                ["Result", "result"],
                ["Relevance", "relevance"],
              ] as const
            ).map(([label, field]) => (
              <div key={field}>
                <span className="label-mono text-muted-foreground">{label}</span>
                <EditableText
                  multiline
                  value={story[field]}
                  onCommit={(value) => {
                    const next = structuredClone(brief);
                    next.proofStories[index][field] = value;
                    commit(next, [
                      {
                        signalType: "PHRASE_REWRITTEN",
                        subject: `proof-story-${field}`,
                        originalValue: story[field],
                        newValue: value,
                      },
                    ]);
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      {lists.map(([label, key, hint]) => (
        <div key={key} className="memo-card">
          <SectionLabel>{label}</SectionLabel>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          <div className="mt-2 space-y-2">
            {brief[key].map((item, index) => (
              <EditableText
                key={index}
                multiline
                value={item}
                onCommit={(value) => editList(key, index, value)}
              />
            ))}
          </div>
          <button type="button" className="pursuit-chip mt-2" onClick={() => addToList(key)}>
            Add
          </button>
        </div>
      ))}
    </div>
  );
}
