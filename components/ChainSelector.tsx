"use client";

import { SUPPORTED_CHAINS } from "@/lib/chains";

interface Props {
  selected: number[];
  onChange: (ids: number[]) => void;
}

export function ChainSelector({ selected, onChange }: Props) {
  function toggle(id: number) {
    if (selected.includes(id)) {
      if (selected.length === 1) return; // keep at least one
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {SUPPORTED_CHAINS.map((chain) => {
        const active = selected.includes(chain.id);
        return (
          <button
            key={chain.id}
            onClick={() => toggle(chain.id)}
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all"
            style={{
              backgroundColor: active ? `${chain.color}22` : "transparent",
              color: active ? chain.color : "#6b7280",
              border: `1px solid ${active ? `${chain.color}55` : "#374151"}`,
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: active ? chain.color : "#6b7280" }}
            />
            {chain.name}
          </button>
        );
      })}
    </div>
  );
}
