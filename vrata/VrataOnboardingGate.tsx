import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { usePrimaryHost } from "@/hooks/queries/host-queries";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import { callPluginRpc } from "@/lib/plugin-sdk-hooks";

function configuration(value: unknown, hostId: string) {
  if (
    value === null ||
    typeof value !== "object" ||
    !("hostId" in value) ||
    value.hostId !== hostId ||
    !("configured" in value) ||
    typeof value.configured !== "boolean" ||
    !("baseUrl" in value) ||
    typeof value.baseUrl !== "string"
  )
    throw new Error("Invalid configuration response");
  return { configured: value.configured, baseUrl: value.baseUrl };
}

function Setup({
  hostId,
  onComplete,
}: {
  hostId: string;
  onComplete: () => Promise<void>;
}) {
  const [config, setConfig] = useState<ReturnType<typeof configuration> | null>(
    null,
  );
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const active = useRef(false);

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setError("");
    async function load(failures: number) {
      let result: unknown;
      try {
        result = await callPluginRpc(fetch, "vrata", "getConfiguration", {
          target: { kind: "host", hostId },
        });
      } catch {
        if (!cancelled) {
          if (failures < 5)
            retry = setTimeout(
              () => void load(failures + 1),
              500 * (failures + 1),
            );
          else setError("Не удалось подключиться к Вратам. Повторите попытку.");
        }
        return;
      }
      if (!cancelled) {
        try {
          setConfig(configuration(result, hostId));
        } catch {
          setError(
            "Не удалось прочитать настройки Врата AI. Повторите попытку.",
          );
        }
      }
    }
    void load(0);
    return () => {
      cancelled = true;
      active.current = false;
      clearTimeout(retry);
    };
  }, [hostId, attempt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || config === null) return;
    setBusy(true);
    setError("");
    try {
      if (!config.configured) {
        const result = await callPluginRpc(fetch, "vrata", "saveCredentials", {
          target: { kind: "host", hostId },
          apiKey: apiKey.trim(),
          baseUrl: config.baseUrl,
        });
        if (!active.current) return;
        const saved = configuration(result, hostId);
        if (!saved.configured) throw new Error("Credentials were not saved");
        setConfig(saved);
        setApiKey("");
      }
      if (active.current) await onComplete();
    } catch {
      if (active.current) {
        setApiKey("");
        setError(
          "Не удалось завершить настройку. Проверьте подключение и ключ, затем повторите попытку.",
        );
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }

  if (config === null)
    return (
      <div className="space-y-4" aria-live="polite">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button onClick={() => setAttempt((value) => value + 1)}>
              Повторить
            </Button>
          </>
        ) : (
          <p>Подключаем Врата AI…</p>
        )}
      </div>
    );

  return (
    <form className="space-y-5" onSubmit={(event) => void submit(event)}>
      {config.configured ? (
        <p>Ключ Врата AI уже сохранён. Можно начинать.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Введите ключ Врата AI, чтобы начать работу.
          </p>
          <label className="grid gap-2 text-sm" htmlFor="vrata-api-key">
            Ключ API Врата AI
            <Input
              id="vrata-api-key"
              type="password"
              autoComplete="off"
              autoFocus
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              disabled={busy}
              required
              maxLength={4096}
            />
          </label>
          <a
            className="inline-block text-sm underline"
            href="https://vrata.tg/bot"
            target="_blank"
            rel="noopener noreferrer"
          >
            Получить ключ
          </a>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        className="w-full"
        type="submit"
        disabled={busy || (!config.configured && !apiKey.trim())}
      >
        {busy ? "Подключаем…" : "Начать работу"}
      </Button>
    </form>
  );
}

export function OnboardingGate({ children }: { children: ReactNode }) {
  const configQuery = useSystemConfig();
  const host = usePrimaryHost();
  const updateSettings = useUpdateGeneralSettings();
  const [completing, setCompleting] = useState(false);
  const settings = configQuery.data?.generalSettings;

  if (settings?.onboardingCompletedAt && !completing) return children;

  async function complete() {
    setCompleting(true);
    try {
      await updateSettings.mutateAsync({
        defaultProviderId: "vrata",
        providerOrder: [
          "vrata",
          ...(settings?.providerOrder ?? []).filter((id) => id !== "vrata"),
        ],
        onboardingCompletedAt: new Date().toISOString(),
      });
    } finally {
      setCompleting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12 text-foreground">
      <section className="w-full max-w-md space-y-6 rounded-xl border border-border p-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Врата BB</h1>
          <p className="text-sm text-muted-foreground">Ваш рабочий стол с ИИ</p>
        </div>
        {configQuery.isError ? (
          <div className="space-y-4">
            <p role="alert">Не удалось загрузить настройки BB.</p>
            <Button onClick={() => void configQuery.refetch()}>
              Повторить
            </Button>
          </div>
        ) : settings === undefined ||
          host === null ||
          host.status !== "connected" ? (
          <p role="status">Запускаем рабочую среду…</p>
        ) : (
          <Setup key={host.id} hostId={host.id} onComplete={complete} />
        )}
      </section>
    </main>
  );
}
