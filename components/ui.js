"use client";

// ---- Section shell --------------------------------------------------------
export function Section({ index, title, subtitle, children, className = "" }) {
  return (
    <section className={`mb-5 ${className}`}>
      <div className="mb-3 flex items-baseline gap-3">
        {index != null && (
          <span className="eyebrow text-rebar text-sm leading-none">{String(index).padStart(2, "0")}</span>
        )}
        <div>
          <h2 className="eyebrow text-gunmetal text-[15px] leading-none">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-slate2/80">{subtitle}</p>}
        </div>
      </div>
      <div className="rounded-lg border border-line bg-paper shadow-sm">{children}</div>
    </section>
  );
}

// ---- Labeled input --------------------------------------------------------
export function Field({ label, hint, value, onChange, type = "number", step, suffix, prefix, options, textarea, placeholder, readOnly }) {
  const base =
    "w-full rounded-md border border-line bg-white px-3 py-2.5 text-[15px] text-gunmetal outline-none transition focus:border-rebar focus:ring-2 focus:ring-rebar/20";
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate2">{label}</span>
      <div className="relative flex items-center">
        {prefix && <span className="pointer-events-none absolute left-3 text-sm text-slate2">{prefix}</span>}
        {options ? (
          <select className={`${base} appearance-none pr-9`} value={value} onChange={(e) => onChange(e.target.value)}>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : textarea ? (
          <textarea
            className={`${base} min-h-[64px] resize-y`}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            className={`${base} tnum ${prefix ? "pl-7" : ""} ${suffix ? "pr-12" : ""}`}
            type={type}
            inputMode={type === "number" ? "decimal" : undefined}
            step={step}
            readOnly={readOnly}
            disabled={readOnly}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
          />
        )}
        {suffix && <span className="pointer-events-none absolute right-3 text-sm text-slate2">{suffix}</span>}
        {options && (
          <span className="pointer-events-none absolute right-3 text-slate2">▾</span>
        )}
      </div>
      {hint && <span className="mt-1 block text-[11px] leading-snug text-slate2/70">{hint}</span>}
    </label>
  );
}

// ---- Stat card ------------------------------------------------------------
export function StatCard({ label, value, sub, tone = "default", big = false }) {
  const tones = {
    default: "bg-white border-line text-gunmetal",
    dark: "bg-steel border-steel text-white",
    good: "bg-white border-good/30 text-good",
    bad: "bg-white border-bad/30 text-bad",
  };
  return (
    <div className={`rounded-md border p-3.5 ${tones[tone]}`}>
      <div className={`text-[10px] font-semibold uppercase tracking-eyebrow ${tone === "dark" ? "text-white/60" : "text-slate2/70"}`}>
        {label}
      </div>
      <div className={`tnum font-display font-semibold leading-none ${big ? "mt-2 text-3xl" : "mt-1.5 text-xl"}`}>{value}</div>
      {sub && <div className={`tnum mt-1 text-xs ${tone === "dark" ? "text-white/55" : "text-slate2/70"}`}>{sub}</div>}
    </div>
  );
}
