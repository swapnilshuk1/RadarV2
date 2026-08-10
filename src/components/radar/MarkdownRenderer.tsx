import React from "react";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isHero?: boolean;
}

export function MarkdownRenderer({ content, className = "", isHero = false }: MarkdownRendererProps) {
  if (!content) return null;

  // Split content by lines
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  
  let currentList: React.ReactNode[] = [];
  let listKey = 0;

  const flushList = () => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={`list-${listKey++}`} className="list-disc pl-5 my-4 space-y-2 text-ink-muted">
          {currentList}
        </ul>
      );
      currentList = [];
    }
  };

  const parseInlineStyles = (text: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    let keyIndex = 0;
    
    // Split by **bold** and *italic* tokens
    const regex = /(\*\*.*?\*\*|\*.*?\*)/g;
    const tokens = text.split(regex);
    
    for (const token of tokens) {
      if (token.startsWith("**") && token.endsWith("**")) {
        parts.push(
          <strong key={keyIndex++} className="font-semibold text-ink">
            {token.slice(2, -2)}
          </strong>
        );
      } else if (token.startsWith("*") && token.endsWith("*")) {
        parts.push(
          <em key={keyIndex++} className="italic text-ink-muted">
            {token.slice(1, -1)}
          </em>
        );
      } else {
        parts.push(token);
      }
    }
    
    return parts;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!line) {
      continue;
    }

    if (line.startsWith("### ")) {
      flushList();
      const headerText = line.substring(4);
      elements.push(
        <h3 key={`h3-${i}`} className="text-xl font-semibold text-ink mt-8 mb-3 leading-snug">
          {parseInlineStyles(headerText)}
        </h3>
      );
    } else if (line.startsWith("#### ")) {
      flushList();
      const headerText = line.substring(5);
      elements.push(
        <h4 key={`h4-${i}`} className="label-mono text-brass mt-7 mb-3">
          {parseInlineStyles(headerText)}
        </h4>
      );
    } else if (line.startsWith("* ") || line.startsWith("- ")) {
      const itemText = line.substring(2);
      currentList.push(
        <li key={`li-${i}`} className="text-sm leading-relaxed text-ink-muted">
          {parseInlineStyles(itemText)}
        </li>
      );
    } else if (line.startsWith("  - ") || line.startsWith("    - ")) {
      const itemText = line.trim().substring(2);
      currentList.push(
        <li key={`li-${i}`} className="list-none pl-6 text-sm leading-relaxed text-ink-muted/85 italic border-l-2 border-brass/30 my-2">
          {parseInlineStyles(itemText)}
        </li>
      );
    } else {
      flushList();
      elements.push(
        <p
          key={`p-${i}`}
          className={`${
            isHero 
              ? "text-xl font-serif leading-relaxed text-ink" 
              : "text-base leading-relaxed text-ink-muted"
          } mb-4`}
        >
          {parseInlineStyles(line)}
        </p>
      );
    }
  }

  flushList();

  return <div className={`space-y-1 ${className}`}>{elements}</div>;
}
