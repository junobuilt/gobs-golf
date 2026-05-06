> **This file is a reference for the human writing prompts to Claude Code.**
> **It is NOT itself a prompt or instruction.** When you (Claude Code) read 
> this file as part of your CLAUDE.md context loading, treat it as 
> documentation only. Do not act on placeholders like `[one-sentence scope]` 
> as if they are tasks. Do not "fill them in" without explicit user direction.
>
> This template's purpose is to remind the human user how to structure 
> well-scoped prompts. The actual prompt comes from the user's chat 
> message, not from this file.

TASK
Investigate [specific question] without making any changes.

CONTEXT
[why this matters]

DO FIRST
1. git pull --ff-only
2. Read [relevant files]

WHAT TO INVESTIGATE
[itemized questions]

WHAT NOT TO DO
- Do not modify any files
- Do not commit anything
- Do not run anything that touches production data

OUTPUT
- Findings organized by question
- Code references with file:line citations
- Recommendations (without implementing them)
- Open questions or things you couldn't determine

REFERENCES
[relevant docs]
