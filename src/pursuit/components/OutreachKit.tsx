/**
 * Outreach Kit.
 *
 * Deliberately not "a cover letter". Each module targets one reader and one
 * moment, and every message is editable before it leaves the system.
 */

import type { LearningSignal, MessageContent, PursuitArtifact } from "../types";
import { artifactLabels } from "../types";
import { CopyButton, EditableText, SectionLabel } from "./shared";

const MESSAGE_ORDER = [
  "EXEC_NOTE",
  "WARM_INTRO",
  "RECRUITER_BRIEF",
  "APPLICATION_STATEMENT",
  "FOLLOW_UP_1",
  "FOLLOW_UP_2",
] as const;

const MESSAGE_PURPOSE: Record<string, string> = {
  EXEC_NOTE: "To the hiring executive. One argument, one precedent, one ask.",
  WARM_INTRO: "To a mutual connection. Written so it can be forwarded unedited.",
  RECRUITER_BRIEF: "To the search consultant who has to sell you internally.",
  APPLICATION_STATEMENT: "For the application portal, read alongside the resume.",
  FOLLOW_UP_1: "Day 5. Adds something new rather than chasing.",
  FOLLOW_UP_2: "Day 12. Closes the loop gracefully.",
};

interface Props {
  artifacts: PursuitArtifact[];
  busy: boolean;
  onSave: (
    artifactId: string,
    content: { kind: "MESSAGE"; message: MessageContent },
    signals: LearningSignal[],
    approve?: boolean,
  ) => void;
  onExport: (artifactId: string, format: "PDF" | "TXT") => void;
  onLogSent: (artifactId: string) => void;
}

export function OutreachKit({ artifacts, busy, onSave, onExport, onLogSent }: Props) {
  const messages = MESSAGE_ORDER.map((type) =>
    artifacts.find((artifact) => artifact.artifactType === type),
  ).filter((artifact): artifact is PursuitArtifact => Boolean(artifact));

  if (messages.length === 0) {
    return (
      <div className="memo-card">
        <p className="text-sm text-muted-foreground">
          Derive the pursuit strategy to draft your outreach.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {messages.map((artifact) => {
        if (artifact.content.kind !== "MESSAGE") return null;
        const message = artifact.content;
        const words = message.message.body.trim().split(/\s+/).filter(Boolean).length;
        const target = message.message.targetWords ?? 120;
        const overLength = words > target * 1.4;

        const commit = (next: MessageContent, signals: LearningSignal[] = [], approve = false) =>
          onSave(artifact.id, { kind: "MESSAGE", message: next }, signals, approve);

        return (
          <div key={artifact.id} className="memo-card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <SectionLabel>{artifactLabels[artifact.artifactType]}</SectionLabel>
                <p className="mt-1 text-xs text-muted-foreground">
                  {MESSAGE_PURPOSE[artifact.artifactType]}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <CopyButton
                  disabled={artifact.status !== "APPROVED"}
                  text={
                    message.message.subject
                      ? `${message.message.subject ?? ""}\n\n${message.message.body}`
                      : message.message.body
                  }
                />
                {artifact.status === "APPROVED" ? <a
                  className="pursuit-chip"
                  href={`mailto:?subject=${encodeURIComponent(message.message.subject ?? "")}&body=${encodeURIComponent(message.message.body)}`}
                >
                  Open in email
                </a> : <button type="button" disabled className="pursuit-chip">Open in email</button>}
                <button
                  type="button"
                  disabled={busy || artifact.status !== "APPROVED"}
                  onClick={() => onLogSent(artifact.id)}
                  className="pursuit-chip pursuit-chip-primary"
                >
                  Mark sent
                </button>
                <button type="button" disabled={busy} onClick={() => commit(message.message, [], true)} className="pursuit-chip">
                  Mark approved
                </button>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              <EditableText
                value={message.message.subject ?? ""}
                placeholder="Subject"
                onCommit={(value) => commit({ ...message.message, subject: value })}
              />
              <EditableText
                multiline
                value={message.message.body}
                onCommit={(value) =>
                  commit({ ...message.message, body: value }, [
                    {
                      signalType: "MESSAGE_REWRITTEN",
                      subject: artifact.artifactType,
                      originalValue: message.message.body,
                      newValue: value,
                    },
                  ])
                }
              />
              <p className={`label-mono ${overLength ? "text-amber-500" : "text-muted-foreground"}`}>
                {words} words · target {target}
                {overLength ? " · long for this format" : ""}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
