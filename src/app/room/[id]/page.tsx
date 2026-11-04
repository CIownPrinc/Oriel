import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { HttpError } from "@/lib/api/http";
import { loadSession } from "@/server/interview/service";
import { PERSONAS, PANEL_ROLE_LABEL, type PanelRole, type PersonaId } from "@/lib/interview/personas";
import { pressurePolicy, clampPressure } from "@/lib/interview/pressure";
import { getSpeechToText } from "@/lib/ai/providers/registry";
import { Room } from "@/features/room/Room";
import { PALETTE } from "@/lib/palette";

export const metadata = { title: "The Room" };

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let ctx;
  try {
    ctx = await loadSession(id, user.id);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }
  if (ctx.session.status === "ended" || ctx.session.status === "abandoned") redirect(`/playback/${id}`);
  const pressure = clampPressure(ctx.interview.pressure);
  const seats = ctx.interviewers.map((iv) => {
    const p = PERSONAS[iv.personaId as PersonaId];
    return {
      seat: iv.seat, personaId: p.id, name: iv.displayName, style: iv.avatarStyle, accent: PALETTE.accent, expressiveness: p.expressiveness, warmth: p.warmth, skepticism: p.skepticism,
      title: iv.panelRole ? PANEL_ROLE_LABEL[iv.panelRole as PanelRole] : p.title,
    };
  });
  const lead = PERSONAS[ctx.interviewers[0].personaId as PersonaId];
  return (
    <Room
      sessionId={id}
      resuming={ctx.session.status === "live"}
      seats={seats}
      pressure={pressure}
      stillness={pressurePolicy(pressure, lead).stillness}
      role={ctx.interview.role}
      targetMinutes={ctx.interview.targetMinutes}
      privacy={{ recordVideo: ctx.profile?.recordVideo ?? true, cameraMetrics: ctx.session.cameraMetricsEnabled, posture: ctx.profile?.postureMetricEnabled ?? true }}
      serverStt={!getSpeechToText().isMock}
    />
  );
}
