TASK
[one-sentence scope]

CONTEXT
[3-5 sentences: where we are in the project, what came before,
why this work matters now]

DO FIRST
1. git pull --ff-only
2. Read [relevant docs in order]
3. Investigate [specific things to look at]
4. Show me the plan covering [a, b, c, d]
5. WAIT for approval

WHAT TO CHANGE
[itemized list with explicit specs]

WHAT NOT TO CHANGE
- Do not refactor unrelated code
- Do not "clean up" outside scope
- Do not modify Decisions Locked section
- If bugs found, log but don't fix
- If subtle behavior change found, STOP and report

VERIFICATION
1. [tests/snapshots/specific checks]
2. tsc --noEmit
3. git diff walkthrough grouped by item
4. List anything considered but not changed

COMMIT
- Commit directly to master
- Push to origin/master
- Commit message: "[specific]"
- Update ROADMAP if [conditions]

REFERENCES
- ROADMAP.md (relevant phase)
- [other docs]
- Recent commits: [hashes for context]
