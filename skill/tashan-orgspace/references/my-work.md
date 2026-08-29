# My Work

`my-work` aggregates current references across every organization where the signed-in account is still an active member.

```bash
torg --invocation-source ai_via_cli --json my-work list
torg --invocation-source ai_via_cli --json my-work list --kind task
```

Items are references to their organization routes, not copied business records. If membership is lost, the item must disappear rather than remain available from a cached result. Use each returned `href` or resource ID exactly.
