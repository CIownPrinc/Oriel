/**
 * Interviewer archetypes. Behaviour is expressed as numeric parameters (0..1),
 * not a prompt — the controller, the avatar and the voice all read the same
 * numbers, so a "skeptic" is skeptical in its decisions, its face and its pauses.
 */
export type PersonaId =
  | "warm_recruiter"
  | "hiring_manager"
  | "direct_manager"
  | "skeptic"
  | "executive"
  | "peer";

export type PanelRole = "hiring_manager" | "peer" | "skeptic" | "executive";

export interface Persona {
  id: PersonaId;
  name: string;
  /** Job title, used in the interviewer's own prompts ("I'm Tom, a senior manager"). */
  title: string;
  /** What the interface calls them, everywhere: their manner, not their job. */
  label: string;
  /** One line on what they're like to face. */
  hint: string;
  description: string;
  warmth: number;
  skepticism: number;
  pace: number;
  interruptionRate: number;
  silenceTolerance: number;
  specificityDemand: number;
  /** Avatar: how much the face moves/reacts (nods, smiles, brow). */
  expressiveness: number;
  /** Gemini prebuilt voice name. */
  voice: string;
  /** Short style guide handed to the language model. */
  style: string;
}

export const PERSONAS: Record<PersonaId, Persona> = {
  warm_recruiter: {
    id: "warm_recruiter",
    name: "Maya Lin",
    title: "Recruiter",
    label: "Warm recruiter",
    hint: "Relaxed and encouraging; checks your story",
    description: "Friendly and encouraging. Checks fit, motivation, and how clearly you tell your story.",
    warmth: 0.85, skepticism: 0.15, pace: 0.55, interruptionRate: 0.05,
    silenceTolerance: 0.3, specificityDemand: 0.35, expressiveness: 0.8,
    voice: "Sulafat",
    style: "Warm, conversational, brief acknowledgements. Asks open questions. Rarely pushes hard.",
  },
  hiring_manager: {
    id: "hiring_manager",
    name: "Daniel Reyes",
    title: "Hiring Manager",
    label: "Hiring manager",
    hint: "Neutral and direct: what did you do?",
    description: "Neutral and attentive. Wants to know what you actually did and whether you can do this job.",
    warmth: 0.5, skepticism: 0.45, pace: 0.5, interruptionRate: 0.15,
    silenceTolerance: 0.55, specificityDemand: 0.6, expressiveness: 0.5,
    voice: "Iapetus",
    style: "Neutral, direct, professional. Asks for your specific role and the result.",
  },
  direct_manager: {
    id: "direct_manager",
    name: "Priya Natarajan",
    title: "Hiring Manager",
    label: "Direct manager",
    hint: "Short on time; asks for the point",
    description: "Direct and time-conscious. Redirects rambling and asks for the point.",
    warmth: 0.35, skepticism: 0.55, pace: 0.65, interruptionRate: 0.35,
    silenceTolerance: 0.5, specificityDemand: 0.75, expressiveness: 0.4,
    voice: "Alnilam",
    style: "Crisp and economical. Short sentences. Redirects to the point when answers drift.",
  },
  skeptic: {
    id: "skeptic",
    name: "Tom Hadley",
    title: "Senior Manager",
    label: "Skeptic",
    hint: "Hard to read; tests every claim",
    description: "Skeptical and hard to read. Tests claims, numbers, and ownership.",
    warmth: 0.15, skepticism: 0.9, pace: 0.45, interruptionRate: 0.45,
    silenceTolerance: 0.85, specificityDemand: 0.9, expressiveness: 0.25,
    voice: "Kore",
    style: "Dry and probing. Questions whether claims hold up. Asks how you know. Never flatters.",
  },
  executive: {
    id: "executive",
    name: "Eleanor Vance",
    title: "Executive",
    label: "Executive",
    hint: "Few words, long pauses; judgment and scope",
    description: "Extremely controlled. Few words, long pauses, cares about judgment and scope.",
    warmth: 0.3, skepticism: 0.65, pace: 0.35, interruptionRate: 0.2,
    silenceTolerance: 0.95, specificityDemand: 0.7, expressiveness: 0.12,
    voice: "Gacrux",
    style: "Measured and sparse. Big-picture questions about judgment, trade-offs and impact. Very few words.",
  },
  peer: {
    id: "peer",
    name: "Sam Okafor",
    title: "Peer",
    label: "Peer",
    hint: "Collegial and technical; how you work day to day",
    description: "Collegial but technical. Wants to know how you work with others day to day.",
    warmth: 0.6, skepticism: 0.4, pace: 0.55, interruptionRate: 0.2,
    silenceTolerance: 0.5, specificityDemand: 0.6, expressiveness: 0.6,
    voice: "Achird",
    style: "Collegial, curious, practical. Asks how things actually worked in the details.",
  },
};

/** The four interviewers you can face one-on-one, in order of how hard they are to face. */
export const SOLO_INTERVIEWERS = ["warm_recruiter", "hiring_manager", "skeptic", "executive"] as const;
export type SoloInterviewer = (typeof SOLO_INTERVIEWERS)[number];

export const PANEL_ROLE_PERSONA: Record<PanelRole, PersonaId> = {
  hiring_manager: "hiring_manager",
  peer: "peer",
  skeptic: "skeptic",
  executive: "executive",
};

export const PANEL_ROLE_LABEL: Record<PanelRole, string> = {
  hiring_manager: "Hiring manager",
  peer: "Peer",
  skeptic: "Skeptic",
  executive: "Executive",
};

/** Panel seat order by size. The first seat leads the interview. */
export function panelRolesForSize(size: number): PanelRole[] {
  const all: PanelRole[] = ["hiring_manager", "skeptic", "peer", "executive"];
  return all.slice(0, Math.max(2, Math.min(4, size)));
}

export const INTERVIEWER_STYLE_TO_PERSONA: Record<string, PersonaId> = {
  warm_recruiter: "warm_recruiter",
  hiring_manager: "hiring_manager",
  skeptic: "skeptic",
  executive: "executive",
};
