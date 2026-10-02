# Design it twice

Your first interface is rarely the best one (Ousterhout). When a shape is unclear or contested, produce several radically different interfaces and compare them before recommending one. Terms are defined in `effect-architecture/vocabulary.md`.

1. **Frame the problem space** for the user: the constraints any interface must satisfy, its dependencies and their categories (`effect-architecture/deepening.md`), and a rough sketch that makes the constraints concrete. It is a frame, not a proposal.
2. **Design 2–3 interfaces under different constraints.** Use parallel sub-agents when the harness offers them, each with its own technical brief (files, coupling, dependency category, the `CONTEXT.md` terms); otherwise design them one after another. Pick constraints that pull apart:
   - minimal: 1–3 entry points, maximum leverage per entry point;
   - common caller: make the default case trivial;
   - ports and adapters around the cross-seam dependencies.
3. **For each design, show** the interface (types, invariants, ordering, error modes), one caller using it, what it hides behind the seam, its dependency strategy, and where its leverage is high or thin.
4. **Compare** by depth, locality, and seam placement. Then recommend one, or a hybrid, and say why. The user wants a strong read, not a menu.

Complete when the user has picked a design or a hybrid, and it is locked in the spec.
