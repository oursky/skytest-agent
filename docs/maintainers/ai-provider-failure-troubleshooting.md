# AI Provider Failure Troubleshooting

Use this runbook for Midscene/OpenAI-compatible configuration failures.

Before changing package versions, always run doctor first:

```bash
SKYTEST_ALLOW_KEY_AUDIT=1 npm run --workspace @skytest/web runtime:ai-config-doctor -- --run-id=<run-id>
```

You can also diagnose by team:

```bash
SKYTEST_ALLOW_KEY_AUDIT=1 npm run --workspace @skytest/web runtime:ai-config-doctor -- --team-id=<team-id>
```

## Signature Table

| Signature | Likely cause | First action | Follow-up |
|---|---|---|---|
| `ByteString ... >255` | Malformed key/header characters | Run doctor and inspect `keyShape.reason` | Re-save team AI key in Team Settings |
| `401 Unauthorized` | Invalid or expired provider key | Run doctor first | Rotate provider key, then re-save in Team Settings |
| `404 model not found` | Wrong model name or base URL mismatch | Run doctor first | Correct team AI model/base URL config |
| `MIDSCENE_MODEL_FAMILY is required` | Missing model family config | Run doctor first | Set team model family or `SKYTEST_MIDSCENE_*_FAMILY` overrides |
| DNS/network failures | Runner cannot reach provider endpoint | Run doctor first | Check runner DNS/network guard logs and outbound access |

## Notes

- `ai-config-doctor` never prints API keys.
- `SKYTEST_ALLOW_KEY_AUDIT=1` is required because the command decrypts stored team keys in-process.
- If doctor returns `status: "fail"`, complete remediation first, then re-run doctor until `status: "pass"`.
