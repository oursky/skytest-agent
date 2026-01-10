import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS_URL = `${process.env.NEXT_PUBLIC_AUTHGEAR_ENDPOINT}/oauth2/jwks`;
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
        return null; // Or throw Error
    }

    try {
        const { payload } = await jwtVerify(finalToken, JKWS);
        // Authgear 'sub' claim is the User ID.
        // Roles might be in `https://authgear.com/claims/user/roles` or similar, check docs/token.
        // For now, return the payload.
        return payload;
    } catch (error) {
        console.error("verifyAuth: Token verification failed", error);
        return null;
    }
}
