import { requireUser } from "@/auth/session";
import { fill } from "@/messages/format";
import { getLocale, getMessages } from "@/messages/server";
import { fetchUploadSettings } from "@/sheets/queries";
import viPoints from "./shots/vi/points.json";
import enPoints from "./shots/en/points.json";
import {
  BLOCKS,
  SECTION_IDS,
  SHORTCUTS,
  TROUBLE_IDS,
  type Block,
  type SectionId,
  type ShotName,
  type TroubleId,
} from "./content";
import { Badge, Figure, type Point } from "./figure";
import { IMAGES } from "./images";
import { Key, Rich } from "./rich";

const POINTS = { vi: viPoints, en: enPoints } as const;

export default async function GuidePage() {
  const me = await requireUser("/guide");
  const [t, locale, settings] = await Promise.all([getMessages(), getLocale(), fetchUploadSettings()]);
  const g = t.guide;
  const points = POINTS[locale] as Record<string, Point[]>;
  const sections = SECTION_IDS.filter((id) => id !== "admin" || me.role === "admin");
  const values = { max: settings.maxFileMb, px: settings.lowresWarnPx };
  const steps = g.steps as Record<string, string>;
  /** The first screenshot of the page is its largest paint: it loads eagerly, the others lazily. */
  const firstShot = sections.flatMap((id) => BLOCKS[id]).find((b) => b.shot)?.shot;

  function troubleText(id: TroubleId): string {
    switch (id) {
      case "template": return t.upload.errors.wrongTemplate;
      case "tooLarge": return fill(t.upload.errors.tooLarge, { n: settings.maxFileMb + 5, max: settings.maxFileMb });
      case "reader": return t.editor.ocrLoad;
      case "conflict": return t.editor.conflict.title;
      case "suspended": return t.login.errors.suspended;
    }
  }

  function renderBlock(block: Block, index: number) {
    const shot: ShotName | undefined = block.shot;
    const eager = shot !== undefined && shot === firstShot;
    return (
      <div key={index} className="space-y-4">
        {shot && <Figure image={IMAGES[locale][shot]} alt={g.alt[shot]} openLabel={g.openFull} eager={eager} points={points[shot] ?? []} />}
        <ol aria-label={g.stepsLabel} className="space-y-3">
          {block.steps.map((s) => (
            <li key={s.key} className="flex gap-3 leading-relaxed text-ink-2">
              <Badge n={s.n} />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <Rich text={fill(steps[s.key], values)} />
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  function renderBody(id: SectionId) {
    if (id === "shortcuts") {
      return (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="bg-sunk text-ink-2">
                <tr>
                  <th scope="col" className="w-2/5 px-4 py-2 font-semibold">{g.shortcuts.keyCol}</th>
                  <th scope="col" className="px-4 py-2 font-semibold">{g.shortcuts.doCol}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {SHORTCUTS.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-2.5 align-top">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {row.keys.map((chord, i) => (
                          <span key={i} className="flex items-center gap-1">
                            {i > 0 && <span aria-hidden className="mr-1 text-ink-3">/</span>}
                            {chord.map((k, j) => (
                              <span key={j} className="flex items-center gap-1">
                                {j > 0 && <span aria-hidden className="text-ink-3">+</span>}
                                <Key>{k}</Key>
                              </span>
                            ))}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">{g.shortcuts.rows[row.id]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-ink-3">{g.shortcuts.note}</p>
        </div>
      );
    }
    if (id === "trouble") {
      return (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-sunk text-ink-2">
              <tr>
                <th scope="col" className="w-1/2 px-4 py-2 font-semibold">{g.trouble.message}</th>
                <th scope="col" className="px-4 py-2 font-semibold">{g.trouble.fix}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {TROUBLE_IDS.map((tid) => (
                <tr key={tid}>
                  <td className="px-4 py-3 align-top">“{troubleText(tid)}”</td>
                  <td className="px-4 py-3 align-top text-ink-2">{g.trouble.fixes[tid]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return <div className="space-y-8">{BLOCKS[id].map(renderBlock)}</div>;
  }

  return (
    <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
      <nav aria-label={g.toc} className="mb-8 lg:sticky lg:top-6 lg:mb-0 lg:self-start">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">{g.toc}</p>
        <ol className="grid gap-1 rounded-lg border border-line bg-surface p-2 text-sm sm:grid-cols-2 lg:grid-cols-1">
          {sections.map((id, i) => (
            <li key={id}>
              <a href={`#${id}`} className="flex items-baseline gap-2 rounded px-2 py-1.5 text-ink-2 hover:bg-sunk hover:text-ink">
                <span className="w-4 text-xs tabular-nums text-ink-3">{i + 1}</span>
                {g.sections[id].title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <article className="min-w-0 max-w-[55rem] space-y-12">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">{g.title}</h1>
          <p className="max-w-2xl text-lg leading-relaxed text-ink-2">{g.lead}</p>
        </header>
        {sections.map((id, i) => (
          <section key={id} id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 space-y-5">
            <div className="space-y-1 border-t border-line pt-8">
              <p className="text-xs font-semibold tabular-nums text-accent">{i + 1}</p>
              <h2 id={`${id}-title`} className="text-2xl font-bold tracking-tight">{g.sections[id].title}</h2>
              <p className="max-w-2xl leading-relaxed text-ink-2">{g.sections[id].lead}</p>
            </div>
            {renderBody(id)}
          </section>
        ))}
      </article>
    </div>
  );
}
