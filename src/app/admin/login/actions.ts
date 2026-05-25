"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signSession, timingSafeEqual } from "@/lib/adminAuth";

export type VerifyPinState = { error?: string } | null;

function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/admin";
  if (!raw.startsWith("/")) return "/admin";
  if (raw.startsWith("//")) return "/admin";
  return raw;
}

export async function verifyPin(
  _prevState: VerifyPinState,
  formData: FormData
): Promise<VerifyPinState> {
  const pin = String(formData.get("pin") ?? "");
  const next = String(formData.get("next") ?? "");

  const expected = process.env.ADMIN_PIN ?? "";
  if (!expected) {
    console.error("ADMIN_PIN is not set — refusing all PIN entries.");
    return { error: "Incorrect PIN" };
  }
  if (!timingSafeEqual(pin, expected)) {
    return { error: "Incorrect PIN" };
  }

  const session = await signSession();
  if (!session) return { error: "Incorrect PIN" };

  const cookieStore = await cookies();
  cookieStore.set("admin_session", session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 90 * 24 * 60 * 60,
  });

  redirect(safeNextPath(next));
}
