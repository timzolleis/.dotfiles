# Design it twice

Your first interface is rarely the best one (Ousterhout). When a shape is unclear or contested, produce several radically different interfaces and compare them before recommending one. Terms are defined in `effect-architecture/vocabulary.md`.

1. **Frame the problem space** for the user: the constraints any interface must satisfy, its dependencies and their categories (`effect-architecture/deepening.md`), and the current module map ([SKILL.md](SKILL.md)) that makes the constraints concrete. It is a frame, not a proposal.
2. **Design 2–3 interfaces under different constraints.** Use parallel sub-agents when the harness offers them, each with its own technical brief (files, coupling, dependency category, the `CONTEXT.md` terms); otherwise design them one after another. Pick constraints that pull apart:
   - minimal: 1–3 entry points, maximum leverage per entry point;
   - common caller: make the default case trivial;
   - ports and adapters around the cross-seam dependencies.
3. **For each design, show** its module map and the module section of its main seam (formats in [SKILL.md](SKILL.md)), one caller using it, what it hides behind the seam, its dependency strategy, and where its leverage is high or thin. The shared formats make the designs comparable line by line.
4. **Compare** by depth, locality, and seam placement. Then recommend one, or a hybrid, and say why. The user wants a strong read, not a menu.

Complete when the user has picked a design or a hybrid, and it is locked in the spec.
