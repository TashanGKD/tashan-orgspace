# OrgSpace v1 Program Execution Map

## Execution order

```text
P1-01..07  Storage contracts and file services
P1-09      MinIO local/AUP data plane
P1-08      API/SDK/CLI/Skill executable slice
P1-10..12  Web / gates / acceptance
P2-01..06  Collaboration / Work / Process / OKR
P2D-01..05 Partners / Interactions
P3-01..05  Notifications / SMS / Reminders
P4-01..06  Chat / Search / My Work / Admin
P5-01..05  Gates / Recovery / Journey / Release
```

## Hard gates

| Before | Required evidence |
|---|---|
| Phase 2 | Phase 1 FileEntry/ResourceLink attachment contract and permission tests green |
| Phase 2D | WorkItem task/meeting capabilities and SensitiveFieldCipher tests green |
| Phase 3 | DomainEvent schemas for Work/OKR/Partner frozen and outbox replay green |
| Phase 4 | File links, WorkItem conversion and notification events green |
| Phase 5 | Every Phase 1–4 module available with API/Web/CLI/Skill parity |

## Commit and deployment discipline

- Execute plans in listed order; do not parallelize migrations sharing the same next number.
- Every task starts RED, ends green and creates one focused commit.
- Keep `main` deployable; deploy at Phase checkpoints, not after every migration.
- Amend future plan files only in explicit `docs(plan)` commits with source evidence.
- Compute/hosting remains protected by `check-deferred-product-scope` throughout.

## Checkpoints

1. Phase 1 file acceptance and MinIO recovery.
2. Phase 2 organization work/OKR acceptance.
3. Phase 2D partner privacy and transfer acceptance.
4. Phase 3 simulated matrix plus one approved real SMS.
5. Phase 4 multi-user realtime/search acceptance.
6. Phase 5 clean-commit production release.
