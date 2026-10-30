# WhyCode Evaluation Plan

## Evaluation objective

Determine whether WhyCode helps a developer recover repository rationale accurately and honestly. The evaluation should measure both useful answers and appropriate abstentions.

## Evaluation set

Prepare 10–20 questions from one real public repository. Include:

- Direct rationale questions.
- File-to-commit questions.
- Commit-to-pull-request questions.
- Code-to-issue questions.
- Temporal and supersession questions.
- Ambiguous questions.
- Questions with no supporting evidence.

For every question, record:

- Expected answer or abstention.
- Expected evidence IDs.
- Expected temporal status.
- Minimum acceptable confidence label.
- Notes about ambiguity or missing sources.

## Product metrics

### Citation accuracy

For each substantive claim, verify that the cited source exists, is clickable, and actually supports the claim.

### Evidence coverage

Measure how many expected evidence sources appear in the answer or evidence panel.

### Abstention quality

Check whether unsupported or contradictory questions are abstained from rather than answered speculatively.

### Temporal accuracy

Check whether historical, current, superseded, and unresolved decisions receive the correct status.

### Indexing reliability

Run indexing twice and confirm that source counts and entity identities remain stable without duplicates.

### Response time

Record indexing duration and question-answer latency for the selected repository. Compare results with the initial targets of a 3-second status response and a 10–15 second typical question response.

## Manual acceptance checklist

- A valid public repository indexes successfully.
- Progress, counts, warnings, and failures are visible.
- A changed file can be traced to its commit.
- A commit can be linked to a pull request when available.
- A direct rationale question returns a real source link.
- An unsupported question produces a clear abstention.
- Conflicting sources are shown together.
- Confidence includes a human-readable reason.
- Graph relationships appear in the retrieval path.
- No credentials or private environment values appear in responses or logs.

## Demonstration script

1. Show the repository setup and indexing status.
2. Ask a direct question about a specific workaround or configuration choice.
3. Open the cited source and verify the answer.
4. Ask whether the decision later changed.
5. Show the timeline and any later evidence.
6. Ask a question with no supporting history.
7. Show the explicit abstention.
8. Demonstrate Hinglish only if the optional language integration is configured.

## Reporting rules

Report the actual number of questions tested, correct answers, incorrect answers, abstentions, citation failures, and timing results. Do not claim a metric based only on intended behavior.

## Executed automated evaluation

`npm run evaluate` checks eight questions on two real public repositories (Hello-World and Express), including implementation, attribution, ambiguity, missing evidence, and hostile instructions. Results and timings are recorded in [evaluation-results.json](evaluation-results.json). These are automated expected-behavior checks, not a representative human claim-accuracy study. A larger expert-labeled corpus and independent human review remain necessary before publishing accuracy claims.
