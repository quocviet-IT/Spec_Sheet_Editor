import { signInWithGoogle } from "@/auth/actions";
import { safeNext } from "@/auth/redirect";
import type { Messages } from "@/messages";
import { getMessages } from "@/messages/server";
import { LanguageSwitch } from "@/ui/language-switch";

function errorText(code: string | undefined, t: Messages): string | null {
  if (code === "not_permitted") return t.login.errors.notPermitted;
  if (code === "suspended") return t.login.errors.suspended;
  if (code === "google") return t.login.errors.google;
  return null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const t = await getMessages();
  const error = errorText(params.error, t);
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm space-y-5 rounded-xl border border-line bg-surface p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">{t.app.name}</h1>
            <p className="mt-1 text-sm text-ink-2">{t.login.lead}</p>
          </div>
          <LanguageSwitch />
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm">
            {error}
          </p>
        )}
        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={safeNext(params.next)} />
          <button
            type="submit"
            className="w-full rounded-md bg-accent px-4 py-2.5 font-semibold text-accent-ink hover:opacity-90"
          >
            {t.login.google}
          </button>
        </form>
      </div>
    </main>
  );
}
