/** Live tutor endpoints (backend/app/modules/tutor). */
import { request } from "@/api/client";

export type Tutor = {
  tutor_id: string;
  name: string;
  tagline: string;
  avatar_id: string;
  voice_id: string;
  style_prompt: string;
};
export type TutorSession = { url: string; token: string; room: string; identity: string };

export const listTutors = (signal?: AbortSignal) => request<Tutor[]>("/tutor/tutors", { signal });
export const startTutorSession = (tutorId: string) =>
  request<TutorSession>("/tutor/session", { method: "POST", json: { tutor_id: tutorId } });
