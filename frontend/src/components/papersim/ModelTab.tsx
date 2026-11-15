"use client";

import React, { useMemo } from "react";
import {
  BookA,
  Code2,
  Compass,
  Footprints,
  Library,
  Lightbulb,
  ShieldAlert,
  SlidersHorizontal,
  SquareFunction,
} from "lucide-react";
import type { PaperSimTabProps } from "./types";
import { CodeBlock } from "./model/CodeBlock";
import { collectSources, equationsOf, glossaryOf, paramRows } from "./model/derive";
import {
  CaveatsBody,
  DerivationBody,
  EquationsBody,
  FindingsBody,
  GlossaryBody,
  OverviewBody,
  ParametersBody,
  SourcesBody,
} from "./model/sections";
import { Section, SectionChips, SectionNav, scrollToSection, useScrollSpy, type NavItem } from "./model/SectionNav";

interface SectionDef extends NavItem {
  kicker: string;
  title: string;
  render: () => React.ReactNode;
  aside?: React.ReactNode;
}

/** "Equations" tab: a structured, sectioned reading of the simulated model. */
export function ModelTab({ simulation, paramValues }: PaperSimTabProps) {
  const docs = simulation.docs;

  const derived = useMemo(() => {
    const eqs = equationsOf(simulation);
    const gl = glossaryOf(simulation);
    return {
      eqs,
      gl,
      params: paramRows(simulation),
      sources: collectSources(simulation),
      findings: (docs?.key_findings ?? []).filter((s) => s.trim()),
      derivation: (docs?.derivation ?? []).filter((s) => s.title?.trim() || s.latex?.trim() || s.explanation?.trim()),
      assumptions: (simulation.assumptions ?? []).filter((s) => s.trim()),
      limitations: (docs?.limitations ?? []).filter((s) => s.trim()),
    };
  }, [simulation, docs]);

  const sections: SectionDef[] = [];
  const facts = [
    { label: "Equations", value: derived.eqs.items.length },
    { label: "Parameters", value: simulation.params.length },
    { label: "Output series", value: simulation.series.length },
    { label: "Caveats", value: derived.assumptions.length + derived.limitations.length },
  ].filter((f) => f.value > 0);

  sections.push({
    id: "model-overview",
    label: "Overview",
    icon: Compass,
    kicker: "Overview",
    title: "What this model is about",
    render: () => <OverviewBody sim={simulation} facts={facts} />,
  });
  if (derived.findings.length)
    sections.push({
      id: "model-findings",
      label: "Key findings",
      icon: Lightbulb,
      count: derived.findings.length,
      kicker: "Key findings",
      title: "What the paper shows",
      render: () => <FindingsBody findings={derived.findings} />,
    });
  if (derived.eqs.items.length)
    sections.push({
      id: "model-equations",
      label: "Core equations",
      icon: SquareFunction,
      count: derived.eqs.items.length,
      kicker: "Core equations",
      title: derived.eqs.items.length > 1 ? "The equations behind the simulation" : "The governing equation",
      render: () => <EquationsBody equations={derived.eqs.items} derived={derived.eqs.derived} />,
    });
  if (derived.derivation.length)
    sections.push({
      id: "model-derivation",
      label: "How it works",
      icon: Footprints,
      count: derived.derivation.length,
      kicker: "Derivation",
      title: "How the model works, step by step",
      render: () => <DerivationBody steps={derived.derivation} />,
    });
  if (derived.params.length)
    sections.push({
      id: "model-parameters",
      label: "Parameters",
      icon: SlidersHorizontal,
      count: derived.params.length,
      kicker: "Parameters",
      title: "Every knob, and what it does",
      render: () => <ParametersBody rows={derived.params} paramValues={paramValues} />,
    });
  if (derived.assumptions.length || derived.limitations.length)
    sections.push({
      id: "model-caveats",
      label: "Assumptions",
      icon: ShieldAlert,
      count: derived.assumptions.length + derived.limitations.length,
      kicker: "Caveats",
      title: derived.limitations.length ? "Assumptions & limitations" : "Assumptions & simplifications",
      render: () => <CaveatsBody assumptions={derived.assumptions} limitations={derived.limitations} />,
    });
  if (derived.gl.items.length)
    sections.push({
      id: "model-glossary",
      label: "Glossary",
      icon: BookA,
      count: derived.gl.items.length,
      kicker: "Glossary",
      title: "Symbols at a glance",
      render: () => <GlossaryBody items={derived.gl.items} derived={derived.gl.derived} />,
    });
  sections.push({
    id: "model-code",
    label: "Simulation code",
    icon: Code2,
    kicker: "Implementation",
    title: "The code that produces the plot",
    render: () =>
      simulation.python_code?.trim() ? (
        <CodeBlock code={simulation.python_code} />
      ) : (
        <p className="apple-card rounded-[22px] border border-dashed p-6 text-center text-xs text-[var(--text-secondary)]">
          This simulation runs from a built-in model on the backend, so there is no generated code to show.
        </p>
      ),
  });
  if (derived.sources.length)
    sections.push({
      id: "model-sources",
      label: "Sources",
      icon: Library,
      count: derived.sources.reduce((s, g) => s + g.items.length, 0),
      kicker: "Sources",
      title: "Where this comes from in the paper",
      render: () => <SourcesBody groups={derived.sources} />,
    });

  const ids = sections.map((s) => s.id);
  const [active, setActive] = useScrollSpy(ids);
  const pick = (id: string) => {
    setActive(id);
    scrollToSection(id);
  };

  return (
    <div className="mx-auto min-w-0 max-w-6xl px-2 pb-6 sm:px-4 lg:px-6">
      <SectionChips items={sections} active={active} onPick={pick} />
      <div className="pt-5 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8 lg:pt-1">
        <SectionNav items={sections} active={active} onPick={pick} />
        <div className="min-w-0 space-y-12">
          {sections.map((s, i) => (
            <Section key={s.id} id={s.id} icon={s.icon} kicker={s.kicker} title={s.title} index={i} aside={s.aside}>
              {s.render()}
            </Section>
          ))}
        </div>
      </div>
    </div>
  );
}
