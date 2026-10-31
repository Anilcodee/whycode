# WhyCode — demo and pitch

## Core message

WhyCode helps a developer follow an explanation back to the repository records that support it. The strongest demo is a real question, an inspectable citation and the connected context—not a tour of every screen.

## Three-minute recording plan

This is a suggested duration. Follow the submission portal's actual limit.

| Time | Screen/action | Simple Hinglish narration |
| --- | --- | --- |
| 0:00–0:20 | Home; project name and repository input | “Hi, hum HackFront India ke liye WhyCode bana rahe hain. Jab hum kisi naye codebase mein aate hain, code batata hai kya ho raha hai. Lekin kisi change ke peeche ka context commits, PRs aur issues mein scattered hota hai.” |
| 0:20–0:40 | Connect a rehearsed public repository; show indexing coverage | “Yahan public GitHub repository connect kar sakte hain, bina login ke. Hum source files ko ek revision par pin karte hain aur history ka selected window collect karte hain. Ye coverage visible hai; hum poori history cover karne ka claim nahi karte.” |
| 0:40–1:15 | Ask a focused, rehearsed question; show actual result | “Ab ek specific question poochte hain. WhyCode relevant records retrieve karta hai, answer draft karta hai, citations aur quoted text check karta hai, phir ek separate model review karta hai.” |
| 1:15–1:45 | Open a citation, read excerpt and original GitHub record | “Main answer ko sirf accept nahi kar raha. Is citation par click karke original source, date aur excerpt dekh sakta hoon. Isse judge kar sakte hain ki explanation ko evidence actually support karta hai ya nahi.” |
| 1:45–2:05 | Timeline then Connections; select node and zoom/drag | “Timeline changes ka order dikhati hai. Connections mein selected node ka path root se highlight hota hai. Zoom aur drag se context explore kar sakte hain.” |
| 2:05–2:25 | A rehearsed question lacking recorded rationale; show actual abstention if obtained | “Har decision ka reason history mein recorded nahi hota. Agar support nahi milta, WhyCode explanation withhold kar sakta hai. Ye missing context ko fabricated certainty se fill nahi karta.” |
| 2:25–2:45 | Signed-in workspace, saved investigation and deletion; use an already authenticated account | “Account workspace mein investigations save hoti hain. Guest work import karna explicit choice hai. Private repositories ke liye separate read-only GitHub App permission chahiye. User apna saved work delete bhi kar sakta hai.” |
| 2:45–3:00 | Return to answer/source view; final URL | “WhyCode ka goal hai: code samajhne ke saath uske evidence ko bhi samajhna. Read the code. Trace the change. Understand the decision.” |

If an answer is withheld during the main question, show the actual reason and use the rehearsed backup question. Do not fabricate an answer or imply a prerecorded wait was instantaneous. If waits are cut from the recording, label them as shortened. The workspace segment can be omitted for a shorter video; prioritize evidence inspection.

## Rehearsal checklist

1. Open the deployed app before recording and allow Render to wake up. Confirm health and integrations through the actual UI.
2. Choose a small repository and history window; wait for indexing to finish. Check that the selected question has evidence in that window.
3. Prepare one basic factual question and one documented rationale question. For `octocat/Hello-World`, try “Which commit introduced README, and who authored it?” Do not present this as proof that undocumented intent can be recovered.
4. Prepare a missing-evidence question, but verify the actual response before including it as an abstention example. The wording alone does not guarantee abstention.
5. Check citations, Timeline, Connections, saved work after refresh and deletion. Use a non-sensitive example.
6. Record at 100% browser zoom with readable text. Close unrelated tabs and hide account identifiers, credentials and private source excerpts.
7. If demonstrating private access, use a purpose-made repository with harmless sample content and proper authorization. Never reveal tokens or consent to access on someone else's behalf.
8. Play the final video back and verify link sharing from a signed-out browser. Keep spoken claims consistent with what is visible.

## Six-slide pitch outline

This is slide content planning, not an exported presentation.

| Slide | Title | Content and visual |
| --- | --- | --- |
| 1 | Code shows the change. Context explains the decision. | WhyCode name, `<?>` identity, one-sentence description and live URL. Use a clean product screenshot. |
| 2 | Repository context is scattered | One developer question surrounded by code, commits, PRs and issues. Name onboarding developers, contributors and maintainers; no unsupported time-saving statistics. |
| 3 | Ask, trace, verify | Three steps: connect repository → ask a focused question → inspect cited sources. Use a real answer and source inspector screenshot. |
| 4 | Evidence before explanation | Pipeline: collect → retrieve → generate → validate → review → answer or withhold. Explain Neo4j relationships and optional Sarvam output. |
| 5 | Built for clear ownership | Guest/account/private boundaries, explicit import and delete controls. State latest documented tests and deployment status without equating them to model accuracy. |
| 6 | Working prototype; measurable next steps | Show what works, bounded coverage and SMTP/hosting limits. Next: quality evaluation, task-time study and operational checks. End with demo and repository links. |

## Judge questions and concise answers

**How is this different from asking a chatbot about a repository?**

The workflow organizes source/history records, exposes citations and relationships, checks quoted text and runs a separate review. It can withhold unsupported conclusions. We do not claim that citations alone guarantee correctness or that the design is unique across all competitors.

**Can it tell us why any line was written?**

No. Intent may never have been recorded or may be outside the indexed window. It explains what available records support and can identify missing evidence.

**Why use Neo4j?**

Public context is connected: repository, file, person, change and discussion records relate to each other. A graph makes these relationships queryable and inspectable. Private snapshots are isolated separately rather than put in that public graph.

**What does Sarvam do?**

It optionally renders public explanations in Hindi/Hinglish after evidence processing. It does not replace repository retrieval or establish that a claim is true.

**Does private code go to an AI provider?**

Private questions and retrieved excerpts can be sent to the configured model provider after explicit consent. We restrict GitHub access, isolate/encrypt private runtime data and keep it out of the public graph, but do not claim zero data transfer.

**Where is guest versus account work stored?**

In the configured deployment, guest work is encrypted in temporary PostgreSQL records associated with an opaque browser cookie. Account work is saved in user-scoped tables. New investigations are not written to localStorage, and guest work is not silently merged at login.

**Does deleting a repository delete the source graph for everyone?**

Removing a public repository from a workspace removes that workspace's references/investigations. A reusable public source index may remain for other workspaces. GitHub data itself is untouched.

**What have you measured?**

The latest documented test/build gate passed 109 tests. Cross-instance database integration checks exercised selected reliability/isolation behaviors. We have not established a representative human answer-accuracy score or measured onboarding-time savings.

**Will this scale to arbitrary traffic or repositories?**

No unlimited-scale claim. The implementation has bounded indexing, request/answer limits and shared job coordination. Jobs currently run in API processes; broader load testing and operational validation remain future work.

**What is incomplete in this deployment?**

Public email delivery needs custom SMTP. Use guest or permitted social login for the demo. Render Free can sleep; sessions expire without automatic token refresh. Repository coverage and retrieval are bounded, and model mistakes remain possible.

**How did AI tools contribute?**

Codex assisted development, UI iteration, debugging, tests and documentation. Gemini and Sarvam are runtime services with different responsibilities. The team must review the final disclosure and be able to explain and demonstrate the submitted code.
