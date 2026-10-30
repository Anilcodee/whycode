# WhyCode Product Brief

## Product in one sentence

WhyCode helps developers understand why code exists by connecting implementation details to the repository history that explains them.

## The user problem

When developers join or maintain an unfamiliar codebase, the hardest questions are often questions about intent:

- Why is this workaround here?
- Why does this client retry three times?
- Which incident or customer problem led to this flag?
- Is the decision still valid?

The answer is usually spread across commits, pull requests, issues, comments, design documents, and the memories of people who are no longer available. Searching for matching words does not reliably reconstruct that context.

## Target users

### Primary user: the codebase navigator

A developer is working in an unfamiliar repository and needs enough historical context to make a safe change.

### Secondary users

- Maintainers investigating old implementation choices.
- Engineering leads preparing ownership handovers.
- Reviewers checking whether historical rationale still applies.
- Incident responders tracing a production issue to an earlier decision.

## Product promise

Ask a focused question about a repository and receive a concise answer that can be checked against real source evidence. If the repository does not support a reliable answer, WhyCode should say that plainly.

## MVP focus

The first release focuses on one public GitHub repository at a time and five question types:

1. Why does this file, function, or configuration option exist?
2. What change introduced this behavior?
3. Which issue or pull request motivated it?
4. Is the original decision still current?
5. Who participated in or approved the decision?

The core experience is English, evidence-backed question answering. Hindi/Hinglish output, graph visualization, and vector retrieval are optional enhancements.

## What makes WhyCode different

WhyCode does not treat search similarity as an explanation. It connects a code entity to the commits, discussions, decisions, and later changes around it. The answer shows those connections and preserves the distinction between direct evidence, inference, and missing information.

## MVP success

The product is successful when a developer can:

1. Index a real public repository.
2. Ask a focused question about a confusing implementation choice.
3. Read a short answer supported by clickable primary sources.
4. See when evidence is historical, conflicting, or possibly superseded.
5. Receive a clear abstention when the repository cannot support the answer.

## Product boundaries

WhyCode does not modify code, open pull requests, contact maintainers, or claim knowledge outside the indexed repository. The product explains repository history; it does not replace code search, issue tracking, or human judgment.

## Open decisions

The following decisions are intentionally deferred until the core flow has been validated:

- Multiple repositories in one user session.
- Shared links to answers.
- Retention period for indexed source excerpts.
- Anonymous access to the public demo.
- Default answer-generation provider.
- Maximum supported repository size.
