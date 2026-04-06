secrets:
  - key: db
    data:
      database_schema: authgear
      database_url: "${DATABASE_URL}"

  - key: search.db
    data:
      database_schema: authgear
      database_url: "${DATABASE_URL}"

  - key: redis
    data:
      redis_url: "${REDIS_URL}"

  - key: csrf
    data:
      keys:
        - alg: HS256
          kty: oct
          kid: "csrf"
          k: "${AUTHGEAR_CSRF_KEY}"

  - key: oauth
    data:
      keys:
        - ${AUTHGEAR_OAUTH_JWK}

  - key: admin-api.auth
    data:
      keys:
        - ${AUTHGEAR_ADMIN_JWK}

  - key: webhook
    data:
      keys:
        - alg: HS256
          kty: oct
          kid: "webhook"
          k: "${AUTHGEAR_WEBHOOK_KEY_ENCODED}"
