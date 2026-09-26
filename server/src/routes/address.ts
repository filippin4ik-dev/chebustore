import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { requireUser } from "../plugins/auth.js";

const BASE = "https://suggestions.dadata.ru/suggestions/api/4_1/rs";

interface DadataSuggestion {
  value?: string;
  data?: {
    postal_code?: string | null;
    city?: string | null;
    settlement?: string | null;
    region_with_type?: string | null;
    house?: string | null;
    flat?: string | null;
  };
}

export interface AddressSuggestion {
  value: string;
  postalCode: string;
  city: string;
  hasHouse: boolean;
}

async function dadata(path: string, body: Record<string, unknown>): Promise<AddressSuggestion[]> {
  if (!config.DADATA_API_KEY) return [];
  let res: Response;
  try {
    res = await fetch(`${BASE}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Token ${config.DADATA_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    throw new HttpError(503, "address_unavailable", "Подсказки адреса временно недоступны");
  }
  if (!res.ok) throw new HttpError(503, "address_unavailable", "Подсказки адреса временно недоступны");
  const json = (await res.json().catch(() => ({}))) as { suggestions?: DadataSuggestion[] };
  return (json.suggestions ?? []).slice(0, 8).map((s) => ({
    value: String(s.value ?? "").slice(0, 300),
    postalCode: String(s.data?.postal_code ?? ""),
    city: String(s.data?.city ?? s.data?.settlement ?? s.data?.region_with_type ?? ""),
    hasHouse: Boolean(s.data?.house),
  }));
}

const limit = { config: { rateLimit: { max: 90, timeWindow: "1 minute" } } };

export default async function addressRoutes(app: FastifyInstance) {
  app.post("/api/address/suggest", limit, async (req) => {
    requireUser(req);
    const body = parse(z.object({ query: z.string().trim().min(2).max(200) }), req.body);
    return { suggestions: await dadata("suggest/address", { query: body.query, count: 7 }) };
  });

  app.post("/api/address/locate", limit, async (req) => {
    requireUser(req);
    const body = parse(
      z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }),
      req.body,
    );
    return {
      suggestions: await dadata("geolocate/address", { lat: body.lat, lon: body.lon, count: 5, radius_meters: 150 }),
    };
  });
}
