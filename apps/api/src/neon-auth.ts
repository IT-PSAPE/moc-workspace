import { createRemoteJWKSet, jwtVerify, errors } from "jose";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Pool } from "pg";
import type { Session } from "@moc/shared";
import type { Repository } from "./repository";

export function neonSessionResolver(repository: Repository, pool: Pool) {
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const jwksUrl = process.env.NEON_AUTH_JWKS_URL;
  if (!baseUrl || !jwksUrl) throw new Error("Neon Auth URLs are required.");
  const jwks = createRemoteJWKSet(new URL(jwksUrl));
  return async (c: Context): Promise<Session> => {
    const authorization = c.req.header("authorization");
    if (!authorization) return { user: null, demo: false };
    if (!authorization.startsWith("Bearer ")) return { user: null, demo: false };
    let subject: string | undefined;
    try {
      const { payload } = await jwtVerify(authorization.slice(7), jwks, {
        issuer: new URL(baseUrl).origin,
        algorithms: ["EdDSA"],
      });
      subject = payload.sub;
    } catch (error) {
      if (error instanceof errors.JOSEError && error.code !== "ERR_JWKS_TIMEOUT")
        return { user: null, demo: false };
      throw new HTTPException(503, { message: "Sign-in verification is temporarily unavailable." });
    }
    if (!subject) return { user: null, demo: false };
    // Resolve verified email from the managed directory; never accept an email from the browser.
    const result = await pool.query('SELECT email FROM neon_auth."user" WHERE id = $1 AND "emailVerified" = true', [subject]);
    const email = result.rows[0]?.email;
    return { user: email ? await repository.findApprovedLeaderByGoogleEmail(email) : null, demo: false };
  };
}
