import { z } from "zod";
import { authed, json, parseBody } from "@/lib/api/http";
import { startPractice } from "@/server/training/service";

const Body = z.object({ category: z.string().min(1).max(40), competencyId: z.string().min(1).max(60).nullable().optional() });

/** Start a practice loop: one competency in one interview type (chosen for you when not given). */
export const POST = authed(async (req, { user }) => {
  const body = await parseBody(req, Body);
  return json({ id: await startPractice(user.id, body) });
}, { limit: 20, name: "training-start", shared: true });
