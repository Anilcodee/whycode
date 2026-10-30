# WhyCode UX Specification

## Experience goal

The interface should feel like a focused investigation workspace: a developer asks a question, sees the answer and its evidence, and can verify the reasoning without leaving the product.

## Core journey

1. Open WhyCode.
2. Enter a public GitHub repository.
3. Start indexing and monitor progress.
4. Review source counts and warnings.
5. Ask a question about a file, function, configuration option, or decision.
6. Read the answer and confidence explanation.
7. Inspect evidence cards and open the original GitHub sources.
8. Review the decision timeline and relationship path when relevant.

## Screen 1: Repository setup

### Required content

- Product name and short explanation.
- Repository URL or `owner/repository` input.
- Index button.
- Optional language selector.
- Current indexing status.
- Progress indicator.
- Counts for commits, files, pull requests, issues, comments, and documents.
- Warning and error list.
- Last successful indexing time.

### Validation

- Reject empty input.
- Explain malformed GitHub URLs.
- Explain unsupported private repositories.
- Preserve the entered value when validation fails.

## Screen 2: Ask Why workspace

### Question area

Provide a clear question input with examples:

- Why does this flag exist?
- What incident led to this workaround?
- Was this decision reversed?
- Who approved this change?

The interface should make the selected repository visible so users know which history is being queried.

### Answer area

Show, in order:

1. A concise direct answer.
2. Temporal status: current, historical, superseded, unresolved, or unknown.
3. Confidence label: High, Medium, or Low.
4. One-sentence confidence rationale.
5. A clear abstention message when the answer cannot be supported.

The answer should separate what the sources state from what WhyCode infers. The interface should avoid presenting a long generated explanation before showing the evidence.

### Evidence area

Each evidence card should show:

- Source type.
- Title or short summary.
- Author when known.
- Date.
- Relevant excerpt.
- Relationship to the answer, such as direct support or related context.
- Clickable canonical GitHub URL.

### Timeline

Show the original decision and relevant later events in chronological order. A later event should not be labeled as a reversal unless the evidence supports that conclusion. Possible supersession should be visibly different from confirmed supersession.

### Relationship view

When available, show a compact path such as:

`Configuration key → file → commit → pull request → issue → decision`

The view should remain bounded and readable. It should explain why each relationship is included rather than displaying an unfiltered graph.

## Required states

- **Not indexed:** Explain that the repository must be indexed first.
- **Indexing:** Show progress, partial counts, and the current operation.
- **Index complete:** Enable questions and show the last successful index time.
- **Partial completion:** Allow supported questions while clearly listing missing source types or failures.
- **No evidence:** State that the indexed history did not provide enough evidence.
- **Conflicting evidence:** Show both sources and mark the conclusion unresolved.
- **Provider unavailable:** Explain what is unavailable and offer an evidence-only fallback where possible.
- **Database unavailable:** Provide a clear retry or setup message.

## Accessibility and responsive behavior

- All controls must be keyboard reachable.
- Inputs, buttons, status indicators, and source links need accessible labels.
- Focus states must be visible.
- Text and status colors must meet readable contrast standards.
- Important information must not rely on color alone.
- The main workspace should work on common laptop screen sizes without horizontal scrolling.
