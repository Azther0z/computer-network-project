# Contributing

This is a proposed workflow for review at the first team meeting. Roles and review rules are not settled.
Read the [requirements](docs/requirements.md) before planning a task. Keep changes tied to requirement IDs when applicable.
The repository currently contains documentation and source evidence. It has no application build or test suite.

## Proposed workflow

1. Agree on the task and its requirement IDs before implementation.
2. Use a focused branch, such as `feature/private-chat` or `docs/demo-plan`.
3. Make small commits, such as `feat: add private chat rooms` or `docs: explain message framing`.
4. Open a pull request that states the change, affected requirements, and evidence from relevant checks.
5. Ask a teammate to review the change before merging.

A pull request is a request to review and merge a branch. Use synthetic messages for public demonstrations and screenshots.
When AI helps produce code, retain the relevant prompts without credentials or private data. The presentation template includes prompt fields.
Record code evidence while implementing each requirement. Make sure that everyone can explain the submitted code.

## Source evidence

Keep exactly two PDFs in this repository. Preserve the original names and bytes in `docs/sources/`.
Use Markdown and image files for additional documentation. Keep final presentation exports outside this repository if they are PDFs.
The [ingestion record](docs/sources/README.md) explains the derivative files and their integrity information.
