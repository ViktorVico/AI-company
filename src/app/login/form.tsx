"use client";

import { useActionState } from "react";
import { login } from "@/app/actions";
import { Asterisk, buttonClass, inputClass } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, {});
  return (
    <form action={action} className="card mt-6 space-y-3 p-5">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="mb-1.5 block text-[12px] font-medium text-ink-2">Owner password</span>
        <input name="password" type="password" autoFocus required className={inputClass} autoComplete="current-password" />
      </label>
      {state?.error && <p className="text-[12.5px] text-bad">{state.error}</p>}
      <button disabled={pending} className={buttonClass("primary") + " w-full"}>
        {pending ? <Asterisk className="size-4 text-accent" spin /> : "Enter the command center"}
      </button>
    </form>
  );
}
