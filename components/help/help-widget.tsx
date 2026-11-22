"use client";

import { ArrowUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MoraMark } from "./mora-mark";
import type { HelpMessage } from "@/lib/schemas/help/help";
import {
  createHelpRequestGuard,
  readHelpThread,
  writeHelpThread,
} from "@/lib/help/client-session";
import {
  appendAssistantTurn,
  appendUserMessage,
  toModelContext,
  withAssistantSnapshot,
} from "@/lib/help/thread";
import { HelpMarkdown } from "./help-markdown";

export const MORA_SUGGESTED_QUESTIONS = [
  "¿Qué es el margen?",
  "¿Cómo calculo mis costos?",
  "¿Qué es el punto de equilibrio?",
] as const;

export function MoraWelcome({
  onSelect,
  disabled = false,
}: {
  onSelect: (question: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 py-5">
      <div className="max-w-xs space-y-2">
        <h3 className="text-xl font-semibold tracking-tight text-fg">
          ¡Hola! Soy Mora.
        </h3>
        <p className="text-sm leading-relaxed text-fg-muted">
          Te ayudo a entender tus costos, precios y las herramientas de Numora.
        </p>
        <p className="text-sm font-medium text-fg">¿Por dónde empezamos?</p>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Preguntas sugeridas">
        {MORA_SUGGESTED_QUESTIONS.map((question) => (
          <button
            key={question}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(question)}
            className="min-h-11 rounded-full border border-border-default bg-surface-tint px-3 py-2 text-left text-xs font-medium text-fg transition-colors hover:border-action-primary hover:bg-action-tonal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}

type HelpWidgetProps = {
  enabled: boolean;
  userId: string | null;
};

export function HelpWidget({ enabled, userId }: HelpWidgetProps) {
  if (!enabled) return null;
  return <HelpWidgetSession key={userId ?? "signed-out"} userId={userId} />;
}

// One bubble of the conversation. User messages stay plain text; assistant
// replies are rendered as safe Markdown (see help-markdown.tsx).
export function HelpMessageItem({
  message,
  streaming,
}: {
  message: HelpMessage;
  streaming: boolean;
}) {
  if (message.role === "user") {
    return (
      <p className="max-w-[85%] break-words self-end rounded-2xl bg-action-primary px-3 py-2 text-sm text-on-action-primary">
        {message.content}
      </p>
    );
  }
  return (
    <div className="max-w-[85%] min-w-0 break-words self-start rounded-2xl bg-surface-tint px-3 py-2 text-sm text-fg">
      {message.content ? (
        <HelpMarkdown content={message.content} />
      ) : streaming ? (
        <span>…</span>
      ) : null}
    </div>
  );
}

function HelpWidgetSession({ userId }: Pick<HelpWidgetProps, "userId">) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const loadedRef = useRef(false);
  const requestGuardRef = useRef(createHelpRequestGuard());

  useEffect(() => {
    const guard = requestGuardRef.current;

    return () => {
      guard.invalidate();
    };
  }, []);

  useEffect(() => {
    if (!userId || !loadedRef.current) return;
    writeHelpThread(sessionStorage, userId, messages);
  }, [messages, userId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        requestAnimationFrame(() => launcherRef.current?.focus());
      }
    }
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("keydown", onEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  async function send(suggestedQuestion?: string) {
    const content = (suggestedQuestion ?? draft).trim();
    if (!content || pending) return;

    // Visible history keeps every message; only the last turn window travels
    // to the API (HELP_THREAD_LIMIT), so older answers stay on screen.
    const next = appendUserMessage(messages, content);
    setMessages(next);
    setDraft("");
    setError(null);
    setPending(true);
    const request = requestGuardRef.current.start();
    const { controller, isCurrent } = request;

    try {
      const response = await fetch("/api/help", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: toModelContext(next) }),
        signal: controller.signal,
      });

      if (!isCurrent()) return;
      if (!response.ok || !response.body) {
        setError(
          response.status === 401
            ? "Iniciá sesión para preguntar."
            : "No pude obtener una respuesta. Probá de nuevo.",
        );
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      setMessages((current) => appendAssistantTurn(current));

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!isCurrent()) {
          await reader.cancel();
          return;
        }
        answer += decoder.decode(value, { stream: true });
        const snapshot = answer;
        setMessages((current) => withAssistantSnapshot(current, snapshot));
      }
    } catch (caught) {
      if (isCurrent() && !(caught instanceof DOMException && caught.name === "AbortError")) {
        setError("No pude obtener una respuesta. Probá de nuevo.");
      }
    } finally {
      if (isCurrent()) {
        request.finish();
        setPending(false);
      }
    }
  }

  function trapDialogTab(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusables = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openAssistant() {
    loadedRef.current = true;
    if (userId) setMessages(readHelpThread(sessionStorage, userId));
    setOpen(true);
  }

  function closeAssistant() {
    setOpen(false);
    requestAnimationFrame(() => launcherRef.current?.focus());
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex flex-col items-end justify-end md:inset-auto md:bottom-6 md:right-6 md:gap-3">
      {open ? (
        <>
          <div aria-hidden="true" className="pointer-events-auto fixed inset-0 bg-black/25 md:hidden" />
          <section
            ref={dialogRef}
            id="mora-dialog"
            onKeyDown={trapDialogTab}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mora-dialog-title"
            aria-describedby="mora-dialog-description"
            className="pointer-events-auto relative flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-surface text-fg shadow-2xl md:h-[min(35rem,calc(100dvh-7rem))] md:w-[min(25rem,calc(100vw-3rem))] md:rounded-2xl md:border md:border-border-default"
          >
            <header className="flex shrink-0 items-center gap-3 border-b border-border-default bg-surface-tint px-4 py-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
                <MoraMark className="h-10 w-9" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="mora-dialog-title" className="text-base font-bold text-fg">
                  Mora
                </h2>
                <p id="mora-dialog-description" className="text-xs text-fg-muted">
                  Tu asistente de Numora
                </p>
              </div>
              <button
                type="button"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-fg-muted transition-colors hover:bg-action-tonal hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                aria-label="Cerrar Mora"
                onClick={closeAssistant}
              >
                <X aria-hidden="true" size={20} />
              </button>
            </header>
            <div
              ref={listRef}
              role="log"
              aria-label="Mensajes de Mora"
              aria-live="polite"
              aria-relevant="additions text"
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-5"
            >
              {messages.length === 0 ? (
                <MoraWelcome disabled={pending} onSelect={(question) => void send(question)} />
              ) : null}
              {messages.map((message, index) => (
                <HelpMessageItem
                  key={`${message.role}-${index}`}
                  message={message}
                  streaming={pending}
                />
              ))}
              {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
            </div>
            <form
              className="flex shrink-0 items-center gap-2 border-t border-border-default bg-surface px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <label className="sr-only" htmlFor="help-question">Pregunta para Mora</label>
              <input
                ref={inputRef}
                id="help-question"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={pending}
                placeholder="Escribí tu pregunta"
                className="min-h-12 min-w-0 flex-1 rounded-xl border border-border-control bg-surface px-3 text-base text-fg placeholder:text-fg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:text-sm"
              />
              <button
                type="submit"
                aria-label="Enviar pregunta"
                disabled={pending || draft.trim().length === 0}
                className="flex min-h-12 min-w-12 items-center justify-center rounded-xl bg-action-primary text-on-action-primary transition-colors hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-action-disabled disabled:text-fg-disabled"
              >
                <ArrowUp aria-hidden="true" size={20} />
              </button>
            </form>
          </section>
        </>
      ) : null}
      <button
        ref={launcherRef}
        type="button"
        aria-expanded={open}
        aria-label={open ? "Cerrar Mora" : "Abrir ayuda de Mora"}
        aria-controls={open ? "mora-dialog" : undefined}
        className={`pointer-events-auto fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-xl ring-1 ring-border-default transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transform-none md:static ${open ? "hidden md:flex" : ""}`}
        onClick={() => {
          if (open) closeAssistant();
          else openAssistant();
        }}
      >
        {open ? <X aria-hidden="true" size={24} /> : <MoraMark className="h-14 w-12" />}
      </button>
    </div>
  );
}
