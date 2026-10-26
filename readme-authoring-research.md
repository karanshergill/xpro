# README authoring and maintenance research

Research date: 9 October 2026

This research supports a future reusable skill for creating a README for an initialized project or an existing codebase, and maintaining it after features, fixes, patches, and releases. It covers project discovery, content selection, change assessment, version boundaries, and verification. The proposed workflows below are a synthesis for the future skill; they are not a universal README standard.

The central recommendation is to derive the README from the project's actual audience, current capabilities, and verified workflows. A newly initialized project needs an honest description of what exists. An established project needs a reliable path to first use. A change or release needs an assessment of affected claims, with edits only where the reader's information needs have changed.

## Findings supported by the sources

### A README is an entry point

GitHub emphasizes purpose, usefulness, getting started, support, and maintainers. Google emphasizes directory or package orientation, status, usage, and links to fuller documentation. These support a readable introduction and a short route to success. They do not establish a universal section count or a requirement to reproduce all project documentation. [GitHub README guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes), [Google README guidance](https://google.github.io/styleguide/docguide/READMEs.html).

Diátaxis distinguishes learning, accomplishing tasks, looking up facts, and understanding explanations. A README can point to each kind of material while detailed tutorials, reference documentation, and architectural explanations retain their own homes. This is an organizing principle, not a requirement to create four new directories. [Diátaxis introduction](https://diataxis.fr/start-here/).

### Templates are starting points with a scope

Make a README provides a menu of possible sections and explicitly leaves selection to the developer. The Good Docs Project likewise allows reordering and removing content to suit the project. Standard Readme is different: it defines a specific opt-in convention for open-source libraries. Its strict headings, ordering, short-description length, and table-of-contents threshold should not become defaults for every application or private repository. [Make a README](https://www.makeareadme.com/), [The Good Docs Project README guide](https://www.thegooddocsproject.dev/template/readme), [Standard Readme specification](https://github.com/RichardLitt/standard-readme/blob/main/spec.md).

### Maintenance belongs with development

Google recommends updating affected documentation in the same change as the code and removing stale or duplicate content. Write the Docs recommends version control, code review, and appropriate automated checks as part of the documentation workflow. The practical inference for this skill is to assess documentation impact for each relevant change, rather than mechanically modify the README for every commit. [Google documentation best practices](https://google.github.io/styleguide/docguide/best_practices.html), [Write the Docs on Docs as Code](https://www.writethedocs.org/guide/docs-as-code/).

### Installation is a sequence

A study of 400 repositories and 1,163 installation-related README commits identifies changes to pre-installation instructions, installation, post-installation steps, help, presentation, and external resources. This supports checking the whole setup journey: prerequisites, required access, installation, configuration, first execution, and recognizable success. The study does not prove that one template is optimal for every project. [Installation instructions study, version 3](https://arxiv.org/abs/2312.03250v3).

### README state and release history serve different purposes

Keep a Changelog describes curated notable changes across versions. GitHub releases are associated with specific tags and can have publication dates different from tag dates. A maintained README should describe the state relevant to its reader and link to history and migration details. A release number alone does not establish whether README content has changed. [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), [GitHub releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases).

### Automated update recommendations need verification

The revised August 2026 README-maintenance preprint separates identifying whether an update is needed, locating the affected sections, and explaining the trigger. Its evaluation uses 25,511 pull requests from 714 repositories; the best configuration reports 28% user-facing accuracy under the observed update prevalence. Its retrospective analysis also finds missed documentation needs. This supports evidence-based review, not unconditional acceptance of generated edits. Earlier search snippets describe different figures; use the version actually consulted. [README maintenance study, version 2](https://arxiv.org/abs/2603.00489v2).

## Decisions the sources leave to the project

| Question | What the guidance establishes | Proposed decision for the future skill |
| --- | --- | --- |
| How long should the README be? | Guidance favors useful orientation and enough information to start; suggested templates vary. | Include necessary reader information. Move specialist depth to an existing authoritative document. Avoid an arbitrary word limit. |
| Must every suggested section appear? | Flexible guides allow omissions; a strict specification applies when adopted. | Select sections by need. Follow an explicit project convention when present. |
| Must every commit alter the README? | Affected documentation should accompany code changes. | Check impact. Preserve a README that remains accurate. |
| Should a README be written before code? | Readme Driven Development advocates early writing to clarify intended interfaces. | For a new project, describe intent as intent and distinguish it from runnable behavior. |
| Is a table of contents mandatory? | GitHub supplies an outline; some conventions set their own thresholds. | Add one when length, target renderer, or the project's convention makes it useful. |
| Should command examples contain prompts? | Google's command guide sometimes uses prompts, while emphasizing copyable examples. | Prefer prompt-free executable blocks in a repository README. Clearly label interactive transcripts. |
| Should a registry page match the repository immediately? | Registry behavior depends on the publication mechanism. | Verify the actual publishing surface; a repository edit may require a later authorized release to appear there. |
| Should a popular README be copied? | Mature projects demonstrate patterns, not universal requirements. | Borrow useful reader paths. Verify every project-specific command, claim, and policy independently. |

The first six rows synthesize the sources above with [Readme Driven Development](https://tom.preston-werner.com/2010/08/23/readme-driven-development.html) and [Google's command documentation guide](https://developers.google.com/style/code-syntax). Registry and example considerations are detailed below.

## Proposed workflow for the future skill

### Establish the audience and the target

Before choosing headings, establish:

- The file or files requested: repository root, an application, a published package, or several existing READMEs.
- The reader: end user, package consumer, contributor, operator, or internal teammate.
- The task: first creation, a full refresh, a targeted change, or release preparation.
- The state to describe: current checkout, a proposed change, a released package, or a specific tag.
- The hosting surfaces: repository browser, local clone, package registry, documentation website, or release archive.
- Existing project requirements for language, structure, approval, and terminology.

Infer these from the request and repository where possible. Ask only when an unresolved choice materially changes the content. Do not assume that a request to update a README authorizes publishing a release, changing repository settings, or editing every neighboring document.

### Inspect evidence before drafting

For a small project, inspection may be quick. For a mature project, inspect entry points and the flows necessary to verify proposed claims; reading every installed dependency is unnecessary.

| Evidence to inspect | What it establishes | Common inference to avoid |
| --- | --- | --- |
| Applicable project instructions and documentation conventions | Required workflow, terminology, protected settings, and writing rules | Treating an internet template as higher authority than the project's instructions |
| Existing README and linked docs | Audience, established structure, public claims, and authoritative destinations | Assuming all existing prose is still accurate |
| Manifests, lockfiles, toolchain files, and version constraints | Package manager, supported or configured versions, entry points, and scripts | Inferring supported versions from the author's installed tools alone |
| Build and development configuration | Working directory, runtime, ports, generated outputs, and local versus hosted behavior | Assuming the script runner is the production runtime |
| Setup examples and configuration code | Required variables, safe defaults, services, and credential sources | Reading or copying actual secrets |
| Representative source and tests | Implemented capabilities, usage contracts, and observable behavior | Advertising a planned feature because it appears in a specification |
| CI and release configuration | Available checks, environments, packaging, and publication flow | Claiming a check or release gate exists because a checklist proposes it |
| License and contribution files | Actual terms and contribution expectations | Adding a familiar license or contact address from boilerplate |
| Requested changes, commit range, release notes, and tags | What changed and which version the reader will use | Using the default branch as an unstated comparison baseline |

When instructions and implementation disagree, distinguish required policy from current behavior. A documentation task should not silently change application configuration to make the discrepancy disappear. Resolve the wording using evidence and identify any remaining implementation issue separately.

### Keep an internal evidence record

For each material claim, retain the source and verification state while drafting:

| Claim | Evidence | State | Writing consequence |
| --- | --- | --- | --- |
| A command exists | Manifest or command definition | Confirmed by inspection | Document exact invocation and working directory |
| A local startup works | Actual bounded local execution | Executed successfully | Describe the observed success condition |
| An advertised feature is available | Reachable implementation and relevant tests | Implemented; test coverage may vary | Describe behavior within the demonstrated scope |
| A feature is planned | Approved roadmap or specification | Planned | Label it as future work and link to its plan |
| A release is available | Published release or registry record | Released | Use the verified version or link |
| A production capability is proven | Relevant deployment or operational evidence | Unknown if not checked | Avoid an unsupported readiness claim |

This record is working material, not a required table in the final README. Distinguish inspected, executed, planned, and unknown; do not promote one state into another. Successful compilation alone does not establish successful setup, deployment, or production readiness.

## Behavior by project stage

### A newly initialized project

A useful README can exist before the product does. Document the intended problem and audience from the user's stated intent, then describe the actual initialized state.

Include real tooling requirements, the available local startup or build path, and what a reader should expect to see. Link to an existing plan when one exists. Keep unavailable workflows out of runnable instructions.

Do not invent:

- A published package, hosted demo, or release.
- Product functionality absent from the scaffold.
- Tests, CI, migration tools, or deployment guarantees.
- A complete environment setup whose variables and services have not been defined.
- A license, maintainers, commercial policy, or support channel.

If only a repository and project name exist, a brief purpose and status document is valid. An installation section is useful only when there is something installable or a verified setup procedure.

### A bare-bones implementation

Promote implemented capabilities into current usage while keeping significant limitations visible. A scaffold, prototype, and usable narrow implementation have different success conditions.

Prefer one working local path. Explain necessary services and setup in the order needed. A project that starts a blank page should describe that observable result rather than imply that the planned product is usable.

Do not retain generic framework-generated instructions that conflict with the actual package manager, directory layout, or runtime.

### A mature codebase with a missing or stale README

First preserve valid audience choices, links, and established terminology. Identify where reality has changed: prerequisites, installation paths, examples, defaults, supported platforms, configuration, module organization, and documentation destinations.

Reconstruct the shortest useful path from the current code and existing documentation. Distinguish installing a released product from developing a source checkout. Link detailed API, architecture, contribution, operations, and migration documentation.

A full rewrite is appropriate when the user requests one or when the existing structure materially obstructs understanding. Otherwise, prefer changes that repair inaccurate or missing information without unnecessary wording churn.

### A targeted update after a feature or fix

Use the actual change range or supplied patch. If the base is ambiguous, establish it before claiming coverage. Consider committed changes and relevant working-tree changes separately.

For each change, ask:

1. Does it change a capability the README describes?
2. Does it change installation, required tooling, configuration, or an example?
3. Does it change a limitation, workaround, compatibility statement, or support path?
4. Does it move a file or rename a heading referenced from the README?
5. Does it belong primarily in detailed documentation or release history?
6. Does the existing README already remain correct?

Edit the smallest set of affected claims and connected examples. Include related stale statements that the same change invalidates. An internal refactor can leave the README unchanged; an apparently small fix can require removing a documented workaround.

### A release

Identify the exact release target and its publication state. Check code, examples, compatibility claims, downloads, and linked documentation against that target.

Avoid mixing examples from the development branch with installation instructions for the latest stable package unless the distinction is explicit. Preview and unreleased features should be marked accordingly.

Changing a README does not authorize bumping versions, creating tags, uploading assets, publishing packages, or deploying software. Record such follow-up requirements when relevant to the requested documentation work.

## Content selection and ordering

The following is a menu. Use the sections that answer the actual reader's questions.

| Content | Include when | Information to capture |
| --- | --- | --- |
| Name and purpose | Normally | Recognizable project name, reader, problem, and concrete outcome |
| Status and limitations | Maturity or availability affects use | Current scope, experimental or archived status when established, significant restrictions |
| First useful example | There is a short demonstrable task | Small working example and a recognizable result |
| Prerequisites | Tools, access, or services are required | Supported versions, platforms, credentials or access requirements, and installation references |
| Installation and configuration | The reader must set up software | Verified steps, working directory, necessary options, safe configuration examples |
| Usage or local development | The main reader will use or change it | One primary path, commands, inputs, outputs, and next steps |
| Repository layout | Structure matters to contribution or operation | Major directories and responsibilities, with links where useful |
| Checks | The reader needs to validate a change | Actual tests, lint, type-check, or build commands; scope and setup requirements |
| Deployment or operations | Intended reader operates the application | Link to the authoritative runbook; give local and production procedures distinct context |
| Troubleshooting | Known common failures block first success | Recognizable symptom, established cause, and specific remedy |
| Documentation and architecture | Detail exists elsewhere | Purposeful links to user guides, API reference, design explanations, or decisions |
| Compatibility and upgrades | Versions differ in use or migration | Supported combinations, deprecations, migration guide, and release history |
| Support, contribution, and license | Established policies apply | Real destinations and terms, generally linked to their authoritative files |

Avoid a complete dependency inventory, a recursive directory dump, a full changelog, and large architecture discussions unless they directly serve the requested README. A concise tree can explain a monorepo; a constantly changing listing can create maintenance work without helping the reader.

For a private project, support may mean a known team or internal issue tracker. For an open-source library, installation and first API use generally deserve prominence. For an operator-facing service, configuration and safe environment selection may be central.

## Adaptation by project type

| Project type | Primary reader path | Useful extra considerations |
| --- | --- | --- |
| Library or SDK | Install the package, import it, perform one useful call | Import versus distribution names, compatibility, API docs, synchronous or asynchronous behavior, required credentials |
| CLI | Install the executable and run a meaningful command | Binary name, input files or standard input, representative output, help reference, exit behavior when needed |
| Web application or service | Prepare local dependencies, configure, start, observe the result | Local URL, build versus serve, browser/server distinction, backing services, preview versus production |
| Monorepo | Identify the relevant app or package and its workflow | Root orchestration, workspace selection, commands' working directories, package-level docs |
| Infrastructure or automation | Understand target environment and prerequisites before invocation | Planning or preview steps, resources affected, state and credentials, link to operations guidance |
| Research or data project | Identify data requirements and reproduce a bounded result | Provenance, access restrictions, computational requirements, reproducibility, expected output |
| Documentation-only project | Understand its content and how to navigate or contribute | No invented software installation; local preview only if a real toolchain exists |

These adaptations are proposed selection rules, not a commitment to exhaust every domain in the eventual skill. Domain-specific details should be discovered from the project and its authoritative documentation.

## Quickstart and command reliability

A proposed quickstart should be an executable reader journey:

1. State the working directory, required toolchain, and any external access needed.
2. Install or obtain the software using the project's actual workflow.
3. Configure only what is required for first use.
4. Start or invoke the software.
5. Explain the observable success condition.
6. Link the next task or detailed guide.

The authoring agent should trace wrapper scripts before documenting commands. A deployment wrapper that already builds should not be preceded by another mandatory build unless the workflow requires it. A root workspace command and a package-local command may require different directories.

Command blocks should separate inputs from output. Avoid optional syntax such as bracketed alternatives in a block intended to be copied verbatim. Define required substitutions and use language-appropriate comments for omitted code. Show output when it helps the reader recognize success, not simply to reproduce terminal noise. [Google command documentation](https://developers.google.com/style/code-syntax), [Google code samples](https://developers.google.com/style/code-samples).

Additional proposed validation rules:

- Do not guess familiar script names. Inspect the manifest, task runner, or CLI first.
- Distinguish the tool used to run scripts from the application runtime.
- Document supported version constraints from project evidence, not just local installed versions.
- State which shell or platform a platform-specific command targets.
- Keep local preview, deployment, package publication, and database migration separate in meaning.
- Use an existing safe example configuration; do not fabricate realistic-looking secrets.
- Explain required credentials without exposing them.
- Do not make permanent global settings changes as a hidden prerequisite.
- Do not claim multi-platform support merely because the code looks portable.

A README-writing task should verify commands proportionately. Prefer safe local checks and bounded smoke runs in an appropriate environment. It should not execute production deployment, publication, destructive reset, or live-data migration commands merely to test the prose.

## Change impact matrix

This matrix defines proposed checks for an update request. A change category triggers investigation, not an automatic heading or paragraph.

| Change | README information to inspect | Typical action if affected |
| --- | --- | --- |
| New public feature | Capability summary, first example, prerequisites, limitations | Add a short description or example; link deeper usage |
| Changed API or CLI interface | Imports, signatures, arguments, flags, defaults, outputs | Replace stale examples and direct readers to migration detail |
| Bug fix | Known issues, troubleshooting, workarounds, documented results | Remove or revise obsolete guidance; link release notes if useful |
| Internal refactor | Claimed behavior and any named paths or architecture | Usually preserve accurate prose; repair references that moved |
| Dependency or toolchain change | Supported runtimes, install procedure, native requirements | Update only constraints and steps that the reader must know |
| Configuration or environment change | Variable names, defaults, examples, local setup | Revise setup and point to the current configuration reference |
| Authentication or access change | Credentials, first-use steps, permission requirements | Explain the new reader requirement using safe examples |
| Database or storage change | Setup order, local data, migration requirements | Update reader-facing requirements; link the authoritative procedure |
| Build or deployment change | Command wrappers, artifacts, target environments | Correct commands and distinguish preview from production |
| File, route, or package rename | Relative links, headings, path references, package docs | Repair affected references and examples |
| Platform support change | Requirements and compatibility claims | Update the supported scope with evidence |
| Security fix | Obsolete security guidance and relevant upgrade instructions | Link an existing public advisory when appropriate; avoid unauthorized disclosure |
| License, ownership, or support change | Terms and contact destinations | Reflect confirmed policy; do not make the underlying policy decision |
| Documentation-only change | Navigation, anchors, language consistency | Repair affected navigation; avoid unrelated product claims |
| Release with no changed README claims | Version-specific links and publication requirements | Keep the content stable if it is still correct |

Use code and the actual diff to establish impact. Commit titles, release categories, and a file's extension are useful clues but cannot establish the complete reader-facing effect.

## Releases and distribution surfaces

### Version policy

Semantic Versioning defines meaning relative to a declared public API and distinguishes normal releases from prereleases. Apply those meanings only when the project adopts SemVer. Other projects may use calendar versions or their own policies. The future skill should read the project's policy and should not choose a release number. [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

For a release-oriented README update, proposed checks are:

- Which version, tag, and package or application does this document describe?
- Is the target already published, a draft, or preparation for publication?
- Are featured capabilities available in that target?
- Do examples use the same API or CLI as the documented install path?
- Are deprecations, removals, and required migration steps discoverable?
- Do download, documentation, registry, and release-history links lead to the intended version?
- Does the release process copy or transform the README into another artifact?

Do not rewrite history or alter released tags to make the current README appear retroactively correct. Fix current documentation and follow the project's process for versioned documentation corrections.

### Repository and package documentation

npm documents that a package README belongs at the package root and that its registry page updates when a new package version is published. A monorepo's root README may therefore be different from each package's consumer-facing README. Preparing a documentation edit is separate from authorizing that publication. [npm package README documentation](https://docs.npmjs.com/about-package-readme-files/).

PyPA documents supported markup, metadata needed for a package description, and validation with Twine. A README rendered correctly on GitHub still needs checking in its package context. Use the project's existing packaging toolchain; do not convert its configuration or install new tooling solely because one example guide uses a particular backend. [PyPI-friendly README guide](https://packaging.python.org/en/latest/guides/making-a-pypi-friendly-readme/).

For other registries and documentation hosts, discover their own rules when the target is known. In particular, check copied relative links and image paths, renderer-specific features, and whether publication captures a fixed README or follows a branch.

### Placement and multiple READMEs

GitHub can display a README from .github, the repository root, or docs, with .github taking precedence. Check which document actually supplies the repository landing page before assuming the root file is the visible one. Package and application READMEs can describe their narrower responsibilities without duplicating root setup. [GitHub README placement](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes).

## Markdown and accessibility

GitHub supports hierarchical headings, fenced code, relative links, and generated section anchors. Renaming a heading or reordering duplicate headings can change anchors and break links. The future skill should preserve stable navigation where possible and check inbound references when it changes headings. Prefer relative repository links for content that should follow the checkout; check other publication surfaces separately. [GitHub Markdown syntax](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax).

Use meaningful headings and link labels. Provide useful text alternatives for informative images and a text equivalent for essential visual instructions. Define unfamiliar abbreviations and keep instructions clear. Screenshots should add information that prose cannot convey as efficiently, and should not be the sole presentation of commands or required steps. [W3C accessible writing guidance](https://www.w3.org/WAI/tips/writing/).

Proposed README-specific checks:

- One clear document title, with an intelligible heading hierarchy.
- Language tags for code blocks and valid fences around nested examples.
- Blank lines around lists, code blocks, and tables.
- No machine-local absolute paths in published repository instructions.
- Accurate case-sensitive file links and actual anchors.
- Assets that exist, remain accessible to the intended audience, and match the current interface.
- Badges that describe an actual workflow, package, version, or status.
- No invented test or coverage badges.
- A text explanation when a diagram is needed to understand setup.
- Conservative use of HTML or host-specific features when the README is copied elsewhere.
- Preservation of an established README format such as reStructuredText when appropriate.
- Existing language and translation conventions respected; affected translations identified.

A manual table of contents is useful only when it improves navigation for the actual renderer and document length. It creates additional anchors to maintain.

## Ownership of information

| Information | Preferred authoritative home when it exists | README responsibility |
| --- | --- | --- |
| First useful experience | README or a short quickstart | Give a usable entry point |
| Full API or configuration catalog | API and configuration reference | Link the relevant reference |
| Feature and fix history | Changelog or release notes | Link history and highlight relevant upgrade information |
| Breaking-change procedure | Migration guide | Make the required migration discoverable |
| Architecture rationale | Architecture docs and ADRs | Provide a brief orientation and links |
| Contribution workflow | CONTRIBUTING or team documentation | Summarize how to begin and link the full procedure |
| Operational procedure | Runbook or deployment guide | Orient the appropriate reader and link the procedure |
| Agent instructions | Applicable agent instruction files | Avoid duplicating agent-only procedural rules |
| Licensing terms | The actual license files and confirmed policy | State accurate terms and link them |
| Future plans | Roadmap or approved specifications | Label planned work and link its home |

Licensing must be verified from actual terms. A public repository does not itself establish an open-source license, and an absent license is not a reason to invent one. Choosing or changing terms requires the owner's decision. [GitHub licensing guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).

When two documents disagree, identify which is meant to be authoritative and which claim needs correction. A README request should not silently reorganize the documentation system. Where another file also needs updating, act only within the authorized scope or report the dependency.

## Verification and delivery criteria

The future skill should verify the outcome rather than the presence of a generic set of headings.

### Factual review

- Every material command is tied to an existing definition or authoritative tool reference.
- Capability claims match the implemented or released state being described.
- Required setup is complete enough for the stated task.
- Toolchain and runtime requirements are not conflated.
- Working directories, ports, entry points, and outputs match the selected workflow.
- License, support, and contributor expectations have evidence.
- Planned and preview behavior is clearly distinguished from available behavior.
- Related examples and limitations agree with the updated claims.

### Behavioral and navigation review

- Run an appropriate local quickstart or bounded example when feasible and authorized.
- Reuse existing documentation lint, link checks, tests, or packaging validation.
- Check relative paths, assets, heading anchors, and renamed references.
- Inspect the intended renderer or existing preview when available.
- Use a clean or isolated environment when established local state could hide missing setup.
- Review external link failures before calling them broken; authentication and temporary errors require interpretation.
- Do not add a new dependency or CI workflow by default for a prose-only update.

### Editorial review

Read the title and headings as an outline. Then read the first-use path in order. Remove repeated background, stale claims, irrelevant template sections, and empty placeholders. Preserve useful existing wording and avoid an unrelated rewrite for a narrow patch.

Prefer concrete outcomes over unsubstantiated descriptions such as production-ready, secure, best, or fully tested. Evidence should support the specific claim being made.

### Handoff

A useful completion report states the file changed, why its content changed, checks actually performed, and any material unresolved requirement. If the README remains correct after an impact review, explain why no edit is needed. Do not claim that documented deployment or publication steps were executed if they were only inspected.

## Lessons from mature README examples

The ripgrep README illustrates a CLI-oriented entry point: purpose and important default behavior, documentation shortcuts, installation choices, release-history links, and a separate source-build path. It also includes detailed comparisons that suit that project's positioning. Borrow the separation of reader tasks, not its length or every optional section. [ripgrep README](https://github.com/BurntSushi/ripgrep/blob/master/README.md).

Requests illustrates a library-oriented opening with a small API example, installation, supported versions, and a capability summary. Its current README also includes a repository-specific cloning workaround. That is a reminder to verify context before turning a command from a popular project into general advice. [Requests README](https://github.com/psf/requests/blob/main/README.md).

Neither example establishes that its commands, toolchain requirements, metrics, or policies apply elsewhere. Popularity is not a substitute for checking current project evidence.

## Application to xpro as a concrete example

This is a local case study from the repository inspected in this conversation, not a universal requirement for other projects.

- The current application is a starter page, while the product plan describes a larger platform. A new README should preserve that distinction.
- Bun manages dependencies and scripts. Node.js is needed for the development tools; production runs on Cloudflare Workers. These roles should be stated accurately.
- Root scripts delegate to apps/web, so reader instructions need the correct working directory and actual root commands.
- The application deploy script already runs a build, so a mandatory build immediately before deployment duplicates that work.
- The intended role of apps/web is the workspace app; the Hub and router are planned separately.
- Test tools, CI checks, shared packages, and storage bindings described in planning should not be claimed as present.
- The release checklist calls for explicit environments, while the current deploy wrapper does not implement that requirement. Documentation should distinguish policy from the current scaffold.
- The protected Worker name and other project rules belong in the project's authoritative guidance. A general skill should discover such invariants instead of hard-coding xpro's settings.

The future skill must generalize the reasoning: verify status, follow declared tooling, trace wrappers, respect local invariants, and distinguish intent from implementation. It should not enforce Bun, Cloudflare, xpro's directory names, or its documentation structure on unrelated projects.

## Proposed design of the future skill

The eventual skill should provide decision-making guidance, not bundle an exhaustive documentation textbook.

Its entry point should cover:

- When to use it: create, refresh, or maintain a repository, application, or package README.
- How to establish audience, target revision, lifecycle stage, and scope.
- How to gather repository evidence before making claims.
- How to choose relevant content and a usable first-use path.
- How to assess a change and preserve a correct README.
- How to validate and report the outcome.

Supporting references can hold substantial lifecycle, release, renderer, and verification details. Read those only when they apply. An adaptive outline is useful; a rigid template with mandatory empty sections is not.

A possible implementation could use these supporting resources:

| Resource | Purpose |
| --- | --- |
| Project discovery reference | Evidence sources, scope, and claim verification |
| Content and audience reference | Conditional sections and project-type adaptations |
| Change and release reference | Impact matrix, target revision, publication surfaces |
| Verification reference | Local execution, links, rendering, factual and editorial checks |
| Research reference | Source rationale and limits for future maintenance |

Create scripts only if repeated work genuinely benefits from reliable automation. Reuse an existing Markdown parser or checker where appropriate; avoid building a fragile regex-based substitute for Markdown link and anchor semantics.

The skill should discover current facts from each project. It should not freeze changing ecosystem versions, package commands, hosting behavior, or registry policies into universal instructions. Consult current official documentation when such details become relevant.

### Cases worth testing when the skill is built

| Scenario | Expected observable behavior |
| --- | --- |
| Repository initialized with no runnable software | Produces an honest purpose and status document; no invented install or test commands |
| Bare scaffold with a real development script | Documents the actual startup path and visible result; future features remain planned |
| Mature library whose README is missing | Provides installation and first API use from current evidence, then links detailed reference |
| New public CLI flag | Updates the affected invocation and examples, with the proper version context |
| Internal refactor preserving public behavior | Leaves correct README content intact |
| Fix removes a documented workaround | Removes or revises the obsolete advice |
| Dependency update raises the supported runtime | Updates requirements using evidence, rather than listing every transitive change |
| Monorepo changes one package | Updates the appropriate package documentation and relevant root navigation |
| Release target lacks a feature present on the default branch | Keeps stable-install instructions and development capabilities distinct |
| README is consumed by a package registry | Checks package location, metadata, and rendering; identifies publication follow-up |
| Heading or file rename | Repairs affected links and anchors |
| License is absent or conflicting | Does not invent rights or change legal terms |
| Private project has no public support channel | Does not invent an issue tracker, email address, or open-source contribution policy |
| Validation would require a live mutation | Verifies what can be checked safely and reports the remaining requirement accurately |

These are behavior tests for the future skill, not tests added to xpro in this research round.

## Source catalog

All sources below were consulted during this round. The first four revisit the previous recommendations. Sources provide guidance, platform behavior, examples, or empirical findings with different scopes; their inclusion does not make every suggestion mandatory.

### Previously discovered sources revisited

1. [GitHub — About the repository README file](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes). Entry-point content, placement precedence, relative links, and repository rendering.
2. [Google — READMEs](https://google.github.io/styleguide/docguide/READMEs.html). Orientation, status, package-level responsibility, contacts, and deeper documentation.
3. [Danny Guo — Make a README](https://www.makeareadme.com/). Adaptable section suggestions, requirements, examples, support, and project status.
4. [Daniele Procida — Diátaxis introduction](https://diataxis.fr/start-here/). Distinct documentation needs and separation of explanation, reference, tasks, and learning.

### Additional sources

5. [Google — Documentation Best Practices](https://google.github.io/styleguide/docguide/best_practices.html). Maintaining affected docs alongside code, reducing stale material, and linking to authoritative explanations.
6. [The Good Docs Project — README template guide](https://www.thegooddocsproject.dev/template/readme). Audience, useful description, setup stages, conditional sections, and smaller READMEs.
7. [Richard Littauer and contributors — Standard Readme specification](https://github.com/RichardLitt/standard-readme/blob/main/spec.md). A scoped convention for open-source libraries; useful when explicitly adopted.
8. [Eric Holscher and the Write the Docs community — Docs as Code](https://www.writethedocs.org/guide/docs-as-code/). Version control, collaborative review, and automated checks as documentation practices.
9. [Tom Preston-Werner — Readme Driven Development](https://tom.preston-werner.com/2010/08/23/readme-driven-development.html). An early README can clarify intended behavior and interfaces before implementation; a practitioner perspective published in 2010.
10. [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Curated version history, change categories, unreleased changes, and upgrade-relevant information.
11. [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html). Public API compatibility, prereleases, and released-package invariants for projects following this scheme.
12. [GitHub — About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases). Tags, release dates, artifacts, and release notes.
13. [Google — Document command-line syntax](https://developers.google.com/style/code-syntax). Runnable examples, argument notation, shell context, prompts, and useful output.
14. [Google — Code samples](https://developers.google.com/style/code-samples). Explaining samples, indicating omissions, and respecting language-specific conventions.
15. [GitHub — Basic writing and formatting syntax](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax). Headings, code blocks, anchors, relative links, and image markup.
16. [W3C WAI — Writing for Web Accessibility](https://www.w3.org/WAI/tips/writing/). Meaningful titles, headings, links, image alternatives, and clear instructions.
17. [GitHub — Licensing a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository). Verify actual terms and distinguish public visibility from licensing.
18. [npm — About package README files](https://docs.npmjs.com/about-package-readme-files/). Package-root placement and the publication boundary for registry updates.
19. [PyPA — Making a PyPI-friendly README](https://packaging.python.org/en/latest/guides/making-a-pypi-friendly-readme/). Description metadata, supported markup, and package rendering validation.
20. [Gao, Treude, and Zahedi — Adapting Installation Instructions in Rapidly Evolving Software Ecosystems, version 3](https://arxiv.org/abs/2312.03250v3). Qualitative installation-maintenance research; revised 7 January 2025.
21. [Gao, Lin, Treude, Gay, and Zahedi — Does My README File Need To Be Updated? Exploring LLM-Based README Maintenance, version 2](https://arxiv.org/abs/2603.00489v2). Evidence and limitations for change detection and localized update recommendations; revised 21 August 2026.
22. [BurntSushi and contributors — ripgrep README](https://github.com/BurntSushi/ripgrep/blob/master/README.md). A mature CLI example; observe task separation rather than treating all content as general guidance.
23. [Python Software Foundation and contributors — Requests README](https://github.com/psf/requests/blob/main/README.md). A mature library example with usage and installation prominent; repository-specific instructions remain contextual.

