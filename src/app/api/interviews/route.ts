import { z } from "zod";
import { authed, json, parseBody } from "@/lib/api/http";
import { createInterview } from "@/server/interview/service";

const Body = z.object({
  role: z.string().trim().min(2).max(120),
  domain: z.enum(["software", "product", "consulting", "finance", "research", "clinical", "executive", "government"]),
  level: z.enum(["recruiter", "hiring_manager", "senior_manager", "executive"]),
  type: z.enum(["behavioral", "technical", "case", "leadership", "mixed"]),
  pressure: z.number().int().min(1).max(5),
  persona: z.enum(["warm_recruiter", "hiring_manager", "direct_manager", "skeptic", "executive", "peer"]),
  mode: z.enum(["single", "panel"]).default("single"),
  panelSize: z.number().int().min(2).max(4).default(3),
  ladderLevel: z.number().int().min(1).max(6).nullable().default(null),
  targetMinutes: z.number().int().min(5).max(60).default(15),
  cameraMetrics: z.boolean().default(true),
});

export const POST = authed(async (req, { user }) => {
  const body = await parseBody(req, Body);
  return json(await createInterview(user.id, body));
}, { limit: 20, shared: true });
