"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isAddress } from "viem";

export function BundleInput() {
  const [inputs, setInputs] = useState(["", ""]);
  const [errors, setErrors] = useState<string[]>([]);
  const router = useRouter();

  function updateInput(i: number, val: string) {
    setInputs((prev) => prev.map((v, idx) => (idx === i ? val : v)));
    setErrors([]);
  }

  function addRow() {
    setInputs((prev) => [...prev, ""]);
  }

  function removeRow(i: number) {
    if (inputs.length <= 2) return;
    setInputs((prev) => prev.filter((_, idx) => idx !== i));
    setErrors([]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const filled = inputs.map((v) => v.trim()).filter(Boolean);
    const newErrors: string[] = [];

    if (filled.length < 2) {
      newErrors.push("Enter at least 2 wallet addresses.");
    }

    const invalid = filled.filter((a) => !isAddress(a));
    if (invalid.length > 0) {
      newErrors.push(`Invalid address${invalid.length > 1 ? "es" : ""}: ${invalid.map((a) => a.slice(0, 10) + "…").join(", ")}`);
    }

    if (newErrors.length > 0) {
      setErrors(newErrors);
      return;
    }

    const unique = [...new Set(filled.map((a) => a.toLowerCase()))];
    router.push(`/portfolio/bundle?addresses=${unique.join(",")}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {inputs.map((val, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              type="text"
              placeholder={`Wallet ${i + 1} — 0x…`}
              value={val}
              onChange={(e) => updateInput(i, e.target.value)}
              className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
            {inputs.length > 2 && (
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="shrink-0 text-gray-600 hover:text-gray-400 transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          <Plus size={12} />
          Add wallet
        </button>
        <div className="flex-1" />
        <Button type="submit" variant="outline">
          Track Bundle
        </Button>
      </div>

      {errors.length > 0 && (
        <div className="space-y-1">
          {errors.map((e, i) => (
            <p key={i} className="text-xs text-red-400">{e}</p>
          ))}
        </div>
      )}
    </form>
  );
}
