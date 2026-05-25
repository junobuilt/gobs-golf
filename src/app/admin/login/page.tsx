"use client";

import { Suspense, useActionState, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { verifyPin, type VerifyPinState } from "./actions";

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/admin";
  const [state, formAction, pending] = useActionState<VerifyPinState, FormData>(
    verifyPin,
    null
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [pin, setPin] = useState("");

  // On error, clear input + refocus so retry is one keystroke away.
  useEffect(() => {
    if (state?.error) {
      setPin("");
      inputRef.current?.focus();
    }
  }, [state]);

  const submittable = pin.length === 4 && !pending;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f2f1ed",
        padding: "24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: "360px" }}>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            color: "var(--green-900)",
            marginBottom: "8px",
            textAlign: "center",
          }}
        >
          GOBS Admin
        </h1>
        <p
          style={{
            fontSize: "0.9rem",
            color: "var(--text-secondary)",
            marginBottom: "24px",
            textAlign: "center",
          }}
        >
          Enter your 4-digit PIN to continue.
        </p>

        <form
          action={formAction}
          style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
          <input type="hidden" name="next" value={next} />

          <input
            ref={inputRef}
            name="pin"
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoFocus
            autoComplete="off"
            aria-label="4-digit PIN"
            value={pin}
            onChange={(e) =>
              setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))
            }
            style={
              {
                width: "100%",
                padding: "16px",
                fontSize: "1.5rem",
                textAlign: "center",
                letterSpacing: "0.5em",
                border: "1px solid #e4e4e4",
                borderRadius: "10px",
                background: "#fff",
                outline: "none",
                fontFamily: "inherit",
                WebkitTextSecurity: "disc",
              } as React.CSSProperties
            }
          />

          {state?.error && (
            <div
              role="alert"
              style={{
                color: "var(--red-500)",
                fontSize: "0.9rem",
                textAlign: "center",
              }}
            >
              {state.error}
            </div>
          )}

          <button
            type="submit"
            disabled={!submittable}
            style={{
              padding: "14px 16px",
              background: "#e8a800",
              color: "#1a1a1a",
              fontWeight: 700,
              fontSize: "1rem",
              border: "none",
              borderRadius: "10px",
              cursor: submittable ? "pointer" : "default",
              opacity: submittable ? 1 : 0.5,
            }}
          >
            {pending ? "…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
