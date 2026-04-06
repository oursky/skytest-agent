import { createPrivateKey, createSign } from 'node:crypto';
import { createRequire } from 'node:module';

const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { PrismaClient } = webRequire('@prisma/client');

const DEFAULT_ADMIN_JWK =
    '{"kty":"RSA","n":"x51XuA1LN_6XBdtavUjeVSeY1usWn3SUHLOqDJrHHkJ3L2lB4oTJ0QprBWL4YUubwhP4mKSKyXYX98GPPh7ZHDqVwYy21FdQ2PQ8NULRryhP5-3AKzhEIOcG96gejDjekIs5Xl1U3aegftH-5oLDWOzjgGr5L-eIiiZGeB1rBAIKRXO6pXnfywRQBeBRyd5cOzDwHrbl0MTTI1sglF4YQ8TEO0DHHjQKEAQf2MOsyrJYwN_KEl34MFwzsnjRz7OT63WE8onZaHeVg3MgwMFF1TNMmIcu1Ym2FM_Q56sKT7Sh8QdQP6RY95eC-2gWUEqck6DrEHe4s-TTILreKpuzSQ","e":"AQAB","d":"A7ssLZOKCWTn28Mq4gjfpwXTdIj2Zkqejh7Jmey2thkV8zvrcFl9EDw6neIotGDea3VGG0xQD832SrpCfC3FbyKlM_X2YOe06ik-itxR4Q1G2RX3lpc5psfKuIxa7dIOTvNbQilKcc41UMmKEzL0hc__vKHDQKL6SWLHxG0AWBXNOd28P72__BSlYYPNZQRgZ-Ymq6WvVBLQ4Uttmf1sZEyhbxWWhE9TETv1GhZaIXHeOCFQ1NzH7iM8O8V3yUCXnuZobI--B9dHSs-I6kaAeA0Hsy0ODrE9FjxyeAem0U43-TyTyHSU1q7DGfKT-VthIBV-RBloX2W0hmboPGSxtQ","p":"46u2zYKCGnOGU7HPbGYiwkEpH9_BCAbleuTLW9GDOC4WDPISytMqeOPRlzVzBGzpjeu0KIHhg0acDfunopxO8XRt_9qAjq3han11zw1dPZveCY9kzlFrgy6SbUTX5G5TjnpdB9AJ8TsncuZTQNhWidDajI0WrpDIceR--CWrYmc","q":"4HPrtrPKesV-GSJKYmWpVPSwjMmmCo-Jdrt3jHVRfveVsbP2sHRy0GBv50vd4eDQmEKQXgbZfvYLuGqaGzJ6ZSGM_Xj30qcWPqYaojKSeqEXdLrRdAEGoVmxpLzsDGTR3d6fM_L5o3L12tps1KVv5bu_0VQCRfIxgMTQ-gS-js8","dp":"4k_85QiIP7b6nhOwdraIcsTHFnIbtdj1IFZyd5EqeRwGu1OerpN-MrFz1HVDIfEJsRPOAD4rZ4027wdrOc9bAdWUyrHu_OWHn42bH_jO6MEZ1DMAJ77zunD_CTNX0DCDSqwD8hIw7-S3cBXYSCtEyrYbqX9OPrSZK-3Q8OaxGJ0","dq":"oL6EJjF2phxAJZHoQbXa4mvm8L0Ne-y2HuE9SctPVSXNABoJZu_OtisKmVQ9EKJn4VNyftRa-VEOrcEyop2xCDJR_cmfei6NgMqGsniTbN1npgKRNInzjKRm07s1Nd8SadognBy76fHP3y-k11mv3JBsXGbUxfEgwL6zhwrUygM","qi":"I9KljtffznRNnW4Q6czQUj9RCO-fdw4lxk9CCMk6SvsGpnqu6aQehxYE1enQROfuuN0jy6KvSmyHcABZPiSOWhm1GZZ_b7xXwuVpi9h3AJWPpuNbSrv0RQz6IuNI23VTxgrlgRJhn5GINQEdDidpINSVHCRLfANM7X1f8bB-pEA","use":"sig","alg":"RS256","kid":"b04abe62-f206-442d-9079-a13b4c1994ef"}';

function readEnv(name, fallback) {
    const value = process.env[name]?.trim();
    if (!value) {
        return fallback;
    }
    return value;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAuthgear(endpoint) {
    const url = new URL('/.well-known/openid-configuration', endpoint);
    for (let i = 0; i < 45; i += 1) {
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (response.ok) {
                return;
            }
        } catch {}
        await sleep(1000);
    }

    throw new Error(`Authgear did not become ready at ${url.toString()}`);
}

function createAdminJwt(projectId, jwkJson) {
    const jwk = JSON.parse(jwkJson);
    const nowSeconds = Math.floor(Date.now() / 1000);

    const privateKeyPem = jwkToPem(jwk);
    const header = {
        alg: 'RS256',
        typ: 'JWT',
        kid: jwk.kid,
    };
    const payload = {
        aud: projectId,
        iat: nowSeconds - 30,
        exp: nowSeconds + 300,
    };

    const headerPart = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signingInput = `${headerPart}.${payloadPart}`;

    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();

    const privateKey = createPrivateKey(privateKeyPem);
    const signature = signer.sign(privateKey).toString('base64url');
    return `${signingInput}.${signature}`;
}

function base64UrlToBase64(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    return normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
}

function jwkToPem(jwk) {
    if (jwk.kty !== 'RSA') {
        throw new Error('Only RSA JWK keys are supported for local admin JWT generation');
    }

    function encodeLength(len) {
        if (len < 128) {
            return Buffer.from([len]);
        }
        const bytes = [];
        let value = len;
        while (value > 0) {
            bytes.unshift(value & 0xff);
            value >>= 8;
        }
        return Buffer.from([0x80 | bytes.length, ...bytes]);
    }

    function encodeInteger(base64Url) {
        let buffer = Buffer.from(base64UrlToBase64(base64Url), 'base64');
        while (buffer.length > 0 && buffer[0] === 0x00) {
            buffer = buffer.subarray(1);
        }
        if (buffer.length === 0) {
            buffer = Buffer.from([0]);
        }
        if (buffer[0] & 0x80) {
            buffer = Buffer.concat([Buffer.from([0x00]), buffer]);
        }
        return Buffer.concat([Buffer.from([0x02]), encodeLength(buffer.length), buffer]);
    }

    const privateKeySequence = [
        Buffer.from([0x02, 0x01, 0x00]),
        encodeInteger(jwk.n),
        encodeInteger(jwk.e),
        encodeInteger(jwk.d),
        encodeInteger(jwk.p),
        encodeInteger(jwk.q),
        encodeInteger(jwk.dp),
        encodeInteger(jwk.dq),
        encodeInteger(jwk.qi),
    ];

    const body = Buffer.concat(privateKeySequence);
    const der = Buffer.concat([Buffer.from([0x30]), encodeLength(body.length), body]);
    const pemBody = der.toString('base64').match(/.{1,64}/g)?.join('\n') ?? der.toString('base64');
    return `-----BEGIN RSA PRIVATE KEY-----\n${pemBody}\n-----END RSA PRIVATE KEY-----`;
}

async function callAdminGraphql({ endpoint, projectId, jwt, query, variables }) {
    const url = new URL('/_api/admin/graphql', endpoint);
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${jwt}`,
            'Content-Type': 'application/json',
            'X-Authgear-App-ID': projectId,
        },
        body: JSON.stringify({ query, variables }),
    });

    const text = await response.text();
    let payload;
    try {
        payload = JSON.parse(text);
    } catch {
        throw new Error(`Authgear admin API returned non-JSON response: ${text}`);
    }

    if (!response.ok) {
        throw new Error(
            `Authgear admin API request failed (${response.status}): ${JSON.stringify(payload)}`
        );
    }

    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
        throw new Error(`Authgear admin GraphQL error: ${JSON.stringify(payload.errors)}`);
    }

    return payload.data;
}

function decodeAuthgearUserId(base64Id) {
    const base64 = base64Id.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    return decoded.replace(/^User:/, '');
}

async function ensureAuthgearUser({ endpoint, projectId, email, password, adminJwt }) {
    const getUserQuery = `
      query GetUser($loginIDKey: String!, $loginIDValue: String!) {
        getUserByLoginID(loginIDKey: $loginIDKey, loginIDValue: $loginIDValue) {
          id
        }
      }
    `;

    const existing = await callAdminGraphql({
        endpoint,
        projectId,
        jwt: adminJwt,
        query: getUserQuery,
        variables: {
            loginIDKey: 'email',
            loginIDValue: email,
        },
    });

    if (existing?.getUserByLoginID?.id) {
        return decodeAuthgearUserId(existing.getUserByLoginID.id);
    }

    const createUserMutation = `
      mutation CreateUser($input: CreateUserInput!) {
        createUser(input: $input) {
          user {
            id
          }
        }
      }
    `;

    const created = await callAdminGraphql({
        endpoint,
        projectId,
        jwt: adminJwt,
        query: createUserMutation,
        variables: {
            input: {
                definition: {
                    loginID: {
                        key: 'email',
                        value: email,
                    },
                },
                password,
                sendPassword: false,
                setPasswordExpired: false,
            },
        },
    });

    const createdUserId = created?.createUser?.user?.id;
    if (!createdUserId) {
        throw new Error(`Authgear user creation returned unexpected payload: ${JSON.stringify(created)}`);
    }

    return decodeAuthgearUserId(createdUserId);
}

async function ensureSkyTestDefaults({ authId, email, teamName, projectName }) {
    const prisma = new PrismaClient();
    try {
        return await prisma.$transaction(async (tx) => {
            const user = await tx.user.upsert({
                where: { authId },
                update: { email },
                create: { authId, email },
            });

            const existingOwnerMembership = await tx.teamMembership.findFirst({
                where: {
                    userId: user.id,
                    role: 'OWNER',
                    team: {
                        name: teamName,
                    },
                },
                orderBy: { createdAt: 'asc' },
                include: { team: true },
            });

            const team = existingOwnerMembership?.team
                ?? await tx.team.create({
                    data: { name: teamName },
                });

            await tx.teamMembership.upsert({
                where: {
                    teamId_userId: {
                        teamId: team.id,
                        userId: user.id,
                    },
                },
                update: {
                    role: 'OWNER',
                    email,
                },
                create: {
                    teamId: team.id,
                    userId: user.id,
                    email,
                    role: 'OWNER',
                },
            });

            const existingProject = await tx.project.findFirst({
                where: {
                    teamId: team.id,
                    name: projectName,
                },
                orderBy: { createdAt: 'asc' },
            });

            const project = existingProject
                ? await tx.project.update({
                    where: { id: existingProject.id },
                    data: {
                        createdByUserId: user.id,
                    },
                })
                : await tx.project.create({
                    data: {
                        name: projectName,
                        teamId: team.id,
                        createdByUserId: user.id,
                    },
                });

            return { user, team, project };
        });
    } finally {
        await prisma.$disconnect();
    }
}

async function main() {
    const authgearEndpoint = readEnv('AUTHGEAR_ENDPOINT', 'http://localhost:3301');
    const authgearAdminEndpoint = readEnv('SKYTEST_AUTHGEAR_ADMIN_ENDPOINT', 'http://localhost:3302');
    const authgearProjectId = readEnv('SKYTEST_AUTHGEAR_PROJECT_ID', 'skytest-local');
    const adminJwkJson = readEnv('SKYTEST_AUTHGEAR_ADMIN_JWK', DEFAULT_ADMIN_JWK);

    const seedEmail = readEnv('SKYTEST_LOCAL_SEED_EMAIL', 'local-dev@skytest.local');
    const seedPassword = readEnv('SKYTEST_LOCAL_SEED_PASSWORD', 'Abcd1234');
    const seedTeamName = readEnv('SKYTEST_LOCAL_SEED_TEAM_NAME', 'Local Team');
    const case-studyProjectName = readEnv('SKYTEST_LOCAL_SEED_PROJECT_NAME', 'Case Study App');

    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is required for local seed bootstrap');
    }

    await waitForAuthgear(authgearEndpoint);
    const adminJwt = await createAdminJwt(authgearProjectId, adminJwkJson);
    const authId = await ensureAuthgearUser({
        endpoint: authgearAdminEndpoint,
        projectId: authgearProjectId,
        email: seedEmail,
        password: seedPassword,
        adminJwt,
    });

    const seeded = await ensureSkyTestDefaults({
        authId,
        email: seedEmail,
        teamName: seedTeamName,
        projectName: case-studyProjectName,
    });

    console.log('[local-seed] ensured default account + ownership');
    console.log(`[local-seed] user=${seeded.user.email} authId=${seeded.user.authId}`);
    console.log(`[local-seed] team=${seeded.team.name} (${seeded.team.id})`);
    console.log(`[local-seed] project=${seeded.project.name} (${seeded.project.id})`);
}

main().catch((error) => {
    console.error(`[local-seed] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
