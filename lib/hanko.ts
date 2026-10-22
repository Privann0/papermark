import { tenant } from "@teamhanko/passkeys-next-auth-provider";

type HankoTenant = ReturnType<typeof tenant>;

let hankoTenant: HankoTenant | null = null;

/**
 * Lazily create the Hanko tenant.
 *
 * Next.js imports authOptions while collecting build-time route data.
 * Passkey credentials are runtime configuration and must not be required
 * merely to import the authentication module during a production build.
 */
export function getHankoTenant(): HankoTenant {
  if (hankoTenant) {
    return hankoTenant;
  }

  const apiKey = process.env.HANKO_API_KEY;
  const tenantId = process.env.NEXT_PUBLIC_HANKO_TENANT_ID;

  if (!apiKey || !tenantId) {
    throw new Error(
      "Hanko passkeys are not configured. Set HANKO_API_KEY and NEXT_PUBLIC_HANKO_TENANT_ID.",
    );
  }

  hankoTenant = tenant({
    apiKey,
    tenantId,
  });

  return hankoTenant;
}

/**
 * Preserve the existing default-export contract while delaying tenant
 * creation until a passkey operation actually accesses the client.
 */
const hanko = new Proxy({} as HankoTenant, {
  get(_target, property) {
    const client = getHankoTenant();
    const value = Reflect.get(client, property, client);

    return typeof value === "function" ? value.bind(client) : value;
  },
});

export default hanko;
