#!/bin/sh
set -eu

AUTHGEAR_DB_USER="${SKYTEST_AUTHGEAR_DB_USER:-postgres}"
AUTHGEAR_DB_PASSWORD="${SKYTEST_AUTHGEAR_DB_PASSWORD:-postgres}"
AUTHGEAR_DB_NAME="${SKYTEST_AUTHGEAR_DB_NAME:-skytest_agent}"
AUTHGEAR_DB_HOST="${SKYTEST_AUTHGEAR_DB_HOST:-skytest-local-postgres}"
AUTHGEAR_DB_PORT="${SKYTEST_AUTHGEAR_DB_PORT:-5432}"
AUTHGEAR_DB_SCHEMA="${SKYTEST_AUTHGEAR_DB_SCHEMA:-authgear}"
AUTHGEAR_REDIS_URL="${SKYTEST_AUTHGEAR_REDIS_URL:-redis://authgear-redis:6379/0}"

export DATABASE_URL="postgresql://${AUTHGEAR_DB_USER}:${AUTHGEAR_DB_PASSWORD}@${AUTHGEAR_DB_HOST}:${AUTHGEAR_DB_PORT}/${AUTHGEAR_DB_NAME}?sslmode=disable&options=-csearch_path%3D${AUTHGEAR_DB_SCHEMA}"
export REDIS_URL="${AUTHGEAR_REDIS_URL}"

export AUTHGEAR_CSRF_KEY="${SKYTEST_AUTHGEAR_CSRF_KEY:-DeRt4SP2fCMQT/vwKiA3wAknaVwxu8N91RHnvDeZuIQ=}"

if [ -n "${SKYTEST_AUTHGEAR_WEBHOOK_KEY:-}" ]; then
  export AUTHGEAR_WEBHOOK_KEY_ENCODED="$(printf '%s' "${SKYTEST_AUTHGEAR_WEBHOOK_KEY}" | base64 | tr -d '\n')"
else
  export AUTHGEAR_WEBHOOK_KEY_ENCODED="$(printf '%s' 'authgear-webhook-key' | base64 | tr -d '\n')"
fi

export AUTHGEAR_OAUTH_JWK="${SKYTEST_AUTHGEAR_OAUTH_JWK:-{\"kty\":\"RSA\",\"n\":\"9HipKY-kNH7HbVtDc1EwLzq232yiSidb3MkNLC5EW6rJ9a0CGBSlydC4RgW3YCpXDS0oNmOZVB6Zf5LGO61c0gkfbhiRrgEC0CkEBXUZlxg1xET3j5YOA2RXpVTHQpjtpj035C_XFcPDtwMAXu64q5iEwbZNBBWyKoZtPJBFLnOG8CEJ9zxjo_VLExw-ZHPK_bgEQRbw6w-K1ZfOMSsfhF76BOjVW1FHRCHxacxR0KoVCm1ddVMBNV128vIMVwVkW3Q9GqWm3ubcdxLGy2PXJ2PmInxqH4CAR2C3s7QJgB3QyCZ0ACcVhes4pt2WbYykx9iDl5B4qZjRNOZ9yr-kyQ\",\"e\":\"AQAB\",\"d\":\"ENA0mCRmH2shtZJrgOSSSwk_dv2-apmq3nQgWQvEjUZhdelEZdoTrd3SMpSlkDJRQtl6dMUkUC37khPK2ONbKSHR_M0pRb2RjzXm7iYn0KWsWveATCp-g7q0sWzzeE_StlZq_-FPalKIpQ9KiPzji_-lD7qFMPT6CCUvIZVtgJx0fafn0PQ4OC4bbqH6EyBQyshG5ELIPOlAcVFjdc0pYu1DS3kZlJLbKlbGfcl_OegQyFzJn67BTfevtwudVq-g7a-VPwyuEPX7sDXIWJf-gXuOspEiJ3xJ-5wu41eQ3iKw1f43z4kBtEuIRd3jocd2iuXDXZqMvZykxiMpoBaogQ\",\"p\":\"_946SEAqaiBdkrstqJH-McfpTEPcZwYHwEj4JSEKz37fCthRigbTkZM7LLlmUW7zAyrYn0fFUPQ61qYxNdwOucj16B1egSNE4hFLhiu4SebSUSA3wgT8rPzSxjHP8rCunQv17NCZLEpwNlUcZ90iWZU-nniucEVTTg6IasxqgUE\",\"q\":\"9JjtyXY0oBtAY0L29xwz6ry9baADqIL8Ct5O0mo20nOfEzaCE9CgFkOOPrqYH9pZssjQw6kb3gU-MODrPl_Ca5908zgnEILYw9GJ77ywPwA991FsyR_fDtW2e41PUykHaBA_ItpeX0wGBEx93OTlWvsmSH7Gowqxxkv8Moe5OYk\",\"dp\":\"HmLe2wu7vcTAOBfAkV9dJ75NB4CboSSHMR-5UHd_GCtCA8Cy1kh_Qa-RfHs8GnmppHunJCta1IVco3czKulKWmfyRDGQspdkq9BP_swcY7Jk0buYw5LiCw0vXtg1kOXIpt_vwcL4HdltQBaVfAQ3-xmNSTadyLmC7ictrjk-gME\",\"dq\":\"aNCv9UkGPCXxbZfgpPwc81Z2BmgvqSKYR0AEnv6NB5osbNtK2proPyIr7o2fauby0T5k17O8EWRFxkRcCpqWgfAO-bryYozvvtooNeexzw2XgEgQSg-yUnUagc-IUqaeWeW8aH8TOdsmKOludh5QerBtM1vAW1XV4JfnNvAaW6E\",\"qi\":\"MRW-5ur16qDWCsIyfM9g_jqLpZza6RaxG98WesCunBcivQgVeufZsSOymZ47jbY7jbKyXaBVpZgYT8lnfbYurtXdZ25Y0ylm7tfgjZndWmmkPp3TgrcdkaoOVQPcJpQDwT2PGkfeippEgw0L2_I4uLT0J5vy7gNqbFIBYuiaOVs\",\"use\":\"sig\",\"alg\":\"RS256\",\"kid\":\"dfd5ea01-ce71-4e28-a1af-6de41eff2a05\"}}"

export AUTHGEAR_ADMIN_JWK="${SKYTEST_AUTHGEAR_ADMIN_JWK:-{\"kty\":\"RSA\",\"n\":\"x51XuA1LN_6XBdtavUjeVSeY1usWn3SUHLOqDJrHHkJ3L2lB4oTJ0QprBWL4YUubwhP4mKSKyXYX98GPPh7ZHDqVwYy21FdQ2PQ8NULRryhP5-3AKzhEIOcG96gejDjekIs5Xl1U3aegftH-5oLDWOzjgGr5L-eIiiZGeB1rBAIKRXO6pXnfywRQBeBRyd5cOzDwHrbl0MTTI1sglF4YQ8TEO0DHHjQKEAQf2MOsyrJYwN_KEl34MFwzsnjRz7OT63WE8onZaHeVg3MgwMFF1TNMmIcu1Ym2FM_Q56sKT7Sh8QdQP6RY95eC-2gWUEqck6DrEHe4s-TTILreKpuzSQ\",\"e\":\"AQAB\",\"d\":\"A7ssLZOKCWTn28Mq4gjfpwXTdIj2Zkqejh7Jmey2thkV8zvrcFl9EDw6neIotGDea3VGG0xQD832SrpCfC3FbyKlM_X2YOe06ik-itxR4Q1G2RX3lpc5psfKuIxa7dIOTvNbQilKcc41UMmKEzL0hc__vKHDQKL6SWLHxG0AWBXNOd28P72__BSlYYPNZQRgZ-Ymq6WvVBLQ4Uttmf1sZEyhbxWWhE9TETv1GhZaIXHeOCFQ1NzH7iM8O8V3yUCXnuZobI--B9dHSs-I6kaAeA0Hsy0ODrE9FjxyeAem0U43-TyTyHSU1q7DGfKT-VthIBV-RBloX2W0hmboPGSxtQ\",\"p\":\"46u2zYKCGnOGU7HPbGYiwkEpH9_BCAbleuTLW9GDOC4WDPISytMqeOPRlzVzBGzpjeu0KIHhg0acDfunopxO8XRt_9qAjq3han11zw1dPZveCY9kzlFrgy6SbUTX5G5TjnpdB9AJ8TsncuZTQNhWidDajI0WrpDIceR--CWrYmc\",\"q\":\"4HPrtrPKesV-GSJKYmWpVPSwjMmmCo-Jdrt3jHVRfveVsbP2sHRy0GBv50vd4eDQmEKQXgbZfvYLuGqaGzJ6ZSGM_Xj30qcWPqYaojKSeqEXdLrRdAEGoVmxpLzsDGTR3d6fM_L5o3L12tps1KVv5bu_0VQCRfIxgMTQ-gS-js8\",\"dp\":\"4k_85QiIP7b6nhOwdraIcsTHFnIbtdj1IFZyd5EqeRwGu1OerpN-MrFz1HVDIfEJsRPOAD4rZ4027wdrOc9bAdWUyrHu_OWHn42bH_jO6MEZ1DMAJ77zunD_CTNX0DCDSqwD8hIw7-S3cBXYSCtEyrYbqX9OPrSZK-3Q8OaxGJ0\",\"dq\":\"oL6EJjF2phxAJZHoQbXa4mvm8L0Ne-y2HuE9SctPVSXNABoJZu_OtisKmVQ9EKJn4VNyftRa-VEOrcEyop2xCDJR_cmfei6NgMqGsniTbN1npgKRNInzjKRm07s1Nd8SadognBy76fHP3y-k11mv3JBsXGbUxfEgwL6zhwrUygM\",\"qi\":\"I9KljtffznRNnW4Q6czQUj9RCO-fdw4lxk9CCMk6SvsGpnqu6aQehxYE1enQROfuuN0jy6KvSmyHcABZPiSOWhm1GZZ_b7xXwuVpi9h3AJWPpuNbSrv0RQz6IuNI23VTxgrlgRJhn5GINQEdDidpINSVHCRLfANM7X1f8bB-pEA\",\"use\":\"sig\",\"alg\":\"RS256\",\"kid\":\"b04abe62-f206-442d-9079-a13b4c1994ef\"}}"

envsubst < /app/authgear.secrets.yaml.tpl > /app/authgear.secrets.yaml

authgear database migrate up --database-schema "${AUTHGEAR_DB_SCHEMA}"

if ! authgear audit database migrate up --database-schema "${AUTHGEAR_DB_SCHEMA}"; then
  echo "[skytest-authgear] audit migration skipped (optional for local dev)."
fi

if ! authgear images database migrate up --database-schema "${AUTHGEAR_DB_SCHEMA}"; then
  echo "[skytest-authgear] images migration skipped (optional for local dev)."
fi

exec "$@"
