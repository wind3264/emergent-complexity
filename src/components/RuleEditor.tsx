"use client";

import { useEffect, useState } from "react";
import { Rule, hasCount, parseRule, ruleToString, toggleCount } from "@/lib/life";
import { RULE_PRESETS } from "@/lib/patterns";

/** The 8 Moore-neighborhood slots, listed clockwise from the top-left corner. */
const RING = [0, 1, 2, 5, 8, 7, 6, 3];

/** A 3x3 icon showing a center cell surrounded by exactly `n` live neighbors. */
function NeighborIcon({ n, centerAlive }: { n: number; centerAlive: boolean }) {
  const lit = new Set(RING.slice(0, n));
  return (
    <span className="nb" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => {
        if (i === 4) return <i key={i} className={centerAlive ? "center alive" : "center"} />;
        return <i key={i} className={lit.has(i) ? "lit" : ""} />;
      })}
    </span>
  );
}

function CountRow({
  kind,
  mask,
  onToggle,
}: {
  kind: "birth" | "survive";
  mask: number;
  onToggle: (n: number) => void;
}) {
  const centerAlive = kind === "survive";
  return (
    <div className="counts">
      {Array.from({ length: 9 }, (_, n) => {
        const on = hasCount(mask, n);
        const verb = kind === "birth" ? "born with" : "survives with";
        return (
          <button
            key={n}
            type="button"
            className={`count ${kind} ${on ? "on" : ""}`}
            aria-pressed={on}
            title={`${on ? "On" : "Off"}: a ${kind === "birth" ? "dead" : "live"} cell is ${verb} ${n} live neighbor${n === 1 ? "" : "s"}`}
            onClick={() => onToggle(n)}
          >
            <NeighborIcon n={n} centerAlive={centerAlive} />
            <span className="num">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function RuleEditor({
  rule,
  onChange,
}: {
  rule: Rule;
  onChange: (rule: Rule) => void;
}) {
  const canonical = ruleToString(rule);
  const [draft, setDraft] = useState(canonical);
  const [invalid, setInvalid] = useState(false);

  // Keep the text box in sync when the rule changes from the toggles or a preset.
  useEffect(() => {
    setDraft(canonical);
    setInvalid(false);
  }, [canonical]);

  const preset = RULE_PRESETS.find((p) => p.rule === canonical);

  function commitText(text: string) {
    setDraft(text);
    const parsed = parseRule(text);
    if (parsed) {
      setInvalid(false);
      onChange(parsed);
    } else {
      setInvalid(true);
    }
  }

  return (
    <div className="panel">
      <h2>Rule</h2>

      <div className="rulehead">
        <i className="swatch" style={{ background: "var(--birth)" }} />
        <span className="title">Birth</span>
        <span className="desc">a dead cell turns on with...</span>
      </div>
      <CountRow
        kind="birth"
        mask={rule.birth}
        onToggle={(n) => onChange({ ...rule, birth: toggleCount(rule.birth, n) })}
      />

      <div className="rulehead" style={{ marginTop: 14 }}>
        <i className="swatch" style={{ background: "var(--survive)" }} />
        <span className="title">Survival</span>
        <span className="desc">a live cell stays on with...</span>
      </div>
      <CountRow
        kind="survive"
        mask={rule.survive}
        onToggle={(n) => onChange({ ...rule, survive: toggleCount(rule.survive, n) })}
      />

      <div className="row" style={{ marginTop: 13 }}>
        <input
          type="text"
          className={invalid ? "invalid" : ""}
          value={draft}
          spellCheck={false}
          aria-label="Rule string"
          onChange={(e) => commitText(e.target.value)}
          onBlur={() => {
            if (invalid) {
              setDraft(canonical);
              setInvalid(false);
            }
          }}
        />
      </div>

      <div className="row">
        <select
          aria-label="Rule preset"
          value={preset ? preset.rule : ""}
          onChange={(e) => {
            const parsed = parseRule(e.target.value);
            if (parsed) onChange(parsed);
          }}
        >
          {!preset && <option value="">Custom rule</option>}
          {RULE_PRESETS.map((p) => (
            <option key={p.rule} value={p.rule}>
              {p.name} ({p.rule})
            </option>
          ))}
        </select>
      </div>

      <p className="presetnote">
        {preset ? preset.note : "A custom rule. Every live cell counts its 8 neighbors, then the two rows above decide the next state."}
      </p>
    </div>
  );
}
