import { createRemoteJWKSet, jwtVerify } from 'jose';

const AUTHGEAR_ENDPOINT = process.env.NEXT_PUBLIC_AUTHGEAR_ENDPOINT || '';
const JWKS_URL = `${AUTHGEAR_ENDPOINT}/oauth2/jwks`;
const JKWS = createRemoteJWKSet(new URL(JWKS_URL));

export async function verifyAuth(request: Request, token?: string) {
    let finalToken = token;

    if (!finalToken) {
        const authHeader = request.headers.get('Authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
            finalToken = authHeader.split(' ')[1];
        }
    }

    if (!finalToken) {
        console.error("verifyAuth: No token found");
        return null;
    }

    try {
        const { payload } = await jwtVerify(finalToken, JKWS);
        return payload;
    } catch (error) {
        console.error("verifyAuth: Token verification failed", error);
        return null;
    }
}
